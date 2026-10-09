import { randomBytes } from "node:crypto";
import { and, arrayOverlaps, asc, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { activeAssets } from "@/config/assets";
import { AI_MAX_OUTPUT_TOKENS, estimateMaxCallCostUsd } from "@/config/ai";
import type { Env } from "@/config/env";
import { NOVELTY_THRESHOLDS } from "@/config/scoring";
import { CLAIM_NATURE_CATEGORIES, isEventCategory, type EventCategory } from "@/domain/categories";
import type { Db } from "@/server/db/client";
import {
  contradictions,
  eventClassifications,
  eventItems,
  events,
  failedJobs,
  itemAnalyses,
  itemContents,
  items,
} from "@/server/db/schema";
import { publish } from "@/server/lib/bus";
import { errorMessage, logger } from "@/server/lib/logger";
import { contentHash, normalizeText } from "@/server/lib/text";
import type { AnalysisProvider } from "@/server/providers/ai/types";
import type { ValidatedExtraction } from "@/server/providers/ai/schema";
import type { NormalizedItem } from "@/server/providers/source/types";
import { recordUsage, checkAiBudget } from "./budget";
import { classifyText, type Classification } from "./classify";
import { extractEntities, type EntityResult } from "./entities";
import { ruleTitle } from "./explain";
import { filterItem } from "./filter";
import { independenceKey } from "./independence";
import { assignRole, decideNovelty, type CandidateEvent } from "./novelty";
import { recomputeEvent, type RecomputeResult } from "./recompute";
import { loadSourcesByIds, sourceByHandle, toSourceRef, trackedUniverse, type SourceRow } from "./repo";
import { isAuthoritativeFor } from "./verification";

export interface PipelineConfig {
  includeDemo: boolean;
  aiEnabled: boolean;
  maxAiAnalysesPerDay: number;
  maxAiDailyCostUsd: number;
  minScoreForAi: number;
  staleAfterHours: number;
  retentionDays: { x: number; rss: number };
  maxPostsPerBatch: number;
  alerts: { cooldownMinutes: number; maxPerHour: number; maxAgeHours: number };
  appUrl: string;
}

export interface PipelineContext {
  db: Db;
  now: () => Date;
  ai: AnalysisProvider;
  config: PipelineConfig;
  /** Called after an event changes materially (alert evaluation). */
  onMaterialChange?: (ctx: PipelineContext, result: RecomputeResult) => Promise<void>;
}

export function pipelineConfigFromEnv(env: Env): PipelineConfig {
  return {
    includeDemo: env.DEMO_MODE,
    aiEnabled: env.AI_ENABLED && Boolean(env.ANTHROPIC_API_KEY),
    maxAiAnalysesPerDay: env.MAX_AI_ANALYSES_PER_DAY,
    maxAiDailyCostUsd: env.MAX_AI_DAILY_COST_USD,
    minScoreForAi: env.MIN_SCORE_FOR_AI,
    staleAfterHours: env.STALE_AFTER_HOURS,
    retentionDays: { x: env.X_CONTENT_RETENTION_DAYS, rss: env.RSS_CONTENT_RETENTION_DAYS },
    maxPostsPerBatch: env.MAX_POSTS_PER_INTERVAL,
    alerts: { cooldownMinutes: env.ALERT_COOLDOWN_MINUTES, maxPerHour: env.MAX_NOTIFICATIONS_PER_HOUR, maxAgeHours: 6 },
    appUrl: env.APP_URL,
  };
}

const MAX_PROCESSING_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Ingestion (idempotent)
// ---------------------------------------------------------------------------

export async function ingestItems(
  ctx: PipelineContext,
  batch: NormalizedItem[],
): Promise<{ inserted: number; duplicates: number; insertedIds: string[] }> {
  const insertedIds: string[] = [];
  let duplicates = 0;
  const now = ctx.now();
  for (const item of batch) {
    const text = item.text.trim();
    if (!text) continue;
    const [row] = await ctx.db
      .insert(items)
      .values({
        provider: item.provider,
        externalId: item.externalId,
        sourceId: item.sourceId,
        authorHandle: item.authorHandle,
        authorName: item.authorName,
        authorExternalId: item.authorExternalId,
        url: item.url,
        lang: item.lang,
        publishedAt: item.publishedAt,
        collectedAt: now,
        contentHash: contentHash(text),
        referenced: item.referenced,
        isDemo: item.isDemo,
      })
      .onConflictDoNothing({ target: [items.provider, items.externalId] })
      .returning({ id: items.id });
    if (!row) {
      duplicates++;
      continue;
    }
    const retentionDays = item.provider === "x" ? ctx.config.retentionDays.x : item.provider === "rss" ? ctx.config.retentionDays.rss : null;
    await ctx.db.insert(itemContents).values({
      itemId: row.id,
      title: item.title,
      text,
      retentionExpiresAt: retentionDays ? new Date(now.getTime() + retentionDays * 86_400_000) : null,
    });
    insertedIds.push(row.id);
  }
  return { inserted: insertedIds.length, duplicates, insertedIds };
}

export async function queueDepth(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .where(inArray(items.processingState, ["pending", "processing"]));
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Processing loop
// ---------------------------------------------------------------------------

export interface ProcessStats {
  processed: number;
  outcomes: Record<string, number>;
  failed: number;
  aiCalls: number;
  aiSkipped: Record<string, number>;
  materialChanges: number;
}

export async function processPending(ctx: PipelineContext, limit = ctx.config.maxPostsPerBatch): Promise<ProcessStats> {
  const stats: ProcessStats = { processed: 0, outcomes: {}, failed: 0, aiCalls: 0, aiSkipped: {}, materialChanges: 0 };
  const pending = await ctx.db
    .select({ id: items.id, attempts: items.processingAttempts })
    .from(items)
    .where(eq(items.processingState, "pending"))
    .orderBy(asc(items.publishedAt), asc(items.collectedAt))
    .limit(limit);
  if (pending.length === 0) return stats;

  const universe = await trackedUniverse(ctx.db);
  for (const p of pending) {
    const [claimed] = await ctx.db
      .update(items)
      .set({ processingState: "processing", processingAttempts: p.attempts + 1 })
      .where(and(eq(items.id, p.id), eq(items.processingState, "pending")))
      .returning({ id: items.id });
    if (!claimed) continue;
    try {
      const result = await processItem(ctx, p.id, universe);
      stats.processed++;
      stats.outcomes[result.outcome] = (stats.outcomes[result.outcome] ?? 0) + 1;
      if (result.aiCalled) stats.aiCalls++;
      if (result.aiSkipped) stats.aiSkipped[result.aiSkipped] = (stats.aiSkipped[result.aiSkipped] ?? 0) + 1;
      if (result.material) stats.materialChanges++;
      await ctx.db.update(items).set({ processingState: "done", processedAt: ctx.now() }).where(eq(items.id, p.id));
    } catch (error) {
      stats.failed++;
      const message = errorMessage(error);
      logger.error("pipeline.item_failed", { itemId: p.id, attempt: p.attempts + 1, error: message });
      const exhausted = p.attempts + 1 >= MAX_PROCESSING_ATTEMPTS;
      await ctx.db
        .update(items)
        .set({ processingState: exhausted ? "failed" : "pending" })
        .where(eq(items.id, p.id));
      if (exhausted) {
        await ctx.db.insert(failedJobs).values({ job: "process_item", refId: p.id, payload: { itemId: p.id }, error: message, attempts: p.attempts + 1 });
      }
    }
  }
  return stats;
}

interface ItemProcessResult {
  outcome: string;
  material: boolean;
  aiCalled: boolean;
  aiSkipped: string | null;
}

async function processItem(
  ctx: PipelineContext,
  itemId: string,
  universe: Awaited<ReturnType<typeof trackedUniverse>>,
): Promise<ItemProcessResult> {
  const started = Date.now();
  const db = ctx.db;
  const now = ctx.now();
  const [row] = await db
    .select({ item: items, content: itemContents })
    .from(items)
    .leftJoin(itemContents, eq(itemContents.itemId, items.id))
    .where(eq(items.id, itemId));
  if (!row) throw new Error("item not found");
  const { item, content } = row;

  const writeAnalysis = (values: Partial<typeof itemAnalyses.$inferInsert> & { outcome: string }) =>
    db
      .insert(itemAnalyses)
      .values({ itemId, rulesVersion: RULES_VERSION_TAG, latencyMs: Date.now() - started, ...values })
      .onConflictDoUpdate({ target: itemAnalyses.itemId, set: { ...values, latencyMs: Date.now() - started, processedAt: now } });

  if (!content) {
    await writeAnalysis({ outcome: "content_unavailable", filterReason: "content was purged or unavailable before processing" });
    return { outcome: "content_unavailable", material: false, aiCalled: false, aiSkipped: null };
  }
  const text = content.text;

  const source: SourceRow | null = item.sourceId ? ((await loadSourcesByIds(db, [item.sourceId])).get(item.sourceId) ?? null) : null;
  const sourceRef = source ? toSourceRef(source) : null;
  const assetsDict = activeAssets(ctx.config.includeDemo || item.isDemo);
  const entities = extractEntities(text, assetsDict, universe.custom);

  // Coordinated repetition: identical text from other authors in the last 24h.
  const [dup] = await db
    .select({ n: sql<number>`count(distinct coalesce(${items.authorHandle}, ${items.sourceId}::text))::int` })
    .from(items)
    .where(
      and(
        eq(items.contentHash, item.contentHash),
        ne(items.id, item.id),
        gte(items.collectedAt, new Date(now.getTime() - 86_400_000)),
        item.authorHandle ? sql`coalesce(${items.authorHandle}, '') <> ${item.authorHandle}` : sql`true`,
      ),
    );

  const filter = filterItem({
    text,
    isTrackedSource: Boolean(sourceRef?.enabled),
    entityCount: entities.assets.length + entities.entityKeys.length,
    identicalFromOtherAuthors: Number(dup?.n ?? 0),
  });

  const classification = classifyText(text, {
    sourceAuthorityDomains: sourceRef?.authorityDomains,
    isPrimarySource: sourceRef?.isPrimary ?? false,
  });

  if (filter.action === "discard") {
    await writeAnalysis({
      outcome: filter.outcome,
      filterFlags: filter.flags,
      filterReason: filter.reasons.join("; "),
      classification,
      entities,
    });
    return { outcome: filter.outcome, material: false, aiCalled: false, aiSkipped: null };
  }
  // Items without a category can still be follow-ups, corrections or denials of
  // an existing event; they are only discarded if they match nothing.
  const uncategorized = classification.categories.length === 0;
  const irrelevant = () =>
    writeAnalysis({
      outcome: "filtered_irrelevant",
      filterFlags: filter.flags,
      filterReason: "no market-relevant category matched and no related active event",
      classification,
      entities,
    }).then(() => ({ outcome: "filtered_irrelevant", material: false, aiCalled: false, aiSkipped: null }) as ItemProcessResult);
  if (uncategorized && entities.entityKeys.length === 0) return irrelevant();

  // --- Independence key -------------------------------------------------------
  const refExternalIds = item.referenced.filter((r) => r.type === "retweeted" || r.type === "quoted").map((r) => r.id);
  const refKeys = new Map<string, string>();
  if (refExternalIds.length) {
    const rows = await db
      .select({ externalId: items.externalId, key: eventItems.independenceKey })
      .from(items)
      .innerJoin(eventItems, eq(eventItems.itemId, items.id))
      .where(and(eq(items.provider, item.provider), inArray(items.externalId, refExternalIds)));
    for (const r of rows) refKeys.set(r.externalId, r.key);
  }
  const attributedHandle = /\bvia @([A-Za-z0-9_]{2,15})\b/i.exec(text)?.[1] ?? null;
  const attributedSource = attributedHandle ? await sourceByHandle(db, item.provider, attributedHandle) : null;
  const indKey = independenceKey(
    { provider: item.provider, authorHandle: item.authorHandle, sourceOrganization: sourceRef?.organization ?? null, text, referenced: item.referenced },
    {
      referencedKey: (_provider, externalId) => refKeys.get(externalId) ?? null,
      handleOrganization: (h) => (attributedSource && attributedSource.handle?.toLowerCase() === h.toLowerCase() ? attributedSource.organization : null),
    },
  );

  // --- Novelty / clustering ---------------------------------------------------
  const categories = classification.categories.map((c) => c.category);
  const candidates = await loadCandidates(db, item.isDemo, entities.entityKeys, categories, item.contentHash, now);
  const decision = decideNovelty(
    {
      text,
      contentHash: item.contentHash,
      entityKeys: entities.entityKeys,
      categories,
      publishedAt: item.publishedAt,
      collectedAt: item.collectedAt,
      signals: classification.signals,
      isDemo: item.isDemo,
    },
    candidates,
  );

  if (uncategorized && (decision.hint === "new" || decision.hint === "related" || !decision.eventId)) return irrelevant();

  let eventId: string;
  let role: string;
  let isNew = false;
  if (decision.hint === "new" || !decision.eventId) {
    eventId = await createEvent(db, {
      item,
      text,
      title: content.title,
      classification,
      entities,
      independenceKey: indKey,
      now,
    });
    role = "origin";
    isNew = true;
  } else {
    eventId = decision.eventId;
    const candidate = candidates.find((c) => c.id === eventId)!;
    const subjectOnly = categories.filter((c) => !CLAIM_NATURE_CATEGORIES.has(c));
    const assignedRole = assignRole({
      hint: decision.hint,
      sourceCategory: sourceRef?.category ?? "unknown",
      isPrimary: sourceRef?.isPrimary ?? false,
      isAuthoritativeForEvent: sourceRef ? isAuthoritativeFor(sourceRef, candidate.categories) : false,
      independenceKey: indKey,
      eventIndependenceKeys: candidate.independenceKeys,
      commentaryOnly: subjectOnly.length === 0 && categories.includes("market_commentary"),
      isOpinion: classification.signals.opinion && !classification.signals.firstHand,
      isRepostOrQuote: item.referenced.some((r) => r.type === "retweeted" || r.type === "quoted"),
    });
    role = assignedRole;
    await db
      .insert(eventItems)
      .values({ eventId, itemId: item.id, role, independenceKey: indKey, similarity: decision.similarity, note: decision.reason })
      .onConflictDoNothing();
    if (role === "contradiction") {
      await db.insert(contradictions).values({
        eventId,
        itemId: item.id,
        description: `${item.authorName ?? item.authorHandle ?? "A source"} contradicts the claim (${decision.reason}).`,
      });
    }
    // Evidence-bearing items extend the event's entity keys and subject categories.
    if (["corroboration", "primary_source", "update"].includes(role)) {
      const [ev] = await db.select({ entityKeys: events.entityKeys, categories: events.categories }).from(events).where(eq(events.id, eventId));
      const mergedKeys = [...new Set([...(ev?.entityKeys ?? []), ...entities.entityKeys])].slice(0, 60);
      const mergedCats = [...new Set([...(ev?.categories ?? []), ...subjectOnly])];
      await db.update(events).set({ entityKeys: mergedKeys, categories: mergedCats }).where(eq(events.id, eventId));
      for (const c of classification.categories.filter((c) => subjectOnly.includes(c.category))) {
        await db
          .insert(eventClassifications)
          .values({ eventId, category: c.category, score: c.score, method: "rules", evidence: c.evidence })
          .onConflictDoNothing();
      }
    }
    if (role !== "repeat" && role !== "commentary") {
      await db.update(events).set({ lastActivityAt: now }).where(eq(events.id, eventId));
    }
  }

  await writeAnalysis({
    outcome: isNew ? "new_event" : decision.hint === "exact_duplicate" ? "duplicate" : "attached",
    filterFlags: filter.flags,
    filterReason: filter.reasons.join("; ") || null,
    classification,
    entities,
    eventId,
    role,
  });

  let result = await recomputeEvent(ctx, eventId, isNew ? "event created" : `item attached as ${role}`, { isNew, resurfaced: decision.resurfaced });

  // --- Optional AI analysis ----------------------------------------------------
  const ai = await maybeRunAi(ctx, eventId, result.importance);
  // Recompute whenever the AI outcome changed what the event should show:
  // new analysis, a failure warning, or a budget-skip notice.
  if (ai.called || ai.skipped === "budget" || ai.skipped === "cache_hit") {
    const again = await recomputeEvent(ctx, eventId, ai.ok ? "AI analysis added" : "AI analysis unavailable", {
      isNew: false,
      resurfaced: decision.resurfaced,
      forceMaterial: false,
    });
    // Keep the creation/attachment change kind for alerting; AI never makes an event "material" by itself.
    result = { ...again, material: result.material || again.material, changeKind: result.material ? result.changeKind : again.changeKind, materialVersion: again.materialVersion };
  }

  if (result.material && ctx.onMaterialChange) await ctx.onMaterialChange(ctx, result);
  publish({ type: "event.changed", eventId, change: isNew ? "created" : "updated", isDemo: item.isDemo });

  return {
    outcome: isNew ? "new_event" : decision.hint === "exact_duplicate" ? "duplicate" : "attached",
    material: result.material,
    aiCalled: ai.called,
    aiSkipped: ai.skipped,
  };
}

const RULES_VERSION_TAG = "rules-2026-10-08.1";

async function loadCandidates(
  db: Db,
  isDemo: boolean,
  entityKeys: string[],
  categories: EventCategory[],
  hash: string,
  now: Date,
): Promise<CandidateEvent[]> {
  const since = new Date(now.getTime() - NOVELTY_THRESHOLDS.activeWindowHours * 3_600_000);
  const overlap = [] as ReturnType<typeof arrayOverlaps>[];
  if (entityKeys.length) overlap.push(arrayOverlaps(events.entityKeys, entityKeys));
  const subject = categories.filter((c) => !CLAIM_NATURE_CATEGORIES.has(c));
  if (subject.length) overlap.push(arrayOverlaps(events.categories, subject));
  const active = overlap.length
    ? await db
        .select()
        .from(events)
        .where(and(eq(events.isDemo, isDemo), gte(events.lastActivityAt, since), or(...overlap)))
        .orderBy(desc(events.lastActivityAt))
        .limit(150)
    : [];
  // Exact-text matches older than the active window (resurfacing information).
  const archived = await db
    .select({ event: events })
    .from(items)
    .innerJoin(eventItems, eq(eventItems.itemId, items.id))
    .innerJoin(events, eq(events.id, eventItems.eventId))
    .where(and(eq(items.contentHash, hash), eq(events.isDemo, isDemo), lt(events.lastActivityAt, since)))
    .limit(5);
  const all = new Map(active.map((e) => [e.id, e]));
  for (const a of archived) all.set(a.event.id, a.event);
  if (all.size === 0) return [];

  const evItems = await db
    .select({ eventId: eventItems.eventId, key: eventItems.independenceKey, hash: items.contentHash, role: eventItems.role })
    .from(eventItems)
    .innerJoin(items, eq(items.id, eventItems.itemId))
    .where(inArray(eventItems.eventId, [...all.keys()]));
  const hashes = new Map<string, Set<string>>();
  const keys = new Map<string, Set<string>>();
  for (const r of evItems) {
    if (!hashes.has(r.eventId)) hashes.set(r.eventId, new Set());
    hashes.get(r.eventId)!.add(r.hash);
    if (["origin", "corroboration", "primary_source", "repeat", "update"].includes(r.role)) {
      if (!keys.has(r.eventId)) keys.set(r.eventId, new Set());
      keys.get(r.eventId)!.add(r.key);
    }
  }
  return [...all.values()].map((e) => ({
    id: e.id,
    signature: e.signature,
    entityKeys: e.entityKeys,
    categories: e.categories.filter(isEventCategory),
    lastActivityAt: e.lastActivityAt,
    firstSeenAt: e.firstSeenAt,
    contentHashes: hashes.get(e.id) ?? new Set(),
    independenceKeys: keys.get(e.id) ?? new Set(),
    isDemo: e.isDemo,
  }));
}

function newRef(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(7);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `EV-${out}`;
}

async function createEvent(
  db: Db,
  input: {
    item: typeof items.$inferSelect;
    text: string;
    title: string | null;
    classification: Classification;
    entities: EntityResult;
    independenceKey: string;
    now: Date;
  },
): Promise<string> {
  const { item, classification } = input;
  const primary = classification.primary ?? "other_material";
  const isRumor = classification.categories.some((c) => c.category === "rumor");
  for (let attempt = 0; attempt < 5; attempt++) {
    const [ev] = await db
      .insert(events)
      .values({
        ref: newRef(),
        title: ruleTitle(input.text, input.title, isRumor),
        summary: input.text.replace(/\s+/g, " ").slice(0, 600),
        primaryCategory: primary,
        categories: classification.categories.map((c) => c.category),
        firstSeenAt: input.now,
        firstPublishedAt: item.publishedAt,
        lastActivityAt: input.now,
        originItemId: item.id,
        isDemo: item.isDemo,
        signature: normalizeText(input.text).slice(0, 2000),
        entityKeys: input.entities.entityKeys.slice(0, 60),
      })
      .onConflictDoNothing({ target: events.ref })
      .returning({ id: events.id });
    if (!ev) continue;
    await db.insert(eventItems).values({ eventId: ev.id, itemId: item.id, role: "origin", independenceKey: input.independenceKey, similarity: 1 });
    for (const c of classification.categories) {
      await db.insert(eventClassifications).values({ eventId: ev.id, category: c.category, score: c.score, method: "rules", evidence: c.evidence });
    }
    return ev.id;
  }
  throw new Error("could not allocate a unique event reference");
}

// ---------------------------------------------------------------------------
// Optional AI analysis (budgeted, cached by content hash, never fabricates)
// ---------------------------------------------------------------------------

async function maybeRunAi(
  ctx: PipelineContext,
  eventId: string,
  importance: number,
): Promise<{ called: boolean; ok: boolean; skipped: string | null }> {
  const db = ctx.db;
  const [ev] = await db.select({ aiStatus: events.aiStatus, originItemId: events.originItemId, isDemo: events.isDemo }).from(events).where(eq(events.id, eventId));
  if (!ev || !ev.originItemId) return { called: false, ok: false, skipped: null };
  if (ev.aiStatus === "ok") return { called: false, ok: false, skipped: null };

  const setStatus = (status: string) => db.update(events).set({ aiStatus: status }).where(eq(events.id, eventId));

  if (!ctx.config.aiEnabled || !ctx.ai.configured()) {
    if (ev.aiStatus !== "not_configured") await setStatus("not_configured");
    return { called: false, ok: false, skipped: "not_configured" };
  }
  if (importance < ctx.config.minScoreForAi) {
    await setStatus("skipped_below_threshold");
    return { called: false, ok: false, skipped: "below_threshold" };
  }

  const [origin] = await db
    .select({ item: items, content: itemContents })
    .from(items)
    .leftJoin(itemContents, eq(itemContents.itemId, items.id))
    .where(eq(items.id, ev.originItemId));
  if (!origin?.content) return { called: false, ok: false, skipped: "content_unavailable" };

  // Reuse an earlier analysis of identical content (no repeated model calls).
  const [cached] = await db
    .select({ aiOutput: itemAnalyses.aiOutput, aiModel: itemAnalyses.aiModel })
    .from(itemAnalyses)
    .innerJoin(items, eq(items.id, itemAnalyses.itemId))
    .where(and(eq(items.contentHash, origin.item.contentHash), eq(itemAnalyses.aiStatus, "ok")))
    .limit(1);
  if (cached?.aiOutput) {
    await db
      .update(itemAnalyses)
      .set({ aiStatus: "ok", aiModel: cached.aiModel, aiOutput: cached.aiOutput, aiWarnings: ["reused analysis of identical content"] })
      .where(eq(itemAnalyses.itemId, origin.item.id));
    await setStatus("ok");
    return { called: false, ok: true, skipped: "cache_hit" };
  }

  const budget = await checkAiBudget(
    db,
    {
      maxAnalysesPerDay: ctx.config.maxAiAnalysesPerDay,
      maxDailyCostUsd: ctx.config.maxAiDailyCostUsd,
      estimatedCallCostUsd: estimateMaxCallCostUsd(ctx.ai.model, Math.min(AI_MAX_OUTPUT_TOKENS, 1_500)),
    },
    ctx.now(),
  );
  if (!budget.allowed) {
    await setStatus("skipped_budget");
    await db.update(itemAnalyses).set({ aiStatus: "skipped_budget", aiError: budget.reason }).where(eq(itemAnalyses.itemId, origin.item.id));
    return { called: false, ok: false, skipped: "budget" };
  }

  const sourceRow = origin.item.sourceId ? (await loadSourcesByIds(db, [origin.item.sourceId])).get(origin.item.sourceId) : null;
  const ruleCats = (await db.select({ category: eventClassifications.category }).from(eventClassifications).where(eq(eventClassifications.eventId, eventId))).map((r) => r.category);
  const result = await ctx.ai.analyze({
    text: origin.content.text,
    includeDemo: ev.isDemo || ctx.config.includeDemo,
    meta: {
      sourceName: sourceRow?.name ?? origin.item.authorName ?? origin.item.authorHandle ?? "unknown",
      sourceType: sourceRow?.category ?? "unregistered account",
      registeredSource: Boolean(sourceRow),
      publishedAt: origin.item.publishedAt?.toISOString() ?? null,
      rulesCategories: ruleCats,
    },
  });
  if (result.usage) {
    await recordUsage(db, {
      provider: "anthropic",
      operation: "extract",
      units: 1,
      inputTokens: result.usage.inputTokens + result.usage.cacheWriteTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      costUsd: result.usage.costUsd,
      meta: { model: result.model, eventId, ok: result.ok },
      at: ctx.now(),
    });
  } else if (!result.ok && result.kind !== "not_configured") {
    // Failed calls with no usage still count toward the daily call limit.
    await recordUsage(db, { provider: "anthropic", operation: "extract", units: 1, meta: { model: result.model, eventId, ok: false, kind: result.kind }, at: ctx.now() });
  }
  if (result.ok) {
    await db
      .update(itemAnalyses)
      .set({ aiStatus: "ok", aiModel: result.model, aiOutput: result.extraction, aiWarnings: result.warnings, aiError: null })
      .where(eq(itemAnalyses.itemId, origin.item.id));
    await applyAiCategories(db, eventId, result.extraction);
    await setStatus("ok");
    return { called: true, ok: true, skipped: null };
  }
  logger.warn("ai.analysis_failed", { eventId, kind: result.kind, error: result.error });
  await db
    .update(itemAnalyses)
    .set({ aiStatus: `failed_${result.kind}`, aiModel: result.model, aiError: result.error, aiWarnings: result.warnings ?? null })
    .where(eq(itemAnalyses.itemId, origin.item.id));
  await setStatus(`failed_${result.kind}`);
  return { called: true, ok: false, skipped: null };
}

async function applyAiCategories(db: Db, eventId: string, extraction: ValidatedExtraction): Promise<void> {
  for (const category of extraction.categories) {
    await db
      .insert(eventClassifications)
      .values({ eventId, category, score: 0.5, method: "ai", evidence: ["AI classification (validated against allowed categories)"] })
      .onConflictDoNothing();
  }
}

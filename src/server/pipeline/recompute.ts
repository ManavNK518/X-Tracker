import { and, eq, inArray } from "drizzle-orm";
import { SCORING_VERSION, SOURCE_CATEGORY_QUALITY } from "@/config/scoring";
import { CLAIM_NATURE_CATEGORIES, isEventCategory, type EventCategory } from "@/domain/categories";
import { EVIDENCE_ROLES, type ItemRole } from "@/domain/misc";
import { bandRank, type PriorityBandId } from "@/domain/priority";
import { isSourceCategory, type SourceCategory } from "@/domain/sources";
import type { VerificationState } from "@/domain/verification";
import {
  contradictions,
  eventAssets,
  eventClassifications,
  eventItems,
  events,
  itemAnalyses,
  itemContents,
  items,
  scoreRecords,
  sourceReliabilityObservations,
  sources,
  verificationAttempts,
} from "@/server/db/schema";
import { excerpt, textSimilarity } from "@/server/lib/text";
import { getAsset } from "@/config/assets";
import type { ValidatedExtraction } from "@/server/providers/ai/schema";
import { mapAssets, type MappedAsset } from "./assets";
import type { Classification } from "./classify";
import { attributionOf } from "./independence";
import type { EntityMatch, EntityResult } from "./entities";
import { buildAnalysis, buildExplanation, type SourceStatement } from "./explain";
import type { PipelineContext } from "./process";
import { reliabilityStats, trackedUniverse } from "./repo";
import {
  computeConfidence,
  computeImportance,
  detectMagnitudeTerms,
  priorityBand,
  sourceQualityScore,
  type SourceForScoring,
} from "./scoring";
import { deriveLifecycle, deriveVerification, isAuthoritativeFor, type EvidenceItem } from "./verification";

export type ChangeKind = "new" | "update" | "escalation" | "correction";

export interface RecomputeResult {
  eventId: string;
  material: boolean;
  changeKind: ChangeKind;
  materialVersion: number;
  importance: number;
  confidence: number;
  band: PriorityBandId;
  verificationStatus: VerificationState;
  isDemo: boolean;
  changes: string[];
}

const UPGRADE_STATES: ReadonlySet<VerificationState> = new Set(["confirmed", "independently_corroborated", "primary_source_located"]);

export async function recomputeEvent(
  ctx: PipelineContext,
  eventId: string,
  reason: string,
  opts: { isNew: boolean; resurfaced?: boolean; forceMaterial?: boolean; verificationMethod?: string },
): Promise<RecomputeResult> {
  const db = ctx.db;
  const now = ctx.now();
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) throw new Error(`event ${eventId} not found`);

  const rows = await db
    .select({ link: eventItems, item: items, content: itemContents, analysis: itemAnalyses, source: sources })
    .from(eventItems)
    .innerJoin(items, eq(items.id, eventItems.itemId))
    .leftJoin(itemContents, eq(itemContents.itemId, items.id))
    .leftJoin(itemAnalyses, eq(itemAnalyses.itemId, items.id))
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(eq(eventItems.eventId, eventId));
  const origin = rows.find((r) => r.link.role === "origin") ?? rows[0];
  if (!origin) throw new Error(`event ${eventId} has no items`);

  const eventCategories = event.categories.filter(isEventCategory) as EventCategory[];
  const subjectCategories = eventCategories.filter((c) => !CLAIM_NATURE_CATEGORIES.has(c));
  const originText = origin.content?.text ?? "";
  const originOrg = origin.source?.organization?.toLowerCase() ?? null;
  const catOf = (s: typeof sources.$inferSelect | null): SourceCategory => (s && isSourceCategory(s.category) ? s.category : "unknown");

  // --- Verification ------------------------------------------------------------
  const evidenceItems: EvidenceItem[] = rows.map((r) => ({
    role: r.link.role as ItemRole,
    independenceKey: r.link.independenceKey,
    sourceCategory: catOf(r.source),
    isPrimary: r.source?.isPrimary ?? false,
    authorityDomains: (r.source?.authorityDomains ?? []).filter(isEventCategory) as EventCategory[],
    similarityToOrigin: r.link.role === "origin" ? null : r.content ? textSimilarity(r.content.text, originText) : null,
    sameSourceAsOrigin:
      (r.item.sourceId !== null && r.item.sourceId === origin.item.sourceId) ||
      (originOrg !== null && r.source?.organization?.toLowerCase() === originOrg) ||
      (r.item.authorHandle !== null && r.item.authorHandle === origin.item.authorHandle),
  }));

  const openContradictions = await db
    .select({ c: contradictions, source: sources })
    .from(contradictions)
    .leftJoin(items, eq(items.id, contradictions.itemId))
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(and(eq(contradictions.eventId, eventId), eq(contradictions.resolved, false)));
  const contradictionEvidence = openContradictions.map(({ source }) => ({
    fromAuthoritativePrimary: source
      ? isAuthoritativeFor({ isPrimary: source.isPrimary, authorityDomains: source.authorityDomains as EventCategory[] }, eventCategories)
      : false,
    sourceQuality: source ? SOURCE_CATEGORY_QUALITY[catOf(source)] : null,
  }));

  // Could authoritative sources for this category be checked? If every enabled
  // authoritative source is failing, verification could not be completed.
  let authoritativeFailing = 0;
  let authoritativeHealthy = 0;
  if (subjectCategories.length) {
    const authSources = await db
      .select({ status: sources.status, authorityDomains: sources.authorityDomains, enabled: sources.enabled, isDemo: sources.isDemo })
      .from(sources)
      .where(and(eq(sources.isPrimary, true), eq(sources.enabled, true), eq(sources.isDemo, event.isDemo)));
    for (const s of authSources) {
      if (!s.authorityDomains.some((d) => subjectCategories.includes(d as EventCategory))) continue;
      if (s.status === "ok" || s.status === "never_run") authoritativeHealthy++;
      else if (s.status === "error" || s.status === "rate_limited") authoritativeFailing++;
    }
  }
  const lastAttemptFailed = authoritativeFailing > 0 && authoritativeHealthy === 0;

  const resurfaced =
    opts.resurfaced ??
    (origin.item.publishedAt !== null && origin.item.collectedAt.getTime() - origin.item.publishedAt.getTime() > 24 * 3_600_000);

  const verification = deriveVerification({
    eventCategories,
    items: evidenceItems,
    unresolvedContradictions: contradictionEvidence,
    originSourceQuality: origin.source ? SOURCE_CATEGORY_QUALITY[catOf(origin.source)] : null,
    lastActivityAt: event.lastActivityAt,
    now,
    staleAfterHours: ctx.config.staleAfterHours,
    lastAttemptFailed,
    resurfaced,
  });

  // --- Entities and assets -----------------------------------------------------
  const entityRows = rows.filter((r) => EVIDENCE_ROLES.has(r.link.role as ItemRole) || r.link.role === "update" || r.link.role === "correction");
  const entityMap = new Map<string, EntityMatch>();
  for (const r of entityRows) {
    const ent = r.analysis?.entities as EntityResult | null | undefined;
    for (const a of ent?.assets ?? []) {
      const prev = entityMap.get(a.symbol);
      if (!prev || prev.confidence < a.confidence) entityMap.set(a.symbol, a);
    }
  }
  const originEntities = origin.analysis?.entities as EntityResult | null | undefined;
  const ignoredAmbiguous = (originEntities?.ignoredAmbiguous ?? []).map((i) => `${i.matchedText} (${i.reason})`);
  const includeDemo = event.isDemo || ctx.config.includeDemo;
  const textForMapping = entityRows.map((r) => r.content?.text ?? "").join("\n");
  const mapped: MappedAsset[] = mapAssets({ entities: [...entityMap.values()], categories: eventCategories, text: textForMapping, includeDemo });

  const aiOk = origin.analysis?.aiStatus === "ok";
  const ai = aiOk ? (origin.analysis?.aiOutput as ValidatedExtraction) : null;
  for (const a of ai?.assets ?? []) {
    if (mapped.some((m) => m.symbol === a.symbol)) continue;
    const def = getAsset(a.symbol);
    if (def?.demo && !includeDemo) continue;
    mapped.push({
      symbol: a.symbol,
      name: def?.name ?? a.symbol,
      assetClass: def?.assetClass ?? null,
      relation: "sector",
      confidence: 0.3,
      rationale: `AI-suggested (validated against dictionary/text): ${a.rationale || "no rationale given"}`,
      matchedText: null,
      method: "ai",
    });
  }

  // --- Importance ------------------------------------------------------------------
  const classRows = await db.select().from(eventClassifications).where(and(eq(eventClassifications.eventId, eventId), eq(eventClassifications.method, "rules")));
  const scoredCats = eventCategories.map((c) => ({ category: c, score: classRows.find((r) => r.category === c)?.score ?? 0.35 }));
  const originClassification = origin.analysis?.classification as Classification | null | undefined;
  const signals = originClassification?.signals ?? { hedged: false, opinion: false, firstHand: false, correction: false, denial: false };
  // Opinion is commentary, not a new factual event, even when it names a subject.
  const opinionOnly = signals.opinion && !signals.firstHand;

  const sourceIds = rows.map((r) => r.source?.id).filter((x): x is string => Boolean(x));
  const reliability = await reliabilityStats(db, sourceIds);
  let bestSource: SourceForScoring | null = null;
  let bestScore = -1;
  for (const r of rows) {
    if (!r.source || !EVIDENCE_ROLES.has(r.link.role as ItemRole)) continue;
    const candidate: SourceForScoring = {
      category: catOf(r.source),
      name: r.source.name,
      isPrimary: r.source.isPrimary,
      authoritativeForEvent: isAuthoritativeFor(
        { isPrimary: r.source.isPrimary, authorityDomains: r.source.authorityDomains as EventCategory[] },
        eventCategories,
      ),
      reliability: reliability.get(r.source.id) ?? null,
    };
    const q = sourceQualityScore(candidate).score ?? -1;
    if (q > bestScore) {
      bestScore = q;
      bestSource = candidate;
    }
  }

  const universe = await trackedUniverse(db);
  const universeSize = universe.symbols.size + universe.categories.size;
  const directTracked = mapped.filter((m) => m.relation === "direct" && universe.symbols.has(m.symbol.toUpperCase())).map((m) => m.symbol);
  const indirectTracked = mapped.filter((m) => m.relation !== "direct" && universe.symbols.has(m.symbol.toUpperCase())).map((m) => m.symbol);
  const publishedAt = origin.item.publishedAt ?? event.firstPublishedAt ?? null;
  const hasCorrection = rows.some((r) => r.link.role === "correction");

  const importance = computeImportance({
    categories: scoredCats,
    opinionOnly,
    magnitudeTerms: detectMagnitudeTerms(originText),
    bestSource,
    novelty: resurfaced ? "resurfaced" : hasCorrection ? "correction" : "new",
    tracked: {
      universeSize,
      direct: directTracked,
      indirect: indirectTracked,
      categoryMatch: eventCategories.some((c) => universe.categories.has(c)),
    },
    verification: verification.status,
    publishedAt,
    now,
  });

  // --- Confidence --------------------------------------------------------------------
  const originIsAuthoritative = origin.source
    ? isAuthoritativeFor({ isPrimary: origin.source.isPrimary, authorityDomains: origin.source.authorityDomains as EventCategory[] }, eventCategories)
    : false;
  const directness = signals.firstHand || originIsAuthoritative
    ? "first_hand"
    : signals.opinion
      ? "opinion"
      : signals.hedged
        ? "hedged"
        : attributionOf(originText)
          ? "attributed"
          : "plain";
  const confidence = computeConfidence({
    origin: { registered: Boolean(origin.source), isPrimary: origin.source?.isPrimary ?? false, name: origin.source?.name ?? origin.item.authorName ?? origin.item.authorHandle ?? "unknown" },
    directness,
    authoritativeConfirmed: verification.authoritativeConfirmed,
    primaryLocated: verification.primaryLocated,
    independentCount: verification.independentCount,
    evidenceItemCount: evidenceItems.filter((e) => EVIDENCE_ROLES.has(e.role)).length,
    unresolvedContradictions: openContradictions.length,
    entityConfidences: [...entityMap.values()].map((e) => e.confidence),
    resurfaced,
    publishedAt,
    instructionLikeText: (origin.analysis?.filterFlags ?? []).includes("contains_instructions"),
    contradictionSeverity: contradictionEvidence.some((c) => c.fromAuthoritativePrimary)
      ? "authoritative"
      : contradictionEvidence.length > 0
        ? "other"
        : null,
    corrected: verification.status === "corrected",
  });

  const band = priorityBand(importance.total);
  const lifecycle = deriveLifecycle({ verification: verification.status, itemCount: rows.length, firstSeenAt: event.firstSeenAt, now });

  // --- Explanation -------------------------------------------------------------------
  const roleOrder: Record<string, number> = { origin: 0, primary_source: 1, corroboration: 2, correction: 3, contradiction: 4, update: 5, repeat: 6, commentary: 7 };
  const statements: SourceStatement[] = [...rows]
    .sort((a, b) => (roleOrder[a.link.role] ?? 9) - (roleOrder[b.link.role] ?? 9) || a.link.addedAt.getTime() - b.link.addedAt.getTime())
    .slice(0, 12)
    .map((r) => ({
      itemId: r.item.id,
      sourceName: r.source?.name ?? r.item.authorName ?? r.item.authorHandle ?? "Unknown account",
      role: r.link.role,
      excerpt: r.content ? excerpt(r.content.text, 320) : "[content no longer available]",
      url: r.item.url,
      publishedAt: r.item.publishedAt?.toISOString() ?? null,
    }));
  const warnings: string[] = [];
  if ((origin.analysis?.filterFlags ?? []).includes("contains_instructions")) {
    warnings.push("The origin text contains instructions aimed at automated systems. It was treated strictly as untrusted data.");
  }
  if (lastAttemptFailed) warnings.push("Authoritative sources for this category are currently failing; verification could not be completed.");
  const aiStatus = event.aiStatus;
  if (aiStatus.startsWith("failed_")) warnings.push(`AI analysis unavailable (${aiStatus.replace("failed_", "")}); rules-based analysis only.`);
  if (aiStatus === "skipped_budget") warnings.push("AI analysis skipped: daily AI budget reached. Rules-based analysis only.");
  if (event.isDemo) warnings.push("SAMPLE DATA: this event was generated from fictional demo content.");

  const explanation = buildExplanation({
    categories: classRows
      .filter((r) => isEventCategory(r.category))
      .map((r) => ({ category: r.category as EventCategory, score: r.score, evidence: r.evidence }))
      .sort((a, b) => b.score - a.score),
    originSourceName: origin.source?.name ?? origin.item.authorName ?? origin.item.authorHandle ?? "unknown",
    originRegistered: Boolean(origin.source),
    importance,
    confidence,
    verification,
    verificationStatus: verification.status,
    assets: mapped,
    statements,
    warnings,
    ignoredAmbiguous,
  });
  const analysis = buildAnalysis({
    categories: eventCategories,
    assets: mapped,
    verificationStatus: verification.status,
    ai,
    aiModel: aiOk ? (origin.analysis?.aiModel ?? null) : null,
    aiStatus,
    aiWarnings: (origin.analysis?.aiWarnings as string[] | null) ?? [],
  });

  // --- Material change detection -----------------------------------------------------
  const changes: string[] = [];
  const prevBand = event.band as PriorityBandId;
  const prevStatus = event.verificationStatus as VerificationState;
  if (opts.isNew) changes.push("event created");
  // A time-based slide to "stale" is recorded in the audit trail but is not a
  // material change: it must not generate alerts.
  if (!opts.isNew && prevStatus !== verification.status && verification.status !== "stale") {
    changes.push(`verification ${prevStatus} → ${verification.status}`);
  }
  if (!opts.isNew && bandRank(band.id) > bandRank(prevBand)) changes.push(`priority ${prevBand} → ${band.id}`);
  if (!opts.isNew && verification.independentGroups > event.independentSourceCount) {
    changes.push(`independent source groups ${event.independentSourceCount} → ${verification.independentGroups}`);
  }
  const material = opts.isNew || opts.forceMaterial === true || changes.length > 0;

  let changeKind: ChangeKind = "update";
  if (opts.isNew) changeKind = "new";
  else if (verification.status === "corrected" || verification.status === "disputed") changeKind = prevStatus !== verification.status ? "correction" : "update";
  else if (
    (UPGRADE_STATES.has(verification.status) && !UPGRADE_STATES.has(prevStatus)) ||
    (prevStatus !== "confirmed" && verification.status === "confirmed") ||
    bandRank(band.id) > bandRank(prevBand)
  )
    changeKind = "escalation";

  const materialVersion = opts.isNew ? 1 : material ? event.materialVersion + 1 : event.materialVersion;
  const scoreChanged =
    opts.isNew ||
    Math.abs(event.importance - importance.total) >= 3 ||
    Math.abs(event.confidence - confidence.total) >= 3 ||
    prevStatus !== verification.status ||
    prevBand !== band.id;

  await db
    .update(events)
    .set({
      verificationStatus: verification.status,
      lifecycle,
      importance: importance.total,
      importanceCoverage: importance.coverage,
      confidence: confidence.total,
      confidenceCoverage: confidence.coverage,
      band: band.id,
      importanceComponents: importance.components,
      confidenceComponents: confidence.components,
      sourceCount: verification.sourceCount,
      independentSourceCount: verification.independentGroups,
      explanation,
      analysis,
      materialVersion,
      lastVerifiedAt: now,
      updatedAt: now,
    })
    .where(eq(events.id, eventId));

  await db.delete(eventAssets).where(eq(eventAssets.eventId, eventId));
  if (mapped.length) {
    await db.insert(eventAssets).values(
      mapped.map((m) => ({
        eventId,
        symbol: m.symbol,
        name: m.name,
        assetClass: m.assetClass,
        relation: m.relation,
        confidence: m.confidence,
        rationale: m.rationale,
        matchedText: m.matchedText,
        method: m.method,
      })),
    );
  }

  if (scoreChanged) {
    await db.insert(scoreRecords).values({
      eventId,
      importance: importance.total,
      confidence: confidence.total,
      importanceCoverage: importance.coverage,
      confidenceCoverage: confidence.coverage,
      verificationStatus: verification.status,
      band: band.id,
      components: { importance: importance.components, confidence: confidence.components },
      reason: changes.length ? `${reason}; ${changes.join("; ")}` : reason,
      scoringVersion: SCORING_VERSION,
      createdAt: now,
    });
  }
  // Evidence-based reliability observations for the originating source. A
  // dispute is recorded as "unresolved" (a denial is not proof the claim was
  // wrong); only authoritative confirmation or a correction resolve it.
  if (
    !opts.isNew &&
    prevStatus !== verification.status &&
    origin.source &&
    !originIsAuthoritative &&
    (verification.status === "confirmed" || verification.status === "corrected" || verification.status === "disputed")
  ) {
    await db.insert(sourceReliabilityObservations).values({
      sourceId: origin.source.id,
      category: event.primaryCategory,
      outcome: verification.status === "confirmed" ? "confirmed" : verification.status === "corrected" ? "corrected" : "unresolved",
      eventId,
      note: `Automatic: event ${event.ref} became “${verification.status}” (${verification.criteriaMet.join("; ") || "criteria met"}).`,
      recordedBy: "system",
    });
  }

  if (opts.isNew || prevStatus !== verification.status || (lastAttemptFailed && opts.verificationMethod)) {
    await db.insert(verificationAttempts).values({
      eventId,
      attemptedAt: now,
      method: opts.verificationMethod ?? "evidence_analysis",
      status: lastAttemptFailed ? "partial" : "completed",
      resultStatus: verification.status,
      details: {
        criteriaMet: verification.criteriaMet,
        reasons: verification.reasons,
        independentCount: verification.independentCount,
        sourceCount: verification.sourceCount,
        authoritativeSourcesHealthy: authoritativeHealthy,
        authoritativeSourcesFailing: authoritativeFailing,
      },
      error: lastAttemptFailed ? "authoritative sources for this category are failing" : null,
    });
  }

  return {
    eventId,
    material,
    changeKind,
    materialVersion,
    importance: importance.total,
    confidence: confidence.total,
    band: band.id,
    verificationStatus: verification.status,
    isDemo: event.isDemo,
    changes,
  };
}

/** Re-evaluates active events (staleness, source health) on a schedule. */
export async function reverifyActiveEvents(ctx: PipelineContext, hours = 72, limit = 200): Promise<{ checked: number; changed: number; results: RecomputeResult[] }> {
  const since = new Date(ctx.now().getTime() - hours * 3_600_000);
  const rows = await ctx.db
    .select({ id: events.id, status: events.verificationStatus })
    .from(events)
    .where(and(inArray(events.verificationStatus, ["unverified", "primary_source_located", "unable_to_verify", "independently_corroborated", "disputed"])))
    .limit(limit);
  const results: RecomputeResult[] = [];
  let changed = 0;
  for (const r of rows) {
    const [ev] = await ctx.db.select({ lastActivityAt: events.lastActivityAt }).from(events).where(eq(events.id, r.id));
    if (!ev || ev.lastActivityAt < since) continue;
    const result = await recomputeEvent(ctx, r.id, "scheduled re-verification", { isNew: false, verificationMethod: "scheduled_reverification" });
    if (result.material) {
      changed++;
      results.push(result);
    }
  }
  return { checked: rows.length, changed, results };
}

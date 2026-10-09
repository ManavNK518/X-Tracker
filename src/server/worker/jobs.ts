import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Env } from "@/config/env";
import type { ProviderId } from "@/domain/sources";
import type { Db } from "@/server/db/client";
import {
  alertDecisions,
  appState,
  collectionRules,
  events,
  itemContents,
  items,
  notifications,
  pipelineRuns,
  providerHealth,
  sessions,
  sources,
  usageRecords,
} from "@/server/db/schema";
import { evaluateAlerts, processDeliveries } from "@/server/alerts/engine";
import { publish } from "@/server/lib/bus";
import { errorMessage, logger } from "@/server/lib/logger";
import { recordUsage, usageToday } from "@/server/pipeline/budget";
import { ingestItems, processPending, queueDepth, type PipelineContext } from "@/server/pipeline/process";
import { reverifyActiveEvents } from "@/server/pipeline/recompute";
import { toSourceRef } from "@/server/pipeline/repo";
import { DEMO_SOURCES } from "@/server/providers/source/demo/fixtures";
import { DemoProvider } from "@/server/providers/source/demo/provider";
import { RssProvider } from "@/server/providers/source/rss/provider";
import type { CollectResult, SourceProvider } from "@/server/providers/source/types";
import { XClient, xPostUrl } from "@/server/providers/source/x/client";
import { XProvider, refreshPostAvailability, toItem, type XCollectResult } from "@/server/providers/source/x/provider";
import { buildAccountQueries } from "@/server/providers/source/x/client";
import { runFilteredStream, syncStreamRules } from "@/server/providers/source/x/stream";
import { getNotifiers } from "@/server/runtime";

export interface JobContext {
  pipeline: PipelineContext;
  env: Env;
  signal: AbortSignal;
}

export interface JobResult {
  status: "ok" | "error" | "skipped";
  stats: Record<string, unknown>;
  error?: string;
}

// ---------------------------------------------------------------------------
// Provider health
// ---------------------------------------------------------------------------

export async function setProviderHealth(
  db: Db,
  provider: string,
  update: { status: string; error?: string | null; success?: boolean; rateLimit?: { remaining: number | null; resetAt: Date | null } | null; details?: Record<string, unknown> },
  now = new Date(),
) {
  const base = {
    status: update.status,
    updatedAt: now,
    ...(update.success ? { lastSuccessAt: now, consecutiveFailures: 0 } : {}),
    ...(update.error ? { lastErrorAt: now, lastError: update.error.slice(0, 500) } : {}),
    ...(update.rateLimit ? { rateLimitRemaining: update.rateLimit.remaining, rateLimitResetAt: update.rateLimit.resetAt } : {}),
    ...(update.details ? { details: update.details } : {}),
  };
  await db
    .insert(providerHealth)
    .values({ provider, ...base, consecutiveFailures: update.error && !update.success ? 1 : 0 })
    .onConflictDoUpdate({
      target: providerHealth.provider,
      set: {
        ...base,
        ...(update.error && !update.success ? { consecutiveFailures: sql`${providerHealth.consecutiveFailures} + 1` } : {}),
      },
    });
}

// ---------------------------------------------------------------------------
// Demo setup
// ---------------------------------------------------------------------------

export async function getDemoRun(db: Db): Promise<{ runId: string; startedAt: Date } | null> {
  const [row] = await db.select().from(appState).where(eq(appState.key, "demo_run"));
  if (!row) return null;
  const v = row.value as { runId: string; startedAt: string };
  return { runId: v.runId, startedAt: new Date(v.startedAt) };
}

export async function ensureDemo(db: Db, now = new Date()): Promise<{ runId: string; startedAt: Date }> {
  for (const s of DEMO_SOURCES) {
    await db
      .insert(sources)
      .values({
        provider: "demo",
        externalId: s.handle,
        handle: s.handle,
        name: s.name,
        category: s.category,
        isPrimary: s.isPrimary,
        authorityDomains: s.authorityDomains,
        organization: s.organization,
        topics: ["sample data"],
        enabled: true,
        isDemo: true,
        notes: "SAMPLE DATA — fictional source used by demo mode.",
      })
      .onConflictDoNothing({ target: [sources.provider, sources.externalId] });
  }
  const existing = await getDemoRun(db);
  if (existing) return existing;
  const run = { runId: randomUUID().slice(0, 8), startedAt: now };
  await db
    .insert(appState)
    .values({ key: "demo_run", value: { runId: run.runId, startedAt: run.startedAt.toISOString() } })
    .onConflictDoNothing();
  return (await getDemoRun(db)) ?? run;
}

/** Removes all sample data and starts a new demo run. */
export async function resetDemo(db: Db, now = new Date()): Promise<void> {
  await db.delete(notifications).where(eq(notifications.isDemo, true));
  await db.delete(events).where(eq(events.isDemo, true));
  await db.delete(items).where(eq(items.isDemo, true));
  await db.delete(appState).where(eq(appState.key, "demo_run"));
  await ensureDemo(db, now);
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

async function buildProvider(job: JobContext, provider: ProviderId): Promise<SourceProvider> {
  const env = job.env;
  if (provider === "rss") {
    return new RssProvider({ enabled: env.RSS_ENABLED, userAgent: env.RSS_USER_AGENT, secUserAgent: env.SEC_USER_AGENT });
  }
  if (provider === "x") {
    return new XProvider({
      bearerToken: env.X_BEARER_TOKEN,
      baseUrl: env.X_API_BASE_URL,
      maxResultsPerQuery: env.X_MAX_RESULTS_PER_QUERY,
      maxQueriesPerRun: Math.max(1, Math.ceil(env.MAX_SOURCE_QUERIES_PER_HOUR / Math.max(1, Math.floor(3600 / env.X_POLL_SECONDS)))),
    });
  }
  const run = await ensureDemo(job.pipeline.db);
  return new DemoProvider({ enabled: env.DEMO_MODE, intervalSeconds: env.DEMO_INTERVAL_SECONDS, runStartedAt: run.startedAt, runId: run.runId });
}

async function xRequestsLastHour(db: Db, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${usageRecords.units}), 0)::int` })
    .from(usageRecords)
    .where(and(eq(usageRecords.provider, "x"), eq(usageRecords.operation, "request"), gte(usageRecords.createdAt, new Date(now.getTime() - 3_600_000))));
  return Number(row?.n ?? 0);
}

export async function collectJob(job: JobContext, providerId: ProviderId): Promise<JobResult> {
  const db = job.pipeline.db;
  const now = job.pipeline.now();
  const env = job.env;
  const provider = await buildProvider(job, providerId);
  const configured = provider.configured();

  const sourceRows = await db
    .select()
    .from(sources)
    .where(and(eq(sources.provider, providerId), eq(sources.enabled, true)));

  if (!configured.ok) {
    if (providerId === "x" && sourceRows.length) {
      await db
        .update(sources)
        .set({ status: "awaiting_credentials", lastError: configured.reason ?? null, updatedAt: now })
        .where(and(eq(sources.provider, "x"), eq(sources.enabled, true)));
    }
    await setProviderHealth(db, providerId, { status: providerId === "demo" ? "disabled" : "not_configured", details: { reason: configured.reason } }, now);
    return { status: "skipped", stats: { reason: configured.reason } };
  }

  const depth = await queueDepth(db);
  if (depth >= env.MAX_QUEUE_DEPTH) {
    await setProviderHealth(db, providerId, { status: "degraded", details: { reason: `backpressure: ${depth} items queued` } }, now);
    return { status: "skipped", stats: { reason: "backpressure", queueDepth: depth } };
  }

  let readBudget = Number.MAX_SAFE_INTEGER;
  const rules: { id: string; name: string; query: string; maxResults: number; sinceId: string | null }[] = [];
  if (providerId === "x") {
    const used = await usageToday(db, "x", "post_read", now);
    readBudget = Math.max(0, env.X_MAX_POST_READS_PER_DAY - used.units);
    const queriesUsed = await xRequestsLastHour(db, now);
    if (readBudget < 10 || queriesUsed >= env.MAX_SOURCE_QUERIES_PER_HOUR) {
      const reason = readBudget < 10 ? `daily X read budget reached (${used.units}/${env.X_MAX_POST_READS_PER_DAY})` : `hourly X query limit reached (${queriesUsed}/${env.MAX_SOURCE_QUERIES_PER_HOUR})`;
      await setProviderHealth(db, "x", { status: "degraded", details: { reason } }, now);
      return { status: "skipped", stats: { reason } };
    }
    const ruleRows = await db.select().from(collectionRules).where(and(eq(collectionRules.provider, "x"), eq(collectionRules.enabled, true)));
    for (const r of ruleRows) {
      if (r.lastRunAt && now.getTime() - r.lastRunAt.getTime() < r.intervalSeconds * 1000) continue;
      rules.push({ id: r.id, name: r.name, query: r.query, maxResults: r.maxResults, sinceId: r.sinceId });
    }
  }

  const refs = sourceRows.map(toSourceRef);
  let result: CollectResult;
  try {
    result = await provider.collect({ sources: refs, rules, now, signal: job.signal, readBudget });
  } catch (error) {
    const message = errorMessage(error);
    await setProviderHealth(db, providerId, { status: "error", error: message }, now);
    return { status: "error", stats: {}, error: message };
  }

  const ingest = await ingestItems(job.pipeline, result.items);

  // Persist per-source outcomes and provider cursors.
  const configUpdates = new Map(((result as XCollectResult).sourceConfigUpdates ?? []).map((u) => [u.sourceId, u.config]));
  for (const outcome of result.sourceOutcomes) {
    const row = sourceRows.find((s) => s.id === outcome.sourceId);
    if (!row) continue;
    const config = { ...(configUpdates.get(row.id) ?? row.config) } as Record<string, unknown>;
    if (outcome.etag !== undefined) config.etag = outcome.etag ?? undefined;
    if (outcome.lastModified !== undefined) config.lastModified = outcome.lastModified ?? undefined;
    await db
      .update(sources)
      .set({
        status: outcome.ok ? "ok" : (outcome.status ?? "error"),
        lastAttemptAt: now,
        ...(outcome.ok ? { lastSuccessAt: now, lastError: null, consecutiveErrors: 0 } : { lastError: outcome.error ?? "collection failed", consecutiveErrors: row.consecutiveErrors + 1 }),
        config,
        updatedAt: now,
      })
      .where(eq(sources.id, row.id));
  }
  for (const r of result.ruleOutcomes) {
    await db
      .update(collectionRules)
      .set({ lastRunAt: now, lastError: r.ok ? null : (r.error ?? "failed"), ...(r.newestId ? { sinceId: r.newestId } : {}), updatedAt: now })
      .where(eq(collectionRules.id, r.ruleId));
  }

  if (providerId === "x" && result.requests > 0) {
    await recordUsage(db, { provider: "x", operation: "request", units: result.requests, at: now });
    if (result.postsRead) await recordUsage(db, { provider: "x", operation: "post_read", units: result.postsRead, costUsd: result.postsRead * env.X_POST_READ_COST_USD, at: now });
    if (result.usersRead) await recordUsage(db, { provider: "x", operation: "user_read", units: result.usersRead, costUsd: result.usersRead * env.X_USER_READ_COST_USD, at: now });
  }

  const okCount = result.sourceOutcomes.filter((o) => o.ok).length + result.ruleOutcomes.filter((o) => o.ok).length;
  const failCount = result.sourceOutcomes.filter((o) => !o.ok && o.status !== "awaiting_credentials").length + result.ruleOutcomes.filter((o) => !o.ok).length;
  const firstError = [...result.sourceOutcomes, ...result.ruleOutcomes].find((o) => !o.ok && "error" in o)?.error ?? null;
  await setProviderHealth(
    db,
    providerId,
    {
      status: failCount === 0 ? "ok" : okCount > 0 ? "degraded" : "error",
      success: okCount > 0,
      error: failCount > 0 ? firstError : null,
      rateLimit: result.rateLimit ?? null,
      details: { lastRunItems: result.items.length, inserted: ingest.inserted, duplicates: ingest.duplicates, ok: okCount, failed: failCount },
    },
    now,
  );
  if (ingest.inserted > 0) {
    await db.insert(appState).values({ key: "first_collection_at", value: now.toISOString() }).onConflictDoNothing();
  }
  publish({ type: "status.changed" });
  return {
    status: failCount > 0 && okCount === 0 ? "error" : "ok",
    stats: { fetched: result.items.length, inserted: ingest.inserted, duplicates: ingest.duplicates, requests: result.requests, postsRead: result.postsRead, ok: okCount, failed: failCount },
    error: failCount > 0 && okCount === 0 ? (firstError ?? undefined) : undefined,
  };
}

// ---------------------------------------------------------------------------
// X filtered stream (optional mode)
// ---------------------------------------------------------------------------

export async function xStreamJob(job: JobContext): Promise<JobResult> {
  const db = job.pipeline.db;
  const env = job.env;
  if (!env.X_BEARER_TOKEN) {
    await setProviderHealth(db, "x", { status: "not_configured", details: { reason: "X_BEARER_TOKEN not set" } });
    return { status: "skipped", stats: { reason: "not configured" } };
  }
  const used = await usageToday(db, "x", "post_read");
  let budget = env.X_MAX_POST_READS_PER_DAY - used.units;
  if (budget <= 0) return { status: "skipped", stats: { reason: "daily X read budget reached" } };
  const accountRows = await db.select().from(sources).where(and(eq(sources.provider, "x"), eq(sources.enabled, true)));
  const ruleRows = await db.select().from(collectionRules).where(and(eq(collectionRules.provider, "x"), eq(collectionRules.enabled, true)));
  const desired = [
    ...buildAccountQueries(accountRows.map((s) => s.handle).filter((h): h is string => Boolean(h)), 1024).map((value, i) => ({ value, tag: `accounts-${i}` })),
    ...ruleRows.map((r) => ({ value: r.query, tag: `rule-${r.id}` })),
  ].slice(0, 1000);
  if (desired.length === 0) return { status: "skipped", stats: { reason: "no enabled X sources or rules" } };
  await syncStreamRules({ bearerToken: env.X_BEARER_TOKEN, baseUrl: env.X_API_BASE_URL }, desired);
  const byHandle = new Map(accountRows.map((s) => [s.handle?.toLowerCase(), toSourceRef(s)]));
  let delivered = 0;
  const outcome = await runFilteredStream({
    bearerToken: env.X_BEARER_TOKEN,
    baseUrl: env.X_API_BASE_URL,
    signal: job.signal,
    onStatus: (s) => void setProviderHealth(db, "x", { status: s.state === "connected" ? "ok" : s.state === "stopped" ? "degraded" : "degraded", success: s.state === "connected", details: { stream: s.state, detail: s.detail } }),
    onPost: async ({ post, users }) => {
      const author = post.author_id ? users.get(post.author_id) : undefined;
      const src = author ? (byHandle.get(author.username.toLowerCase()) ?? null) : null;
      const item = toItem(post, src, users);
      item.url = xPostUrl(post.id, author?.username);
      await ingestItems(job.pipeline, [item]);
      await recordUsage(db, { provider: "x", operation: "post_read", units: 1, costUsd: env.X_POST_READ_COST_USD });
      delivered++;
      budget--;
      return budget > 0;
    },
  });
  return { status: "ok", stats: { delivered, reason: outcome.reason } };
}

// ---------------------------------------------------------------------------
// Analysis, verification, delivery, maintenance
// ---------------------------------------------------------------------------

export async function analyzeJob(job: JobContext): Promise<JobResult> {
  const stats = await processPending(job.pipeline);
  if (stats.processed > 0) {
    await setProviderHealth(job.pipeline.db, "pipeline", { status: stats.failed > 0 ? "degraded" : "ok", success: true, details: { lastBatch: stats } });
    if (stats.aiCalls > 0) await setProviderHealth(job.pipeline.db, "ai", { status: "ok", success: true });
  }
  return { status: stats.failed > 0 && stats.processed === 0 ? "error" : "ok", stats: stats as unknown as Record<string, unknown> };
}

export async function reverifyJob(job: JobContext): Promise<JobResult> {
  const result = await reverifyActiveEvents(job.pipeline);
  for (const r of result.results) await evaluateAlerts(job.pipeline, r);
  return { status: "ok", stats: { checked: result.checked, changed: result.changed } };
}

export async function deliverJob(job: JobContext): Promise<JobResult> {
  const out = await processDeliveries(job.pipeline.db, getNotifiers(job.env), job.pipeline.now());
  return { status: "ok", stats: out };
}

export async function maintenanceJob(job: JobContext): Promise<JobResult> {
  const db = job.pipeline.db;
  const now = job.pipeline.now();
  // 1) Retention: purge expired third-party content; keep event metadata.
  const expired = await db
    .select({ itemId: itemContents.itemId })
    .from(itemContents)
    .where(lt(itemContents.retentionExpiresAt, now))
    .limit(1_000);
  if (expired.length) {
    const ids = expired.map((e) => e.itemId);
    await db.delete(itemContents).where(inArray(itemContents.itemId, ids));
    await db.update(items).set({ contentStatus: "expired" }).where(inArray(items.id, ids));
  }
  // 2) Sessions.
  const deletedSessions = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
  // 3) Operational history pruning.
  await db.delete(pipelineRuns).where(lt(pipelineRuns.startedAt, new Date(now.getTime() - 14 * 86_400_000)));
  await db.delete(alertDecisions).where(lt(alertDecisions.createdAt, new Date(now.getTime() - 30 * 86_400_000)));
  return { status: "ok", stats: { purgedContent: expired.length, deletedSessions: deletedSessions.length } };
}

/**
 * Crash recovery, run once at worker start (never concurrently with the
 * analysis job): items left in "processing" by a previous process go back to
 * the queue, and runs left "running" are closed.
 */
export async function recoverAfterRestart(db: Db): Promise<{ items: number; runs: number }> {
  const reset = await db.update(items).set({ processingState: "pending" }).where(eq(items.processingState, "processing")).returning({ id: items.id });
  const runs = await db
    .update(pipelineRuns)
    .set({ status: "error", error: "interrupted by restart", finishedAt: new Date() })
    .where(eq(pipelineRuns.status, "running"))
    .returning({ id: pipelineRuns.id });
  return { items: reset.length, runs: runs.length };
}

/**
 * X compliance refresh: re-checks stored posts and purges content that is no
 * longer available (deleted / protected / withheld). Each lookup is a billed
 * read, so it runs within the daily X read budget.
 */
export async function xComplianceJob(job: JobContext): Promise<JobResult> {
  const env = job.env;
  const db = job.pipeline.db;
  const now = job.pipeline.now();
  if (!env.X_BEARER_TOKEN || env.X_COMPLIANCE_REFRESH_HOURS === 0) return { status: "skipped", stats: { reason: "not configured or disabled" } };
  const used = await usageToday(db, "x", "post_read", now);
  const budget = Math.min(100, env.X_MAX_POST_READS_PER_DAY - used.units);
  if (budget <= 0) return { status: "skipped", stats: { reason: "daily X read budget reached" } };
  const cutoff = new Date(now.getTime() - env.X_COMPLIANCE_REFRESH_HOURS * 3_600_000);
  const due = await db
    .select({ id: items.id, externalId: items.externalId })
    .from(items)
    .where(
      and(
        eq(items.provider, "x"),
        eq(items.contentStatus, "available"),
        lt(items.collectedAt, cutoff),
        or(isNull(items.lastRefreshedAt), lt(items.lastRefreshedAt, cutoff)),
      ),
    )
    .limit(budget);
  if (due.length === 0) return { status: "ok", stats: { checked: 0 } };
  const client = new XClient(env.X_BEARER_TOKEN, env.X_API_BASE_URL);
  const res = await refreshPostAvailability(client, due.map((d) => d.externalId), job.signal);
  await recordUsage(db, { provider: "x", operation: "post_read", units: res.reads, costUsd: res.reads * env.X_POST_READ_COST_USD, meta: { purpose: "compliance" }, at: now });
  await recordUsage(db, { provider: "x", operation: "request", units: Math.ceil(due.length / 100), at: now });
  const unavailableIds = due.filter((d) => res.unavailable.includes(d.externalId)).map((d) => d.id);
  if (unavailableIds.length) {
    await db.delete(itemContents).where(inArray(itemContents.itemId, unavailableIds));
    await db.update(items).set({ contentStatus: "unavailable", lastRefreshedAt: now }).where(inArray(items.id, unavailableIds));
  }
  const availableIds = due.filter((d) => res.available.includes(d.externalId)).map((d) => d.id);
  if (availableIds.length) await db.update(items).set({ lastRefreshedAt: now }).where(inArray(items.id, availableIds));
  logger.info("x.compliance_refresh", { checked: due.length, unavailable: unavailableIds.length });
  return { status: "ok", stats: { checked: due.length, purged: unavailableIds.length } };
}

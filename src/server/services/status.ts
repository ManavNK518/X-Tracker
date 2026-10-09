import { and, desc, eq, gte, isNull, max, sql } from "drizzle-orm";
import { integrationStatus, type Env } from "@/config/env";
import type { ConnectionStateDTO } from "@/domain/dto";
import { PROVIDER_LABELS, type ProviderId } from "@/domain/sources";
import type { AuthUser } from "@/server/auth/session";
import type { Db } from "@/server/db/client";
import { getDbHandle } from "@/server/db/client";
import {
  alertDecisions,
  appState,
  eventItems,
  events,
  failedJobs,
  itemAnalyses,
  items,
  notificationDeliveries,
  pipelineRuns,
  providerHealth,
  scoreRecords,
  sources,
  usageRecords,
  verificationAttempts,
  workerHeartbeats,
} from "@/server/db/schema";
import { usageToday } from "@/server/pipeline/budget";
import { getNotifiers } from "@/server/runtime";
import { findEventId } from "./events";

const WORKER_STALE_MS = 90_000;

export async function getConnectionState(db: Db, env: Env, now = new Date()): Promise<ConnectionStateDTO> {
  const health = await db.select().from(providerHealth);
  const beats = await db.select().from(workerHeartbeats);
  const lastBeat = beats.reduce<Date | null>((m, b) => (!m || b.lastBeatAt > m ? b.lastBeatAt : m), null);
  const workerAlive = Boolean(lastBeat && now.getTime() - lastBeat.getTime() < WORKER_STALE_MS);
  const integ = integrationStatus(env);
  const get = (p: string) => health.find((h) => h.provider === p);
  const freshWithin = (p: ProviderId) => (p === "rss" ? env.RSS_POLL_SECONDS * 3 : p === "x" ? env.X_POLL_SECONDS * 3 : 120) * 1000;

  const providers: ConnectionStateDTO["providers"] = (["rss", "x", "demo"] as ProviderId[]).map((p) => {
    const h = get(p);
    const configured = p === "rss" ? integ.rss : p === "x" ? integ.x : integ.demo;
    const fresh = Boolean(h?.lastSuccessAt && now.getTime() - h.lastSuccessAt.getTime() < Math.max(freshWithin(p), 30 * 60_000));
    let status: string;
    if (!configured) status = p === "demo" ? "off" : "not_configured";
    else if (!workerAlive) status = "worker_offline";
    else if (!h) status = "starting";
    else if (h.status === "error" && !fresh) status = "error";
    else if (fresh) status = h.status === "ok" ? "connected" : "degraded";
    else status = "stale";
    return {
      provider: p,
      label: PROVIDER_LABELS[p],
      status,
      lastSuccessAt: h?.lastSuccessAt?.toISOString() ?? null,
      lastError: h?.lastError ?? null,
      configured,
      origin: p === "demo" ? "demo" : status === "connected" || status === "degraded" ? (p === "rss" ? `live (polled every ${Math.round(env.RSS_POLL_SECONDS / 60)} min)` : "live") : "disconnected",
    };
  });
  const liveConnected = providers.some((p) => p.provider !== "demo" && (p.status === "connected" || p.status === "degraded"));
  const anyLiveConfigured = providers.some((p) => p.provider !== "demo" && p.configured);
  const mode: ConnectionStateDTO["mode"] =
    liveConnected && env.DEMO_MODE
      ? "live+demo"
      : liveConnected
        ? "live"
        : env.DEMO_MODE
          ? "demo"
          : anyLiveConfigured
            ? "disconnected"
            : "awaiting_configuration";
  return { mode, providers, workerAlive, workerLastBeatAt: lastBeat?.toISOString() ?? null, demoMode: env.DEMO_MODE };
}

export async function getStatus(db: Db, env: Env, auth: AuthUser) {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const handle = await getDbHandle();
  const connection = await getConnectionState(db, env, now);
  const integrations = integrationStatus(env);

  const [queue] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${items.processingState} = 'pending')::int`,
      processing: sql<number>`count(*) filter (where ${items.processingState} = 'processing')::int`,
      failed: sql<number>`count(*) filter (where ${items.processingState} = 'failed')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(items);

  const stageCounts = await db
    .select({ outcome: itemAnalyses.outcome, n: sql<number>`count(*)::int` })
    .from(itemAnalyses)
    .where(gte(itemAnalyses.processedAt, dayAgo))
    .groupBy(itemAnalyses.outcome);
  const decisionCounts = await db
    .select({ decision: alertDecisions.decision, n: sql<number>`count(*)::int` })
    .from(alertDecisions)
    .where(and(gte(alertDecisions.createdAt, dayAgo), eq(alertDecisions.userId, auth.id)))
    .groupBy(alertDecisions.decision);
  const [collected24h] = await db.select({ n: sql<number>`count(*)::int` }).from(items).where(gte(items.collectedAt, dayAgo));

  const health = await db.select().from(providerHealth).orderBy(providerHealth.provider);
  const sourceSummary = await db
    .select({ provider: sources.provider, status: sources.status, enabled: sources.enabled, n: sql<number>`count(*)::int` })
    .from(sources)
    .groupBy(sources.provider, sources.status, sources.enabled);
  const workers = await db.select().from(workerHeartbeats);
  const runs = await db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.startedAt)).limit(40);
  const openFailures = await db.select().from(failedJobs).where(isNull(failedJobs.resolvedAt)).orderBy(desc(failedJobs.createdAt)).limit(25);
  const [lastAi] = await db.select({ at: max(itemAnalyses.processedAt) }).from(itemAnalyses).where(eq(itemAnalyses.aiStatus, "ok"));
  const aiFailures = await db
    .select({ status: itemAnalyses.aiStatus, n: sql<number>`count(*)::int` })
    .from(itemAnalyses)
    .where(and(gte(itemAnalyses.processedAt, dayAgo), sql`${itemAnalyses.aiStatus} like 'failed_%' or ${itemAnalyses.aiStatus} = 'skipped_budget'`))
    .groupBy(itemAnalyses.aiStatus);

  const aiToday = await usageToday(db, "anthropic", "extract", now);
  const xReads = await usageToday(db, "x", "post_read", now);
  const xUsers = await usageToday(db, "x", "user_read", now);
  const deliveryStats = await db
    .select({ channel: notificationDeliveries.channel, status: notificationDeliveries.status, n: sql<number>`count(*)::int` })
    .from(notificationDeliveries)
    .where(gte(notificationDeliveries.createdAt, dayAgo))
    .groupBy(notificationDeliveries.channel, notificationDeliveries.status);
  const recentDeliveryFailures = await db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.status, "failed"))
    .orderBy(desc(notificationDeliveries.updatedAt))
    .limit(10);

  const notifiers = getNotifiers(env);
  const channels = notifiers.map((n) => {
    const h = health.find((x) => x.provider === `notify:${n.channel}`);
    return {
      channel: n.channel,
      configured: n.configured(),
      state: !n.configured() ? "not_configured" : h?.verifiedAt ? (h.status === "error" ? "failing" : "verified") : h?.status === "error" ? "failing" : "configured_unverified",
      verifiedAt: h?.verifiedAt?.toISOString() ?? null,
      lastError: h?.lastError ?? null,
    };
  });

  const isOwner = auth.role === "owner";
  return {
    generatedAt: now.toISOString(),
    connection,
    database: { kind: handle.kind, ok: true },
    integrations,
    providers: health.map((h) => ({
      provider: h.provider,
      status: h.status,
      lastSuccessAt: h.lastSuccessAt?.toISOString() ?? null,
      lastErrorAt: h.lastErrorAt?.toISOString() ?? null,
      lastError: isOwner ? h.lastError : h.lastError ? "error (details visible to the owner)" : null,
      consecutiveFailures: h.consecutiveFailures,
      rateLimitRemaining: h.rateLimitRemaining,
      rateLimitResetAt: h.rateLimitResetAt?.toISOString() ?? null,
      details: isOwner ? h.details : {},
    })),
    sources: sourceSummary.map((s) => ({ ...s, n: Number(s.n) })),
    workers: workers.map((w) => ({
      workerId: w.workerId,
      mode: w.mode,
      startedAt: w.startedAt.toISOString(),
      lastBeatAt: w.lastBeatAt.toISOString(),
      alive: now.getTime() - w.lastBeatAt.getTime() < WORKER_STALE_MS,
      info: w.info,
    })),
    queue: { pending: Number(queue.pending), processing: Number(queue.processing), failed: Number(queue.failed), total: Number(queue.total), maxDepth: env.MAX_QUEUE_DEPTH },
    funnel24h: {
      collected: Number(collected24h.n),
      outcomes: Object.fromEntries(stageCounts.map((s) => [s.outcome, Number(s.n)])),
      alertDecisions: Object.fromEntries(decisionCounts.map((d) => [d.decision, Number(d.n)])),
    },
    runs: runs.map((r) => ({
      id: r.id,
      job: r.job,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
      stats: r.stats,
      error: isOwner ? r.error : r.error ? "error" : null,
    })),
    failedJobs: openFailures.map((f) => ({ id: f.id, job: f.job, refId: f.refId, error: isOwner ? f.error : "error", attempts: f.attempts, createdAt: f.createdAt.toISOString() })),
    ai: {
      configured: integrations.ai,
      model: integrations.ai ? env.AI_MODEL : null,
      lastSuccessfulAnalysisAt: lastAi?.at?.toISOString() ?? null,
      today: aiToday,
      limits: { maxAnalysesPerDay: env.MAX_AI_ANALYSES_PER_DAY, maxDailyCostUsd: env.MAX_AI_DAILY_COST_USD, minScoreForAi: env.MIN_SCORE_FOR_AI },
      paused:
        aiToday.calls >= env.MAX_AI_ANALYSES_PER_DAY
          ? "daily analysis limit reached"
          : aiToday.costUsd >= env.MAX_AI_DAILY_COST_USD
            ? "daily cost budget reached"
            : null,
      failures24h: Object.fromEntries(aiFailures.map((f) => [f.status, Number(f.n)])),
    },
    x: {
      configured: integrations.x,
      mode: env.X_COLLECTION_MODE,
      postReadsToday: xReads.units,
      userReadsToday: xUsers.units,
      estimatedCostToday: xReads.costUsd + xUsers.costUsd,
      dailyReadBudget: env.X_MAX_POST_READS_PER_DAY,
      maxQueriesPerHour: env.MAX_SOURCE_QUERIES_PER_HOUR,
    },
    notifications: {
      channels,
      last24h: deliveryStats.map((d) => ({ ...d, n: Number(d.n) })),
      recentFailures: recentDeliveryFailures.map((d) => ({ id: d.id, channel: d.channel, attempts: d.attempts, lastError: d.lastError, updatedAt: d.updatedAt.toISOString() })),
    },
    marketData: {
      status: "not_connected",
      note: "No market-data provider is configured. Event studies require an authorized price-data source (see docs/MARKET_DATA.md).",
    },
  };
}

/**
 * Explains what happened to a post or event in the pipeline, so a missing
 * alert can be attributed to: no posts, collection failure, a filter rule, an
 * AI failure, a threshold, a verification requirement or a delivery failure.
 */
export async function trace(db: Db, auth: AuthUser, query: string) {
  const q = query.trim();
  const diagnosis: string[] = [];
  let eventId = await findEventId(db, q);
  let item: typeof items.$inferSelect | null = null;
  if (!eventId) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(q);
    const [row] = await db
      .select()
      .from(items)
      .where(isUuid ? eq(items.id, q) : eq(items.externalId, q))
      .limit(1);
    item = row ?? null;
  }
  let analysis: typeof itemAnalyses.$inferSelect | null = null;
  if (item) {
    [analysis] = await db.select().from(itemAnalyses).where(eq(itemAnalyses.itemId, item.id));
    const [link] = await db.select().from(eventItems).where(eq(eventItems.itemId, item.id));
    if (link) eventId = link.eventId;
    diagnosis.push(`Collected ${item.collectedAt.toISOString()} from provider "${item.provider}" (published ${item.publishedAt?.toISOString() ?? "unknown"}).`);
    if (item.processingState !== "done") diagnosis.push(`Processing state: ${item.processingState} (${item.processingAttempts} attempt(s)).`);
    if (analysis) {
      const reasons: Record<string, string> = {
        filtered_spam: "Discarded at stage 1 (spam/promotion filter).",
        filtered_low_info: "Discarded at stage 1 (low-information filter).",
        filtered_irrelevant: "Discarded at stage 2 (no market-relevant category and no related event).",
        duplicate: "Identical to content already attached to an event (duplicate).",
        attached: "Attached to an existing event.",
        new_event: "Created a new event.",
        content_unavailable: "Content was unavailable when processed.",
      };
      diagnosis.push(reasons[analysis.outcome] ?? `Outcome: ${analysis.outcome}`);
      if (analysis.filterReason) diagnosis.push(`Filter detail: ${analysis.filterReason}`);
      if (analysis.aiStatus.startsWith("failed_")) diagnosis.push(`AI analysis failed (${analysis.aiStatus}): ${analysis.aiError ?? ""}`);
      if (analysis.aiStatus === "skipped_budget") diagnosis.push(`AI analysis skipped because of the daily budget.`);
    }
  }

  let eventInfo: Record<string, unknown> | null = null;
  if (eventId) {
    const [ev] = await db.select().from(events).where(eq(events.id, eventId));
    const decisions = await db
      .select()
      .from(alertDecisions)
      .where(and(eq(alertDecisions.eventId, eventId), eq(alertDecisions.userId, auth.id)))
      .orderBy(desc(alertDecisions.createdAt))
      .limit(20);
    const attempts = await db.select().from(verificationAttempts).where(eq(verificationAttempts.eventId, eventId)).orderBy(desc(verificationAttempts.attemptedAt)).limit(5);
    const [scoreCount] = await db.select({ n: sql<number>`count(*)::int` }).from(scoreRecords).where(eq(scoreRecords.eventId, eventId));
    const linked = await db
      .select({ role: eventItems.role, itemId: eventItems.itemId, note: eventItems.note })
      .from(eventItems)
      .where(eq(eventItems.eventId, eventId));
    eventInfo = {
      id: ev.id,
      ref: ev.ref,
      title: ev.title,
      importance: ev.importance,
      confidence: ev.confidence,
      verificationStatus: ev.verificationStatus,
      materialVersion: ev.materialVersion,
      aiStatus: ev.aiStatus,
      items: linked,
      scoreRecords: Number(scoreCount.n),
      verificationAttempts: attempts.map((a) => ({ at: a.attemptedAt.toISOString(), method: a.method, status: a.status, result: a.resultStatus, error: a.error })),
      alertDecisions: decisions.map((d) => ({ at: d.createdAt.toISOString(), version: d.materialVersion, decision: d.decision, reasons: d.reasons })),
    };
    diagnosis.push(`Event ${ev.ref}: importance ${ev.importance}, confidence ${ev.confidence}, verification "${ev.verificationStatus}".`);
    if (decisions.length === 0) {
      diagnosis.push("No alert evaluation is recorded for you: alerts are evaluated when an event is created or changes materially.");
    } else {
      const latest = decisions[0];
      const text: Record<string, string> = {
        notified: "You were notified.",
        below_threshold: "No alert: none of your rules/watchlists matched.",
        no_rules: "No alert: you have no enabled alert rules or notifying watchlists.",
        suppressed_cooldown: "No alert: suppressed by the cooldown for this event.",
        suppressed_rate_limit: "No alert: hourly alert limit reached.",
        suppressed_duplicate: "No alert: this version was already notified.",
        suppressed_late: "No alert: the event was detected long after publication.",
      };
      diagnosis.push(`${text[latest.decision] ?? latest.decision} ${latest.reasons.join(" | ")}`);
    }
    const notifIds = await db
      .select({ id: notificationDeliveries.id, status: notificationDeliveries.status, channel: notificationDeliveries.channel, lastError: notificationDeliveries.lastError })
      .from(notificationDeliveries)
      .where(sql`${notificationDeliveries.notificationId} in (select id from notifications where event_id = ${eventId} and user_id = ${auth.id})`);
    for (const d of notifIds.filter((d) => d.status === "failed")) diagnosis.push(`Delivery via ${d.channel} failed: ${d.lastError ?? "unknown error"}`);
    eventInfo.deliveries = notifIds;
  }
  if (!item && !eventId) diagnosis.push("No post or event matches this identifier. If you expected one, check the Sources status for collection failures.");
  return {
    query: q,
    item: item
      ? {
          id: item.id,
          provider: item.provider,
          externalId: item.externalId,
          collectedAt: item.collectedAt.toISOString(),
          publishedAt: item.publishedAt?.toISOString() ?? null,
          processingState: item.processingState,
          contentStatus: item.contentStatus,
        }
      : null,
    analysis: analysis
      ? {
          outcome: analysis.outcome,
          flags: analysis.filterFlags,
          reason: analysis.filterReason,
          classification: analysis.classification,
          aiStatus: analysis.aiStatus,
          aiError: analysis.aiError,
          role: analysis.role,
        }
      : null,
    event: eventInfo,
    diagnosis,
  };
}

export async function usageByDay(db: Db, days = 14) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      day: usageRecords.day,
      provider: usageRecords.provider,
      operation: usageRecords.operation,
      units: sql<number>`sum(${usageRecords.units})::int`,
      inputTokens: sql<number>`sum(${usageRecords.inputTokens})::int`,
      outputTokens: sql<number>`sum(${usageRecords.outputTokens})::int`,
      costUsd: sql<string>`sum(${usageRecords.costUsd})::text`,
    })
    .from(usageRecords)
    .where(gte(usageRecords.day, since))
    .groupBy(usageRecords.day, usageRecords.provider, usageRecords.operation)
    .orderBy(usageRecords.day);
  return rows.map((r) => ({ ...r, units: Number(r.units), inputTokens: Number(r.inputTokens), outputTokens: Number(r.outputTokens), costUsd: Number(r.costUsd) }));
}

export async function firstCollectionAt(db: Db): Promise<string | null> {
  const [row] = await db.select().from(appState).where(eq(appState.key, "first_collection_at"));
  return (row?.value as string | undefined) ?? null;
}

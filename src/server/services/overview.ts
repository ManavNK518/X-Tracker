import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { Env } from "@/config/env";
import type { Db } from "@/server/db/client";
import { eventAssets, events, itemAnalyses, items, notifications, pipelineRuns } from "@/server/db/schema";
import { hydrateEvents } from "./events";
import { listNotifications } from "./notifications";
import { firstCollectionAt, getConnectionState } from "./status";

/**
 * Overview aggregates. Every number comes from stored data; nothing is
 * synthesised to fill empty space. Empty states are returned as zeros/empty
 * arrays and rendered as such.
 */
export async function getOverview(db: Db, env: Env, userId: string, opts: { includeDemo: boolean; period: "24h" | "7d" }) {
  const now = new Date();
  const periodMs = opts.period === "24h" ? 86_400_000 : 7 * 86_400_000;
  const since = new Date(now.getTime() - periodMs);
  const demoCond: SQL[] = opts.includeDemo ? [] : [eq(events.isDemo, false)];
  const ts = sql`coalesce(${events.firstPublishedAt}, ${events.firstSeenAt})`;
  const inPeriod = and(gte(events.firstSeenAt, since), ...demoCond);

  const [counts] = await db
    .select({
      events: sql<number>`count(*)::int`,
      highPriority: sql<number>`count(*) filter (where ${events.importance} >= 60)::int`,
      verified: sql<number>`count(*) filter (where ${events.verificationStatus} in ('confirmed','independently_corroborated','primary_source_located'))::int`,
      disputed: sql<number>`count(*) filter (where ${events.verificationStatus} in ('disputed','corrected'))::int`,
    })
    .from(events)
    .where(inPeriod);
  const [itemCounts] = await db
    .select({
      collected: sql<number>`count(*)::int`,
    })
    .from(items)
    .where(and(gte(items.collectedAt, since), ...(opts.includeDemo ? [] : [eq(items.isDemo, false)])));
  const [filtered] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(itemAnalyses)
    .innerJoin(items, eq(items.id, itemAnalyses.itemId))
    .where(
      and(
        gte(itemAnalyses.processedAt, since),
        inArray(itemAnalyses.outcome, ["filtered_spam", "filtered_low_info", "filtered_irrelevant", "duplicate"]),
        ...(opts.includeDemo ? [] : [eq(items.isDemo, false)]),
      ),
    );

  const recentWindow = new Date(now.getTime() - Math.max(periodMs, 72 * 3_600_000));
  const latestHigh = await db
    .select()
    .from(events)
    .where(and(gte(events.firstSeenAt, recentWindow), gte(events.importance, 60), ...demoCond))
    .orderBy(desc(events.importance), desc(ts))
    .limit(6);
  const recentVerified = await db
    .select()
    .from(events)
    .where(and(gte(events.firstSeenAt, recentWindow), inArray(events.verificationStatus, ["confirmed", "independently_corroborated"]), ...demoCond))
    .orderBy(desc(ts))
    .limit(6);
  const macro = await db
    .select()
    .from(events)
    .where(and(gte(events.firstSeenAt, recentWindow), inArray(events.primaryCategory, ["monetary_policy", "economic_data"]), ...demoCond))
    .orderBy(desc(ts))
    .limit(5);

  const themes = await db
    .select({ category: events.primaryCategory, n: sql<number>`count(*)::int`, avgImportance: sql<number>`round(avg(${events.importance}))::int` })
    .from(events)
    .where(inPeriod)
    .groupBy(events.primaryCategory)
    .orderBy(desc(sql`count(*)`));

  const topAssets = await db
    .select({ symbol: eventAssets.symbol, name: sql<string>`min(${eventAssets.name})`, n: sql<number>`count(*)::int` })
    .from(eventAssets)
    .innerJoin(events, eq(events.id, eventAssets.eventId))
    .where(and(inPeriod, eq(eventAssets.relation, "direct")))
    .groupBy(eventAssets.symbol)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  const unit = opts.period === "24h" ? "hour" : "day";
  // Buckets are computed in UTC and returned as epoch milliseconds.
  const bucketOf = (col: SQL | typeof events.firstSeenAt | typeof notifications.createdAt) =>
    sql<string>`(extract(epoch from date_trunc(${unit}, ${col} at time zone 'UTC')) * 1000)::bigint::text`;
  const eventBuckets = await db
    .select({ bucket: bucketOf(events.firstSeenAt), n: sql<number>`count(*)::int` })
    .from(events)
    .where(inPeriod)
    .groupBy(sql`1`);
  const notifBuckets = await db
    .select({ bucket: bucketOf(notifications.createdAt), n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), gte(notifications.createdAt, since), ...(opts.includeDemo ? [] : [eq(notifications.isDemo, false)])))
    .groupBy(sql`1`);
  const bucketCount = opts.period === "24h" ? 24 : 7;
  const stepMs = opts.period === "24h" ? 3_600_000 : 86_400_000;
  const truncNow = new Date(Math.floor(now.getTime() / stepMs) * stepMs);
  const evMap = new Map(eventBuckets.map((b) => [Number(b.bucket), Number(b.n)]));
  const ntMap = new Map(notifBuckets.map((b) => [Number(b.bucket), Number(b.n)]));
  const volume = Array.from({ length: bucketCount }, (_, i) => {
    const start = truncNow.getTime() - (bucketCount - 1 - i) * stepMs;
    return { bucketStart: new Date(start).toISOString(), events: evMap.get(start) ?? 0, notifications: ntMap.get(start) ?? 0 };
  });

  const runs = await db
    .select()
    .from(pipelineRuns)
    .where(and(gte(pipelineRuns.startedAt, since), sql`${pipelineRuns.job} like 'collect:%' or ${pipelineRuns.status} = 'error'`))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(12);
  const recentEvents = await db.select().from(events).where(inPeriod).orderBy(desc(events.firstSeenAt)).limit(12);
  const activity = [
    ...recentEvents.map((e) => ({
      at: e.firstSeenAt.toISOString(),
      kind: "event" as const,
      text: e.title,
      ref: e.ref,
      href: `/events/${e.id}`,
      status: e.verificationStatus,
      isDemo: e.isDemo,
      importance: e.importance,
    })),
    ...runs.map((r) => ({
      at: r.startedAt.toISOString(),
      kind: "run" as const,
      text: `${r.job}: ${r.status}${r.error ? ` — ${r.error.slice(0, 120)}` : r.stats && typeof r.stats === "object" && "inserted" in r.stats ? ` — ${String((r.stats as Record<string, unknown>).inserted)} new item(s)` : ""}`,
      ref: null,
      href: "/status",
      status: r.status,
      isDemo: false,
      importance: null,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 15);

  const [hydratedHigh, hydratedVerified, hydratedMacro] = await Promise.all([
    hydrateEvents(db, userId, latestHigh),
    hydrateEvents(db, userId, recentVerified),
    hydrateEvents(db, userId, macro),
  ]);

  return {
    period: opts.period,
    generatedAt: now.toISOString(),
    counts: {
      events: Number(counts.events),
      highPriority: Number(counts.highPriority),
      verified: Number(counts.verified),
      disputed: Number(counts.disputed),
      itemsCollected: Number(itemCounts.collected),
      itemsFiltered: Number(filtered.n),
    },
    latestHighPriority: hydratedHigh,
    recentVerified: hydratedVerified,
    macro: hydratedMacro,
    themes: themes.map((t) => ({ category: t.category, count: Number(t.n), avgImportance: Number(t.avgImportance) })),
    topAssets: topAssets.map((a) => ({ symbol: a.symbol, name: a.name, count: Number(a.n) })),
    volume,
    watchlistAlerts: (await listNotifications(db, userId, { limit: 6 })).filter((n) => opts.includeDemo || !n.isDemo),
    activity,
    connection: await getConnectionState(db, env, now),
    firstCollectionAt: await firstCollectionAt(db),
  };
}

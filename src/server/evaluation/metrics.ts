import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { eventAssets, eventItems, events, feedback, items } from "@/server/db/schema";

/**
 * Evaluation metrics from stored events and optional user feedback. Metrics
 * are only reported when enough labelled data exists; otherwise they are
 * marked insufficient instead of being estimated. Recall is not reported: it
 * requires a defensible labelled set of all relevant events, which this
 * installation does not have.
 */
export const MIN_LABELS = 20;

export interface Metric {
  value: number | null;
  n: number;
  note: string;
}

export async function computeMetrics(db: Db, opts: { days: number; includeDemo: boolean }) {
  const since = new Date(Date.now() - opts.days * 86_400_000);
  const demo = opts.includeDemo ? [] : [eq(events.isDemo, false)];

  const labels = await db
    .select({ label: feedback.label, n: sql<number>`count(distinct ${feedback.eventId})::int` })
    .from(feedback)
    .innerJoin(events, eq(events.id, feedback.eventId))
    .where(and(gte(feedback.createdAt, since), ...demo))
    .groupBy(feedback.label);
  const count = (l: string) => Number(labels.find((x) => x.label === l)?.n ?? 0);
  const useful = count("useful");
  const irrelevant = count("irrelevant");
  const incorrect = count("incorrect");
  const duplicate = count("duplicate");
  const late = count("late");
  const labelled = useful + irrelevant + incorrect + duplicate + late + count("missing_context");

  const ratio = (num: number, den: number, note: string): Metric =>
    den >= MIN_LABELS ? { value: num / den, n: den, note } : { value: null, n: den, note: `insufficient labelled data (${den}/${MIN_LABELS})` };

  const [latency] = await db
    .select({
      p50: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${items.collectedAt} - ${items.publishedAt})))`,
      p90: sql<number | null>`percentile_cont(0.9) within group (order by extract(epoch from (${items.collectedAt} - ${items.publishedAt})))`,
      n: sql<number>`count(*)::int`,
    })
    .from(eventItems)
    .innerJoin(items, eq(items.id, eventItems.itemId))
    .innerJoin(events, eq(events.id, eventItems.eventId))
    .where(and(eq(eventItems.role, "origin"), gte(events.firstSeenAt, since), sql`${items.publishedAt} is not null`, ...demo));

  const [coverage] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withPublished: sql<number>`count(*) filter (where ${events.firstPublishedAt} is not null)::int`,
      withAssets: sql<number>`count(*) filter (where exists (select 1 from ${eventAssets} ea where ea.event_id = ${events.id}))::int`,
      corroborated: sql<number>`count(*) filter (where ${events.verificationStatus} in ('confirmed','independently_corroborated'))::int`,
      withUrl: sql<number>`count(*) filter (where exists (select 1 from ${items} it where it.id = ${events.originItemId} and it.url is not null))::int`,
    })
    .from(events)
    .where(and(gte(events.firstSeenAt, since), ...demo));

  const calib = await db
    .select({
      bucket: sql<string>`case when ${events.confidence} < 40 then 'low (<40)' when ${events.confidence} < 70 then 'medium (40–69)' else 'high (≥70)' end`,
      labelled: sql<number>`count(distinct ${feedback.eventId})::int`,
      incorrect: sql<number>`count(distinct ${feedback.eventId}) filter (where ${feedback.label} = 'incorrect')::int`,
    })
    .from(feedback)
    .innerJoin(events, eq(events.id, feedback.eventId))
    .where(and(gte(feedback.createdAt, since), ...demo))
    .groupBy(sql`1`);

  const total = Number(coverage.total);
  const share = (n: number) => (total > 0 ? n / total : null);
  return {
    windowDays: opts.days,
    labelledEvents: labelled,
    precision: ratio(useful, useful + irrelevant + incorrect, "useful ÷ (useful + irrelevant + incorrect)"),
    falsePositiveRate: ratio(irrelevant + incorrect, useful + irrelevant + incorrect, "(irrelevant + incorrect) ÷ judged events"),
    duplicateRate: ratio(duplicate, labelled, "duplicate labels ÷ labelled events"),
    lateRate: ratio(late, labelled, "late labels ÷ labelled events"),
    recall: { value: null, n: 0, note: "not reported: requires a labelled set of all relevant events" } as Metric,
    detectionLatencySeconds: {
      p50: latency.p50 === null ? null : Number(latency.p50),
      p90: latency.p90 === null ? null : Number(latency.p90),
      n: Number(latency.n),
      note: "collection time minus publication time for event-originating items",
    },
    coverage: {
      events: total,
      publishedTimestamp: share(Number(coverage.withPublished)),
      assets: share(Number(coverage.withAssets)),
      originalUrl: share(Number(coverage.withUrl)),
    },
    corroborationRate: share(Number(coverage.corroborated)),
    calibration: calib.map((c) => ({
      bucket: c.bucket,
      labelled: Number(c.labelled),
      incorrectRate: Number(c.labelled) >= 10 ? Number(c.incorrect) / Number(c.labelled) : null,
      note: Number(c.labelled) >= 10 ? "share of labelled events marked incorrect" : "insufficient labels (<10)",
    })),
  };
}

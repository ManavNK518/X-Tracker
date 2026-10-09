import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import {
  alertDecisions,
  alertRules,
  eventAssets,
  eventItems,
  events,
  itemContents,
  items,
  notificationDeliveries,
  notifications,
  providerHealth,
  sources,
  userPreferences,
  users,
  watchlistAssets,
  watchlists,
} from "@/server/db/schema";
import { publish } from "@/server/lib/bus";
import { errorMessage, logger } from "@/server/lib/logger";
import type { AlertPayload, Notifier } from "@/server/providers/notify/types";
import type { PipelineContext } from "@/server/pipeline/process";
import type { RecomputeResult } from "@/server/pipeline/recompute";
import type { Explanation, EventAnalysis } from "@/server/pipeline/explain";
import type { ScoreComponent } from "@/server/pipeline/scoring";
import { matchRule, quietHoursStatus, type AlertEventView, type RuleView } from "./match";

const EXTERNAL_CHANNELS = new Set(["email", "telegram", "discord"]);
const DELIVERY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];
export const MAX_DELIVERY_ATTEMPTS = 4;

export interface AlertEvaluationStats {
  notified: number;
  decisions: Record<string, number>;
}

async function loadEventView(db: Db, eventId: string) {
  const [ev] = await db.select().from(events).where(eq(events.id, eventId));
  if (!ev) return null;
  const assets = await db.select({ symbol: eventAssets.symbol, relation: eventAssets.relation }).from(eventAssets).where(eq(eventAssets.eventId, eventId));
  const linked = await db
    .select({ role: eventItems.role, sourceId: items.sourceId, url: items.url, authorName: items.authorName, authorHandle: items.authorHandle, text: itemContents.text, sourceName: sources.name, sourceCategory: sources.category })
    .from(eventItems)
    .innerJoin(items, eq(items.id, eventItems.itemId))
    .leftJoin(itemContents, eq(itemContents.itemId, items.id))
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(eq(eventItems.eventId, eventId));
  const origin = linked.find((l) => l.role === "origin") ?? linked[0];
  const timeComp = (ev.importanceComponents as ScoreComponent[]).find((c) => c.id === "time_sensitivity");
  const view: AlertEventView = {
    id: ev.id,
    importance: ev.importance,
    confidence: ev.confidence,
    band: ev.band,
    verificationStatus: ev.verificationStatus,
    categories: ev.categories,
    assetSymbols: assets.map((a) => a.symbol),
    originSourceCategory: origin?.sourceCategory ?? "unknown",
    evidenceSourceIds: linked.map((l) => l.sourceId).filter((x): x is string => Boolean(x)),
    timeSensitivity: timeComp?.score ?? null,
    isDemo: ev.isDemo,
    text: `${ev.title}\n${ev.summary}\n${origin?.text ?? ""}`.toLowerCase(),
  };
  return { ev, view, origin, assets };
}

export function buildPayload(
  ev: typeof events.$inferSelect,
  origin: { url: string | null; sourceName: string | null; authorName: string | null; authorHandle: string | null } | undefined,
  assets: { symbol: string; relation: string }[],
  kind: string,
  changes: string[],
  appUrl: string,
): AlertPayload {
  const explanation = ev.explanation as Partial<Explanation>;
  const analysis = ev.analysis as Partial<EventAnalysis>;
  const direct = assets.filter((a) => a.relation === "direct").map((a) => a.symbol);
  const others = assets.filter((a) => a.relation !== "direct").map((a) => a.symbol);
  return {
    eventId: ev.id,
    eventRef: ev.ref,
    kind,
    title: ev.title,
    category: ev.primaryCategory,
    importance: ev.importance,
    confidence: ev.confidence,
    band: ev.band,
    verification: ev.verificationStatus,
    assets: [...direct, ...others].slice(0, 8),
    sourceName: origin?.sourceName ?? origin?.authorName ?? origin?.authorHandle ?? "Unknown source",
    sourceUrl: origin?.url ?? null,
    eventTime: ev.firstPublishedAt?.toISOString() ?? null,
    summary: ev.summary.length > 280 ? `${ev.summary.slice(0, 279)}…` : ev.summary,
    whyItMatters: analysis.transmission?.[0] ?? explanation.whyAssets?.[0] ?? "Potential relevance not established.",
    keyUncertainty: explanation.unverified?.[0] ?? analysis.keyUncertainties?.[0] ?? "Market interpretation and reaction remain uncertain.",
    investigationUrl: `${appUrl.replace(/\/$/, "")}/events/${ev.id}`,
    isDemo: ev.isDemo,
    changes,
  };
}

async function rulesForUser(db: Db, userId: string): Promise<RuleView[]> {
  const rules = await db.select().from(alertRules).where(and(eq(alertRules.userId, userId), eq(alertRules.enabled, true)));
  const lists = await db.select().from(watchlists).where(and(eq(watchlists.userId, userId), eq(watchlists.notify, true)));
  const listAssets = lists.length
    ? await db.select().from(watchlistAssets).where(inArray(watchlistAssets.watchlistId, lists.map((l) => l.id)))
    : [];
  const views: RuleView[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    kind: "rule",
    minImportance: r.minImportance,
    minConfidence: r.minConfidence,
    categories: r.categories,
    assetSymbols: r.assetSymbols,
    sourceCategories: r.sourceCategories,
    verificationStates: r.verificationStates,
    requireTimeSensitive: r.requireTimeSensitive,
    includeDemo: r.includeDemo,
    channels: r.channels,
    cooldownMinutes: r.cooldownMinutes,
    keywords: [],
    sourceIds: [],
  }));
  for (const l of lists) {
    views.push({
      id: l.id,
      name: `Watchlist: ${l.name}`,
      kind: "watchlist",
      minImportance: l.minImportance,
      minConfidence: l.minConfidence,
      categories: l.categories,
      assetSymbols: listAssets.filter((a) => a.watchlistId === l.id).map((a) => a.symbol),
      sourceCategories: [],
      verificationStates: [],
      requireTimeSensitive: false,
      includeDemo: true,
      channels: l.channels,
      cooldownMinutes: null,
      keywords: l.keywords,
      sourceIds: l.sourceIds,
    });
  }
  return views;
}

export async function evaluateAlerts(ctx: PipelineContext, result: RecomputeResult): Promise<AlertEvaluationStats> {
  const db = ctx.db;
  const now = ctx.now();
  const stats: AlertEvaluationStats = { notified: 0, decisions: {} };
  const loaded = await loadEventView(db, result.eventId);
  if (!loaded) return stats;
  const { ev, view, origin, assets } = loaded;

  const record = async (userId: string, decision: string, reasons: string[]) => {
    stats.decisions[decision] = (stats.decisions[decision] ?? 0) + 1;
    await db.insert(alertDecisions).values({ eventId: ev.id, userId, materialVersion: result.materialVersion, decision, reasons: reasons.slice(0, 12) });
  };

  const late =
    result.changeKind === "new" &&
    ev.firstPublishedAt !== null &&
    ev.firstSeenAt.getTime() - ev.firstPublishedAt.getTime() > ctx.config.alerts.maxAgeHours * 3_600_000;

  const userRows = await db.select({ user: users, prefs: userPreferences }).from(users).leftJoin(userPreferences, eq(userPreferences.userId, users.id));
  for (const { user, prefs } of userRows) {
    if (late) {
      await record(user.id, "suppressed_late", [`first detected more than ${ctx.config.alerts.maxAgeHours}h after publication; shown in the feed without an alert`]);
      continue;
    }
    const rules = await rulesForUser(db, user.id);
    if (rules.length === 0) {
      await record(user.id, "no_rules", ["no enabled alert rules or notifying watchlists"]);
      continue;
    }
    const results = rules.map((r) => ({ rule: r, match: matchRule(view, r) }));
    const matched = results.filter((r) => r.match.matched);
    if (matched.length === 0) {
      await record(
        user.id,
        "below_threshold",
        results.slice(0, 4).map((r) => `${r.rule.name}: ${r.match.reasons.slice(0, 3).join(", ")}`),
      );
      continue;
    }

    const urgent = result.changeKind === "escalation" || result.changeKind === "correction";
    const cooldown = Math.min(...matched.map((m) => m.rule.cooldownMinutes ?? ctx.config.alerts.cooldownMinutes));
    const [last] = await db
      .select({ createdAt: notifications.createdAt })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.eventId, ev.id)))
      .orderBy(desc(notifications.createdAt))
      .limit(1);
    if (last && !urgent && now.getTime() - last.createdAt.getTime() < cooldown * 60_000) {
      await record(user.id, "suppressed_cooldown", [`an alert for this event was sent within the ${cooldown}-minute cooldown`]);
      continue;
    }
    const [{ n: lastHour }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), gte(notifications.createdAt, new Date(now.getTime() - 3_600_000))));
    if (Number(lastHour) >= ctx.config.alerts.maxPerHour && ev.band !== "critical") {
      await record(user.id, "suppressed_rate_limit", [`hourly alert limit (${ctx.config.alerts.maxPerHour}) reached; only critical alerts pass`]);
      continue;
    }

    const payload = buildPayload(ev, origin, assets, result.changeKind, result.changes, ctx.config.appUrl);
    const [notification] = await db
      .insert(notifications)
      .values({
        userId: user.id,
        eventId: ev.id,
        ruleIds: matched.filter((m) => m.rule.kind === "rule").map((m) => m.rule.id),
        kind: result.changeKind,
        title: ev.title,
        payload,
        dedupeKey: `${ev.id}:v${result.materialVersion}`,
        materialVersion: result.materialVersion,
        isDemo: ev.isDemo,
        createdAt: now,
      })
      .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
      .returning({ id: notifications.id });
    if (!notification) {
      await record(user.id, "suppressed_duplicate", ["this version of the event was already notified"]);
      continue;
    }

    const enabled = (prefs?.channels ?? { in_app: true }) as Record<string, boolean>;
    const wanted = new Set<string>(["in_app", ...matched.flatMap((m) => m.rule.channels)]);
    const qh = quietHoursStatus(now, prefs?.timezone ?? "UTC", prefs?.quietHours ?? { enabled: false, start: "22:00", end: "07:00", allowCritical: true });
    const deliveries: (typeof notificationDeliveries.$inferInsert)[] = [];
    for (const channel of wanted) {
      if (channel === "in_app") {
        deliveries.push({ notificationId: notification.id, channel, status: "sent", attempts: 1, deliveredAt: now });
        continue;
      }
      if (!enabled[channel]) continue;
      if (channel === "browser") {
        deliveries.push({ notificationId: notification.id, channel, status: "handed_to_client", attempts: 1 });
        continue;
      }
      if (!EXTERNAL_CHANNELS.has(channel)) continue;
      if (ev.isDemo) {
        deliveries.push({ notificationId: notification.id, channel, status: "skipped", lastError: "sample data is never sent to external channels" });
        continue;
      }
      if (user.role !== "owner") {
        deliveries.push({ notificationId: notification.id, channel, status: "skipped", lastError: "external channels are configured for the workspace owner only" });
        continue;
      }
      if (qh.active && !(ev.band === "critical" && prefs?.quietHours.allowCritical)) {
        deliveries.push({ notificationId: notification.id, channel, status: "deferred", nextAttemptAt: qh.endsAt });
      } else {
        deliveries.push({ notificationId: notification.id, channel, status: "pending", nextAttemptAt: now });
      }
    }
    if (deliveries.length) await db.insert(notificationDeliveries).values(deliveries);
    await record(user.id, "notified", matched.map((m) => `${m.rule.name}: ${m.match.reasons.join(", ")}`));
    stats.notified++;
    publish({ type: "notification.created", userId: user.id, notificationId: notification.id });
  }
  return stats;
}

/** Sends pending external deliveries with bounded retries. */
export async function processDeliveries(db: Db, notifiers: Notifier[], now = new Date()): Promise<{ sent: number; failed: number; retried: number }> {
  const out = { sent: 0, failed: 0, retried: 0 };
  const due = await db
    .select({ d: notificationDeliveries, payload: notifications.payload })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
    .where(
      and(
        inArray(notificationDeliveries.status, ["pending", "deferred"]),
        or(isNull(notificationDeliveries.nextAttemptAt), lte(notificationDeliveries.nextAttemptAt, now)),
      ),
    )
    .limit(50);
  for (const { d, payload } of due) {
    const notifier = notifiers.find((n) => n.channel === d.channel);
    if (!notifier || !notifier.configured()) {
      await db
        .update(notificationDeliveries)
        .set({ status: "failed", attempts: d.attempts + 1, lastError: "channel is not configured on the server", updatedAt: now })
        .where(eq(notificationDeliveries.id, d.id));
      out.failed++;
      continue;
    }
    try {
      await notifier.send(payload as AlertPayload);
      await db
        .update(notificationDeliveries)
        .set({ status: "sent", attempts: d.attempts + 1, deliveredAt: now, lastError: null, updatedAt: now })
        .where(eq(notificationDeliveries.id, d.id));
      await markChannelHealth(db, d.channel, true, null, now);
      out.sent++;
    } catch (error) {
      const attempts = d.attempts + 1;
      const message = errorMessage(error);
      const final = attempts >= MAX_DELIVERY_ATTEMPTS;
      await db
        .update(notificationDeliveries)
        .set({
          status: final ? "failed" : "pending",
          attempts,
          lastError: message.slice(0, 300),
          nextAttemptAt: final ? null : new Date(now.getTime() + DELIVERY_BACKOFF_MS[Math.min(attempts - 1, DELIVERY_BACKOFF_MS.length - 1)]),
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, d.id));
      await markChannelHealth(db, d.channel, false, message, now);
      logger.warn("notify.delivery_failed", { channel: d.channel, attempts, final, error: message });
      if (final) out.failed++;
      else out.retried++;
    }
  }
  return out;
}

export async function markChannelHealth(db: Db, channel: string, ok: boolean, error: string | null, now = new Date(), verified = false) {
  const provider = `notify:${channel}`;
  await db
    .insert(providerHealth)
    .values({
      provider,
      status: ok ? "ok" : "error",
      lastSuccessAt: ok ? now : null,
      lastErrorAt: ok ? null : now,
      lastError: error,
      consecutiveFailures: ok ? 0 : 1,
      verifiedAt: verified ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: providerHealth.provider,
      set: ok
        ? { status: "ok", lastSuccessAt: now, consecutiveFailures: 0, updatedAt: now, ...(verified ? { verifiedAt: now } : {}) }
        : { status: "error", lastErrorAt: now, lastError: error, consecutiveFailures: sql`${providerHealth.consecutiveFailures} + 1`, updatedAt: now },
    });
}

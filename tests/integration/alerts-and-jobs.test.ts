import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  alertDecisions,
  alertRules,
  events,
  itemAnalyses,
  itemContents,
  items,
  notificationDeliveries,
  notifications,
  pipelineRuns,
  providerHealth,
  sources,
  usageRecords,
  userPreferences,
  users,
} from "@/server/db/schema";
import { ingestItems, processPending } from "@/server/pipeline/process";
import { recomputeEvent } from "@/server/pipeline/recompute";
import { evaluateAlerts, processDeliveries } from "@/server/alerts/engine";
import { collectJob, maintenanceJob } from "@/server/worker/jobs";
import type { AnalysisProvider, AnalysisRequest, AnalysisResult } from "@/server/providers/ai/types";
import type { Notifier } from "@/server/providers/notify/types";
import type { NormalizedItem } from "@/server/providers/source/types";
import { getEnv, resetEnvCache } from "@/config/env";
import { setupTestDb, testContext } from "../helpers/db";

const now = new Date("2026-10-08T15:00:00Z");

function liveItem(id: string, text: string, sourceId: string | null, overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    provider: "rss",
    externalId: id,
    sourceId,
    authorHandle: null,
    authorName: "Test source",
    authorExternalId: null,
    url: `https://source.example/${id}`,
    title: null,
    text,
    lang: "en",
    publishedAt: new Date(now.getTime() - 10 * 60_000),
    referenced: [],
    isDemo: false,
    ...overrides,
  };
}

describe("alerting engine (real database)", () => {
  let handle: Awaited<ReturnType<typeof setupTestDb>>;
  let userId: string;
  let fedSource: string;

  beforeAll(async () => {
    handle = await setupTestDb({ seed: true });
    const [u] = await handle.db.insert(users).values({ email: "owner@test.test", passwordHash: "x", displayName: "Owner", role: "owner" }).returning();
    userId = u.id;
    await handle.db.insert(userPreferences).values({ userId, channels: { in_app: true, discord: true } });
    await handle.db.insert(alertRules).values({ userId, name: "High", minImportance: 60, channels: ["in_app", "discord"] });
    const [fed] = await handle.db.select().from(sources).where(eq(sources.externalId, "https://www.federalreserve.gov/feeds/press_all.xml"));
    fedSource = fed.id;
  });
  afterAll(async () => handle.close());

  it("creates one notification with delivery records for a matching event", async () => {
    const ctx = testContext(handle.db, { now: () => now });
    await ingestItems(ctx, [liveItem("fomc-1", "FOMC statement: the Committee decided to lower the target range for the federal funds rate by 25 basis points.", fedSource)]);
    await processPending(ctx);
    const notes = await handle.db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe("new");
    const payload = notes[0].payload as Record<string, unknown>;
    expect(payload).toMatchObject({ verification: "confirmed", sourceUrl: "https://source.example/fomc-1" });
    expect(String(payload.investigationUrl)).toContain(`/events/${notes[0].eventId}`);
    const deliveries = await handle.db.select().from(notificationDeliveries).where(eq(notificationDeliveries.notificationId, notes[0].id));
    expect(deliveries.map((d) => `${d.channel}:${d.status}`).sort()).toEqual(["discord:pending", "in_app:sent"]);
  });

  it("suppresses duplicates for the same event version", async () => {
    const ctx = testContext(handle.db, { now: () => now });
    const [n] = await handle.db.select().from(notifications).where(eq(notifications.userId, userId));
    const stats = await evaluateAlerts(ctx, { eventId: n.eventId, material: true, changeKind: "update", materialVersion: n.materialVersion, importance: 80, confidence: 80, band: "critical", verificationStatus: "confirmed", isDemo: false, changes: [] });
    expect(stats.decisions.suppressed_duplicate ?? stats.decisions.suppressed_cooldown).toBe(1);
    expect(await handle.db.select().from(notifications).where(eq(notifications.userId, userId))).toHaveLength(1);
  });

  it("applies the cooldown to minor updates but lets escalations through", async () => {
    const ctx = testContext(handle.db, { now: () => now });
    const [n] = await handle.db.select().from(notifications).where(eq(notifications.userId, userId));
    const base = { eventId: n.eventId, material: true, importance: 80, confidence: 80, band: "critical" as const, verificationStatus: "confirmed" as const, isDemo: false, changes: ["x"] };
    const minor = await evaluateAlerts(ctx, { ...base, changeKind: "update", materialVersion: 2 });
    expect(minor.decisions.suppressed_cooldown).toBe(1);
    const esc = await evaluateAlerts(ctx, { ...base, changeKind: "escalation", materialVersion: 3 });
    expect(esc.notified).toBe(1);
  });

  it("records why an event did not alert (below threshold)", async () => {
    const ctx = testContext(handle.db, { now: () => now });
    await ingestItems(ctx, [liveItem("product-1", "Acme unveils a new line of office chairs with improved lumbar support.", null, { provider: "rss", authorName: "Some blog" })]);
    await processPending(ctx);
    const decisions = await handle.db.select().from(alertDecisions).where(eq(alertDecisions.userId, userId));
    expect(decisions.some((d) => d.decision === "below_threshold" && d.reasons.join(" ").includes("importance"))).toBe(true);
  });

  it("does not alert on events first detected long after publication", async () => {
    const ctx = testContext(handle.db, { now: () => now });
    await ingestItems(ctx, [liveItem("old-1", "The Federal Reserve announced the FOMC rate decision and policy rate path.", fedSource, { publishedAt: new Date(now.getTime() - 12 * 3_600_000) })]);
    await processPending(ctx);
    const decisions = await handle.db.select().from(alertDecisions).where(eq(alertDecisions.decision, "suppressed_late"));
    expect(decisions.length).toBeGreaterThan(0);
  });

  it("retries failed external deliveries a bounded number of times and records the failure", async () => {
    const failing: Notifier = { channel: "discord", configured: () => true, send: vi.fn().mockRejectedValue(new Error("webhook 500")) };
    for (let i = 0; i < 6; i++) {
      await processDeliveries(handle.db, [failing], new Date(now.getTime() + i * 60 * 60_000));
    }
    const discord = await handle.db.select().from(notificationDeliveries).where(eq(notificationDeliveries.channel, "discord"));
    expect(discord.every((d) => d.status === "failed" && d.attempts === 4 && d.lastError === "webhook 500")).toBe(true);
    const [health] = await handle.db.select().from(providerHealth).where(eq(providerHealth.provider, "notify:discord"));
    expect(health.status).toBe("error");
  });

  it("never sends sample data to external channels", async () => {
    const [ev] = await handle.db.select().from(events).limit(1);
    await handle.db.update(events).set({ isDemo: true, materialVersion: 50 }).where(eq(events.id, ev.id));
    const ctx = testContext(handle.db, { now: () => new Date(now.getTime() + 24 * 3_600_000) });
    await evaluateAlerts(ctx, { eventId: ev.id, material: true, changeKind: "escalation", materialVersion: 50, importance: 90, confidence: 90, band: "critical", verificationStatus: "confirmed", isDemo: true, changes: [] });
    const [n] = await handle.db.select().from(notifications).where(and(eq(notifications.eventId, ev.id), eq(notifications.materialVersion, 50)));
    const ds = await handle.db.select().from(notificationDeliveries).where(eq(notificationDeliveries.notificationId, n.id));
    expect(ds.find((d) => d.channel === "discord")?.status).toBe("skipped");
  });
});

class FakeAi implements AnalysisProvider {
  readonly id = "fake";
  readonly model = "claude-haiku-5-5";
  calls: AnalysisRequest[] = [];
  constructor(private readonly result: (req: AnalysisRequest) => AnalysisResult) {}
  configured() {
    return true;
  }
  async analyze(req: AnalysisRequest) {
    this.calls.push(req);
    return this.result(req);
  }
}

describe("AI analysis inside the pipeline (fake provider)", () => {
  let handle: Awaited<ReturnType<typeof setupTestDb>>;
  beforeEach(async () => {
    handle = await setupTestDb({ seed: true });
  });

  it("stores validated output, records usage and reuses analysis for identical content", async () => {
    const ai = new FakeAi((req) => ({
      ok: true,
      model: "claude-haiku-5-5",
      latencyMs: 5,
      warnings: [],
      usage: { inputTokens: 1000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.00025 },
      extraction: {
        isMarketRelevant: true,
        categories: ["monetary_policy"],
        title: "Fed lowers rates",
        factualSummary: "The source states a 25bp cut.",
        eventTimeAsStated: null,
        claims: [{ claim: "Cut by 25bp", evidenceQuote: req.text.slice(0, 30), status: "stated_by_source" }],
        claimsRequiringVerification: [],
        assets: [],
        transmissionMechanism: "Could lower front-end yields.",
        bullishInterpretation: null,
        bearishInterpretation: null,
        keyUncertainties: ["Market pricing"],
        suggestedFollowUp: [],
        containsInstructionsToAi: false,
      },
    }));
    const ctx = testContext(handle.db, { now: () => now, ai, config: { aiEnabled: true, minScoreForAi: 0 }, alerts: false });
    const text = "FOMC statement: the Committee decided to lower the federal funds rate by 25 basis points.";
    await ingestItems(ctx, [liveItem("a1", text, null), liveItem("a2", text, null, { authorName: "Other outlet" })]);
    await processPending(ctx);
    expect(ai.calls).toHaveLength(1); // second identical item is a duplicate; no repeated model call
    expect(ai.calls[0].text).toBe(text);
    const usage = await handle.db.select().from(usageRecords).where(eq(usageRecords.provider, "anthropic"));
    expect(usage).toHaveLength(1);
    const [ev] = await handle.db.select().from(events);
    expect(ev.aiStatus).toBe("ok");
    expect((ev.analysis as { ai: { provided: boolean } }).ai.provided).toBe(true);
  });

  it("an AI failure falls back to rules-only and never creates fake data", async () => {
    const ai = new FakeAi(() => ({ ok: false, model: "claude-haiku-5-5", kind: "invalid_output", error: "malformed", usage: null, latencyMs: 3 }));
    const ctx = testContext(handle.db, { now: () => now, ai, config: { aiEnabled: true, minScoreForAi: 0 }, alerts: false });
    await ingestItems(ctx, [liveItem("b1", "FOMC statement: the Committee decided to raise the federal funds rate by 25 basis points.", null)]);
    await processPending(ctx);
    const [ev] = await handle.db.select().from(events);
    expect(ev.aiStatus).toBe("failed_invalid_output");
    expect((ev.explanation as { warnings: string[] }).warnings.join(" ")).toMatch(/AI analysis unavailable/);
    expect((ev.analysis as { bullish: string | null }).bullish).toBeNull();
    const [a] = await handle.db.select().from(itemAnalyses);
    expect(a.aiError).toBe("malformed");
  });

  it("pauses AI when the daily budget is reached (degrades gracefully)", async () => {
    const ai = new FakeAi(() => {
      throw new Error("should not be called");
    });
    await handle.db.insert(usageRecords).values({ provider: "anthropic", operation: "extract", units: 1, costUsd: "5", day: now.toISOString().slice(0, 10) });
    const ctx = testContext(handle.db, { now: () => now, ai, config: { aiEnabled: true, minScoreForAi: 0, maxAiDailyCostUsd: 1 }, alerts: false });
    await ingestItems(ctx, [liveItem("c1", "FOMC statement: the Committee decided to hold the federal funds rate.", null)]);
    await processPending(ctx);
    expect(ai.calls).toHaveLength(0);
    const [ev] = await handle.db.select().from(events);
    expect(ev.aiStatus).toBe("skipped_budget");
  });

  afterAll(async () => handle?.close());
});

describe("collection and maintenance jobs (stubbed network)", () => {
  let handle: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => {
    process.env.RSS_ENABLED = "true";
    process.env.DEMO_MODE = "false";
    resetEnvCache();
    handle = await setupTestDb({ seed: true });
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await handle.close();
  });

  it("records per-source success/failure, provider health and never treats failures as 'no news'", async () => {
    const feed = `<rss><channel><item><title>Monetary policy decision</title><link>https://www.ecb.europa.eu/x</link><guid>ecb-1</guid><pubDate>${new Date().toUTCString()}</pubDate><description>The Governing Council decided to keep the three key interest rates unchanged.</description></item></channel></rss>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (String(url).includes("ecb.europa.eu") ? new Response(feed) : new Response("blocked", { status: 403 }))),
    );
    const ctx = testContext(handle.db, { alerts: false });
    const result = await collectJob({ pipeline: ctx, env: getEnv(), signal: new AbortController().signal }, "rss");
    expect(result.stats.inserted).toBe(1);
    const srcRows = await handle.db.select().from(sources).where(eq(sources.provider, "rss"));
    expect(srcRows.find((s) => s.externalId.includes("ecb"))!.status).toBe("ok");
    expect(srcRows.find((s) => s.externalId.includes("federalreserve.gov/feeds/press_all"))!.lastError).toBe("Feed returned HTTP 403");
    const [h] = await handle.db.select().from(providerHealth).where(eq(providerHealth.provider, "rss"));
    expect(h.status).toBe("degraded");
  });

  it("marks X sources as awaiting credentials instead of pretending to collect", async () => {
    await handle.db.update(sources).set({ enabled: true }).where(eq(sources.externalId, "federalreserve"));
    const ctx = testContext(handle.db, { alerts: false });
    const r = await collectJob({ pipeline: ctx, env: getEnv(), signal: new AbortController().signal }, "x");
    expect(r.status).toBe("skipped");
    const [s] = await handle.db.select().from(sources).where(eq(sources.externalId, "federalreserve"));
    expect(s.status).toBe("awaiting_credentials");
  });

  it("purges expired third-party content but keeps metadata and events", async () => {
    const ctx = testContext(handle.db, { alerts: false });
    await processPending(ctx);
    await handle.db.update(itemContents).set({ retentionExpiresAt: new Date(Date.now() - 1000) });
    const r = await maintenanceJob({ pipeline: ctx, env: getEnv(), signal: new AbortController().signal });
    expect(r.stats.purgedContent).toBeGreaterThan(0);
    expect(await handle.db.select().from(itemContents)).toHaveLength(0);
    const [it] = await handle.db.select().from(items);
    expect(it.contentStatus).toBe("expired");
    expect((await handle.db.select().from(events)).length).toBeGreaterThan(0);
    const ev = (await handle.db.select().from(events))[0];
    const re = await recomputeEvent(ctx, ev.id, "after purge", { isNew: false });
    expect(re.eventId).toBe(ev.id);
  });

  it("pipeline runs table is writable (observability)", async () => {
    await handle.db.insert(pipelineRuns).values({ job: "test", status: "ok" });
    expect((await handle.db.select().from(pipelineRuns)).length).toBe(1);
  });
});

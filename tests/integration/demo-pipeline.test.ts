import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { contradictions, eventAssets, eventItems, events, itemAnalyses, items, scoreRecords, sourceReliabilityObservations, sources } from "@/server/db/schema";
import { ensureDemo } from "@/server/worker/jobs";
import { DemoProvider } from "@/server/providers/source/demo/provider";
import { ingestItems, processPending } from "@/server/pipeline/process";
import { toSourceRef } from "@/server/pipeline/repo";
import type { NormalizedItem } from "@/server/providers/source/types";
import { setupTestDb, testContext } from "../helpers/db";

/**
 * Runs the scripted (fictional) demo through the real pipeline and a real
 * PostgreSQL engine, then asserts the outcomes of each scenario.
 */
describe("pipeline on the demo script (real database)", () => {
  let handle: Awaited<ReturnType<typeof setupTestDb>>;
  let batch: NormalizedItem[];
  const now = new Date("2026-10-08T15:00:00Z");

  beforeAll(async () => {
    handle = await setupTestDb();
    const db = handle.db;
    const run = await ensureDemo(db, now);
    const provider = new DemoProvider({ enabled: true, intervalSeconds: 0, runStartedAt: run.startedAt, runId: run.runId });
    const srcRows = await db.select().from(sources).where(eq(sources.provider, "demo"));
    batch = (await provider.collect({ sources: srcRows.map(toSourceRef), rules: [], now, readBudget: 0 })).items;
    const ctx = testContext(db, { now: () => now, alerts: false });
    const ingest = await ingestItems(ctx, batch);
    expect(ingest.inserted).toBe(batch.length);
    await processPending(ctx, 100);
  });
  afterAll(async () => handle.close());

  async function outcomeOf(fixtureId: string) {
    const [row] = await handle.db
      .select({ outcome: itemAnalyses.outcome, role: itemAnalyses.role, eventId: itemAnalyses.eventId, flags: itemAnalyses.filterFlags })
      .from(itemAnalyses)
      .innerJoin(items, eq(items.id, itemAnalyses.itemId))
      .where(eq(items.externalId, batch.find((b) => b.externalId.endsWith(fixtureId))!.externalId));
    return row;
  }
  async function eventOf(fixtureId: string) {
    const o = await outcomeOf(fixtureId);
    const [ev] = await handle.db.select().from(events).where(eq(events.id, o.eventId!));
    return ev;
  }

  it("ingestion is idempotent", async () => {
    const ctx = testContext(handle.db, { now: () => now, alerts: false });
    const again = await ingestItems(ctx, batch);
    expect(again.inserted).toBe(0);
    expect(again.duplicates).toBe(batch.length);
  });

  it("confirms an issuer's own announcement and counts independent corroboration", async () => {
    const ev = await eventOf("nbcb-decision");
    expect(ev.verificationStatus).toBe("confirmed");
    expect(ev.primaryCategory).toBe("monetary_policy");
    expect((await outcomeOf("demowire-nbcb")).role).toBe("corroboration");
    expect((await outcomeOf("mooncaller-nbcb")).role).toBe("commentary");
    expect(ev.independentSourceCount).toBe(2);
  });

  it("does not count repeated rumors as independent confirmation", async () => {
    const ev = await eventOf("rumor-origin");
    for (const id of ["rumor-repost-1", "rumor-repost-2", "rumor-repost-3"]) {
      const o = await outcomeOf(id);
      expect(o.eventId).toBe(ev.id);
      expect(o.role).toBe("repeat");
    }
    expect(ev.independentSourceCount).toBe(1);
    expect(ev.categories).toEqual(expect.arrayContaining(["corporate_transaction", "rumor"]));
  });

  it("marks the rumor disputed after the company's denial and lowers confidence", async () => {
    const ev = await eventOf("rumor-origin");
    expect((await outcomeOf("halcyon-denial")).role).toBe("contradiction");
    expect(ev.verificationStatus).toBe("disputed");
    expect(ev.lifecycle).toBe("disputed");
    expect(ev.confidence).toBeLessThan(35);
    const c = await handle.db.select().from(contradictions).where(eq(contradictions.eventId, ev.id));
    expect(c).toHaveLength(1);
    const history = await handle.db.select().from(scoreRecords).where(eq(scoreRecords.eventId, ev.id));
    expect(history.map((h) => h.verificationStatus)).toEqual(expect.arrayContaining(["unverified", "disputed"]));
    const obs = await handle.db.select().from(sourceReliabilityObservations).where(eq(sourceReliabilityObservations.eventId, ev.id));
    expect(obs.map((o) => o.outcome)).toEqual(["unresolved"]); // a denial is not proof of falsehood
  });

  it("keeps importance and confidence separate (high-impact claim, weak evidence)", async () => {
    const rumor = await eventOf("rumor-origin");
    const earnings = await eventOf("halcyon-earnings");
    expect(rumor.importance).toBeGreaterThan(rumor.confidence);
    expect(earnings.verificationStatus).toBe("confirmed");
    expect(earnings.confidence).toBeGreaterThan(rumor.confidence + 40);
  });

  it("separates same-organisation repeats from independent corroboration, then applies the correction", async () => {
    const ev = await eventOf("fab-outage-origin");
    expect((await outcomeOf("fab-outage-same-org")).role).toBe("repeat");
    expect((await outcomeOf("fab-outage-independent")).role).toBe("corroboration");
    expect((await outcomeOf("fab-outage-correction")).role).toBe("correction");
    expect(ev.verificationStatus).toBe("corrected");
  });

  it("filters spam and flags prompt-injection text without obeying it", async () => {
    expect((await outcomeOf("spam")).outcome).toBe("filtered_spam");
    const inj = await outcomeOf("injection");
    expect(inj.flags).toContain("contains_instructions");
    const ev = await eventOf("injection");
    expect(ev.verificationStatus).not.toBe("confirmed");
    expect(ev.importance).toBeLessThan(100);
    expect(ev.confidence).toBeLessThanOrEqual(35);
  });

  it("maps assets with explicit relations and never invents unknown ones", async () => {
    const ev = await eventOf("halcyon-earnings");
    const assets = await handle.db.select().from(eventAssets).where(eq(eventAssets.eventId, ev.id));
    expect(assets.find((a) => a.symbol === "HLCN.DEMO")?.relation).toBe("direct");
    expect(assets.every((a) => a.rationale.length > 0)).toBe(true);
  });

  it("stores every scored event with an explanation separating facts and interpretation", async () => {
    const ev = await eventOf("nbcb-decision");
    const ex = ev.explanation as { statements: unknown[]; verified: string[]; unverified: string[]; whyScore: string[] };
    expect(ex.statements.length).toBeGreaterThan(0);
    expect(ex.verified[0]).toMatch(/authoritative primary source/);
    expect(ex.whyScore.join(" ")).toMatch(/coverage/i);
    const links = await handle.db.select().from(eventItems).where(eq(eventItems.eventId, ev.id));
    expect(links.length).toBe(3);
  });
});

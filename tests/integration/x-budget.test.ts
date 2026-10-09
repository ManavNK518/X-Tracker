import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { collectionRules, itemContents, items, sources, usageRecords } from "@/server/db/schema";
import { xBudgetToday, type XReadPurpose } from "@/server/pipeline/budget";
import { collectJob, xComplianceJob, xStreamJob } from "@/server/worker/jobs";
import { contentHash } from "@/server/lib/text";
import { utcDayKey } from "@/lib/time";
import { getEnv, resetEnvCache } from "@/config/env";
import { setupTestDb, testContext } from "../helpers/db";

/**
 * X budgets, scheduling and deletion re-checks against a real database, with
 * the X API stubbed (TEST DATA, not real posts). Defaults apply unless set here:
 * 500 post reads and $2.50 per day, 50 reads reserved for deletion checks,
 * keyword rules capped at half the cost budget.
 */

const DAY = 86_400_000;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("X budgets, scheduling and deletion checks (stubbed X API)", () => {
  let handle: Awaited<ReturnType<typeof setupTestDb>>;
  const saved = { token: process.env.X_BEARER_TOKEN, demo: process.env.DEMO_MODE };

  const job = (signal = new AbortController().signal) => ({ pipeline: testContext(handle.db, { alerts: false }), env: getEnv(), signal });
  const usage = (operation: string, units: number, costUsd: number, purpose?: XReadPurpose) =>
    handle.db.insert(usageRecords).values({ provider: "x", operation, units, costUsd: costUsd.toFixed(6), day: utcDayKey(new Date()), meta: purpose ? { purpose } : {} });
  const readsByPurpose = async () => {
    const rows = await handle.db
      .select({ op: usageRecords.operation, purpose: sql<string>`${usageRecords.meta}->>'purpose'`, units: sql<number>`sum(${usageRecords.units})::int` })
      .from(usageRecords)
      .where(sql`${usageRecords.operation} <> 'request'`)
      .groupBy(usageRecords.operation, sql`${usageRecords.meta}->>'purpose'`);
    return Object.fromEntries(rows.map((r) => [`${r.purpose}:${r.op}`, Number(r.units)]));
  };
  const macroRule = async () => (await handle.db.select().from(collectionRules).where(eq(collectionRules.name, "Macro releases & Fed (keywords)")))[0];

  beforeAll(async () => {
    process.env.X_BEARER_TOKEN = "test-token-not-real";
    process.env.DEMO_MODE = "false";
    resetEnvCache();
    handle = await setupTestDb({ seed: true });
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (saved.token === undefined) delete process.env.X_BEARER_TOKEN;
    else process.env.X_BEARER_TOKEN = saved.token;
    if (saved.demo === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = saved.demo;
    resetEnvCache();
    await handle.close();
  });
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await handle.db.delete(usageRecords);
    await handle.db.delete(items).where(eq(items.provider, "x"));
    await handle.db.update(sources).set({ enabled: false, lastAttemptAt: null, config: {} }).where(eq(sources.provider, "x"));
    await handle.db.update(collectionRules).set({ enabled: false, lastRunAt: null, lastError: null, sinceId: null });
  });

  it("splits the day's allowance between collection, keyword rules and deletion checks", async () => {
    await usage("post_read", 100, 0.5, "accounts");
    await usage("post_read", 50, 0.25, "keyword_rule");
    await usage("user_read", 50, 0.5, "keyword_rule");
    await usage("post_read", 20, 0.1, "compliance");
    const b = await xBudgetToday(handle.db, { maxPostReads: 500, maxCostUsd: 2.5, keywordRuleShare: 0.5, complianceReads: 50, postReadCostUsd: 0.005 });
    expect(b.postReadsToday).toBe(170);
    expect(b.spentTodayUsd).toBeCloseTo(1.35);
    // 30 reads ($0.15) stay reserved for deletion checks.
    expect(b.collection.postReads).toBe(300);
    expect(b.collection.costUsd).toBeCloseTo(1.0);
    // Keyword rules: half of $2.50, minus the $0.75 they already used.
    expect(b.collection.keywordRuleCostUsd).toBeCloseTo(0.5);
    expect(b.compliance.postReads).toBe(30);
  });

  it("lets a keyword rule wait its turn without losing its place, and records reads by purpose", async () => {
    await handle.db.update(sources).set({ enabled: true, config: { xUserId: "u1" } }).where(eq(sources.externalId, "federalreserve"));
    await handle.db.update(collectionRules).set({ enabled: true }).where(eq(collectionRules.name, "Macro releases & Fed (keywords)"));
    const searched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const u = new URL(input);
        searched.push(u.searchParams.get("query") ?? "");
        return u.searchParams.get("expansions") === "author_id"
          ? json({ data: [{ id: "501", text: "FOMC minutes are out (test)", author_id: "a9" }], includes: { users: [{ id: "a9", username: "someone", name: "Someone" }] }, meta: { result_count: 1, newest_id: "501" } })
          : json({ data: [{ id: "500", text: "Federal Reserve test post", author_id: "u1" }], meta: { result_count: 1, newest_id: "500" } });
      }),
    );
    // Leave room for exactly one request in the hourly cap (30 by default).
    await usage("request", 29, 0);
    const first = await collectJob(job(), "x");
    expect(first.status).toBe("ok");
    expect(searched).toHaveLength(1);
    expect(searched[0]).toContain("from:federalreserve");
    expect(await macroRule()).toMatchObject({ lastRunAt: null, lastError: null });

    // Next run, again with room for one request: the rule has waited longest, so it goes first.
    await handle.db.delete(usageRecords).where(eq(usageRecords.operation, "request"));
    await usage("request", 29, 0);
    await collectJob(job(), "x");
    expect(searched[1]).toContain("FOMC");
    const rule = await macroRule();
    expect(rule.lastRunAt).not.toBeNull();
    expect(rule.sinceId).toBe("501");
    expect(await readsByPurpose()).toEqual({ "accounts:post_read": 1, "keyword_rule:post_read": 1, "keyword_rule:user_read": 1 });
  });

  it("stops collecting at the daily cost cap, before the post-read cap", async () => {
    await handle.db.update(sources).set({ enabled: true, config: { xUserId: "u1" } }).where(eq(sources.externalId, "federalreserve"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // 100 post reads, but $2.30 spent (e.g. author profiles): $2.50 − $2.30 − $0.25 reserve leaves nothing.
    await usage("post_read", 100, 2.3, "keyword_rule");
    const r = await collectJob(job(), "x");
    expect(r).toMatchObject({ status: "skipped" });
    expect(String(r.stats.reason)).toMatch(/cost budget/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("deletion re-checks", () => {
    const now = Date.now();
    const posts = {
      fresh: { collected: 0.5, refreshed: null }, // younger than 24 h
      unchecked: { collected: 2, refreshed: null }, // first check due
      doubled: { collected: 3, refreshed: 2 }, // checked at age 1 d; now 3 d old
      backingOff: { collected: 10, refreshed: 4 }, // checked at age 6 d; next at 12 d
      oldDoubled: { collected: 10, refreshed: 6 }, // checked at age 4 d; now 10 d old
    } as const;
    const seedPosts = async () => {
      for (const [id, p] of Object.entries(posts)) {
        const [row] = await handle.db
          .insert(items)
          .values({
            provider: "x",
            externalId: id,
            contentHash: contentHash(`test post ${id}`),
            collectedAt: new Date(now - p.collected * DAY),
            lastRefreshedAt: p.refreshed === null ? null : new Date(now - p.refreshed * DAY),
            processingState: "done",
          })
          .returning({ id: items.id });
        await handle.db.insert(itemContents).values({ itemId: row.id, text: `test post ${id}` });
      }
    };
    /** Answers post lookups; "unchecked" has been deleted on X. */
    const stubLookup = () => {
      const requested: string[][] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string) => {
          const ids = new URL(input).searchParams.get("ids")!.split(",");
          requested.push(ids);
          return json({ data: ids.filter((i) => i !== "unchecked").map((i) => ({ id: i, text: `test post ${i}` })) });
        }),
      );
      return requested;
    };

    it("re-checks a post each time its age doubles, and purges deleted posts", async () => {
      await seedPosts();
      const requested = stubLookup();
      const r = await xComplianceJob(job());
      expect(r.stats).toMatchObject({ checked: 3, purged: 1 });
      expect([...requested[0]].sort()).toEqual(["doubled", "oldDoubled", "unchecked"]);
      const [gone] = await handle.db.select().from(items).where(eq(items.externalId, "unchecked"));
      expect(gone.contentStatus).toBe("unavailable");
      expect(await handle.db.select().from(itemContents).where(eq(itemContents.itemId, gone.id))).toHaveLength(0);
      // Only posts that still exist are billed.
      expect(await readsByPurpose()).toEqual({ "compliance:post_read": 2 });
    });

    it("stays within its daily reserve, never-checked posts first", async () => {
      await seedPosts();
      await usage("post_read", 48, 0.24, "compliance");
      const requested = stubLookup();
      const r = await xComplianceJob(job());
      expect(r.stats).toMatchObject({ checked: 2 });
      expect(requested[0]).toEqual(["unchecked", "oldDoubled"]);
      await usage("post_read", 2, 0.01, "compliance");
      expect(await xComplianceJob(job())).toMatchObject({ status: "skipped" });
    });
  });

  describe("filtered stream", () => {
    /** A stand-in for the X stream endpoints that keeps the rule set server-side. */
    function stubStream(lines: object[]) {
      let rules: { id: string; value: string; tag: string }[] = [];
      let nextId = 1;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string, init?: RequestInit) => {
          const path = new URL(input).pathname;
          if (path.endsWith("/rules")) {
            if (init?.method !== "POST") return json({ data: rules });
            const body = JSON.parse(String(init.body)) as { add?: { value: string; tag: string }[]; delete?: { ids: string[] } };
            if (body.delete) rules = rules.filter((r) => !body.delete!.ids.includes(r.id));
            for (const r of body.add ?? []) rules.push({ id: String(nextId++), ...r });
            return json({});
          }
          const enc = new TextEncoder();
          return new Response(
            new ReadableStream({
              start(c) {
                for (const l of lines) c.enqueue(enc.encode(`${JSON.stringify(l)}\r\n`));
                c.close();
              },
            }),
          );
        }),
      );
      return { rules: () => rules.map((r) => r.tag) };
    }
    const post = (id: string, user: { id: string; username: string }, tag: string) => ({
      data: { id, text: `test stream post ${id}`, author_id: user.id },
      includes: { users: [{ ...user, name: user.username }] },
      matching_rules: [{ tag }],
    });

    it("counts author profiles as reads and drops keyword rules once they use their share", async () => {
      await handle.db.update(sources).set({ enabled: true }).where(eq(sources.externalId, "federalreserve"));
      const rule = await macroRule();
      await handle.db.update(collectionRules).set({ enabled: true }).where(eq(collectionRules.id, rule.id));
      // Keyword rules have $0.05 left of their $1.25 share: room for about three posts with profiles ($0.015 each).
      await usage("post_read", 240, 1.2, "keyword_rule");
      const stranger = { id: "a9", username: "someone" };
      const stream = stubStream([
        post("601", { id: "u1", username: "federalreserve" }, "accounts-0"),
        post("602", stranger, `rule-${rule.id}`),
        post("603", stranger, `rule-${rule.id}`),
        post("604", stranger, `rule-${rule.id}`),
        post("605", stranger, `rule-${rule.id}`),
      ]);
      const r = await xStreamJob(job());
      expect(r.stats).toMatchObject({ delivered: 4 });
      expect(String(r.stats.reason)).toMatch(/keyword-rule share/);
      const reads = await readsByPurpose();
      expect(reads["accounts:post_read"]).toBe(1);
      expect(reads["accounts:user_read"]).toBe(1);
      expect(reads["keyword_rule:user_read"]).toBe(3);
      expect(await handle.db.select().from(items).where(eq(items.provider, "x"))).toHaveLength(4);
      expect(stream.rules()).toEqual(["accounts-0", `rule-${rule.id}`]);

      // The next connection carries the account rule only.
      const aborted = new AbortController();
      aborted.abort();
      await xStreamJob(job(aborted.signal));
      expect(stream.rules()).toEqual(["accounts-0"]);
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { parseFeed } from "@/server/providers/source/rss/parse";
import { RssProvider } from "@/server/providers/source/rss/provider";
import { buildAccountQueries, parseRateLimit, XClient, xPostUrl } from "@/server/providers/source/x/client";
import { compareIds, maxId, minId, refreshPostAvailability, XProvider, type XProviderOptions } from "@/server/providers/source/x/provider";
import { runFilteredStream, streamBackoffMs, syncStreamRules } from "@/server/providers/source/x/stream";
import { DemoProvider } from "@/server/providers/source/demo/provider";
import { DEMO_FIXTURES } from "@/server/providers/source/demo/fixtures";
import { ProviderError } from "@/server/lib/errors";
import type { CollectionRuleRef, SourceRef } from "@/server/providers/source/types";

// --- Deterministic fixtures (TEST DATA, not real posts) ----------------------

const RSS2 = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test Bank</title>
<item><title>Policy statement</title><link>https://bank.example/press/1</link><guid>press-1</guid><pubDate>Wed, 08 Oct 2026 14:00:00 GMT</pubDate><description><![CDATA[<p>The committee kept the <b>policy rate</b> at 3%.</p>]]></description></item>
<item><title>Old release</title><link>https://bank.example/press/0</link><pubDate>Mon, 01 Jan 2024 14:00:00 GMT</pubDate><description>Old</description></item>
</channel></rss>`;
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Filings</title>
<entry><title>8-K - Example Corp</title><link rel="alternate" href="https://filings.example/1"/><id>urn:filing:1</id><updated>2026-10-08T13:00:00Z</updated><summary>Item 5.02 Departure of officers</summary></entry></feed>`;
const RDF = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>CB</title></channel><item><title>Rate announcement</title><link>https://cb.example/a</link><dc:date>2026-10-08T14:00:00Z</dc:date><description>Policy rate held</description></item></rdf:RDF>`;

const source = (o: Partial<SourceRef> = {}): SourceRef => ({
  id: "s1",
  provider: "rss",
  externalId: "https://bank.example/feed.xml",
  handle: null,
  name: "Test Bank",
  category: "central_bank",
  isPrimary: true,
  authorityDomains: ["monetary_policy"],
  organization: "Test Bank",
  enabled: true,
  isDemo: false,
  config: {},
  ...o,
});

const json = (body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });

describe("RSS/Atom/RDF parsing", () => {
  it("parses RSS 2.0, strips HTML and keeps original links", () => {
    const f = parseFeed(RSS2);
    expect(f.entries[0]).toMatchObject({ externalId: "press-1", link: "https://bank.example/press/1", title: "Policy statement" });
    expect(f.entries[0].text).toContain("kept the policy rate at 3%");
    expect(f.entries[0].text).not.toContain("<b>");
    expect(f.entries[0].publishedAt!.toISOString()).toBe("2026-10-08T14:00:00.000Z");
  });
  it("parses Atom and RSS 1.0 (RDF)", () => {
    expect(parseFeed(ATOM).entries[0]).toMatchObject({ externalId: "urn:filing:1", link: "https://filings.example/1" });
    expect(parseFeed(RDF).entries[0].publishedAt!.toISOString()).toBe("2026-10-08T14:00:00.000Z");
  });
  it("rejects entity declarations and unknown formats", () => {
    expect(() => parseFeed('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><rss><channel></channel></rss>')).toThrow(/entities/);
    expect(() => parseFeed("<html></html>")).toThrow(/Unrecognised/);
  });
  it("never accepts javascript: links", () => {
    const f = parseFeed(`<rss><channel><item><title>x</title><link>javascript:alert(1)</link><guid>g</guid></item></channel></rss>`);
    expect(f.entries[0].link).toBeNull();
  });
});

describe("RSS provider", () => {
  const now = new Date("2026-10-08T15:00:00Z");
  it("collects fresh entries, ignores old ones and records validators", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(RSS2, { status: 200, headers: { etag: '"v1"' } }));
    const p = new RssProvider({ enabled: true, userAgent: "test", fetchImpl });
    const r = await p.collect({ sources: [source()], rules: [], now, readBudget: 0 });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ provider: "rss", sourceId: "s1", url: "https://bank.example/press/1" });
    expect(r.sourceOutcomes[0]).toMatchObject({ ok: true, etag: '"v1"' });
  });
  it("uses conditional requests and handles 304", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    const p = new RssProvider({ enabled: true, userAgent: "test", fetchImpl });
    const r = await p.collect({ sources: [source({ config: { etag: '"v1"' } })], rules: [], now, readBudget: 0 });
    expect(fetchImpl.mock.calls[0][1].headers["If-None-Match"]).toBe('"v1"');
    expect(r.sourceOutcomes[0]).toMatchObject({ ok: true, notModified: true });
    expect(r.items).toHaveLength(0);
  });
  it("reports failures per source without failing the others", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => (url.includes("bad") ? new Response("no", { status: 403 }) : new Response(RSS2)));
    const p = new RssProvider({ enabled: true, userAgent: "test", fetchImpl });
    const r = await p.collect({ sources: [source(), source({ id: "s2", externalId: "https://bad.example/feed" })], rules: [], now, readBudget: 0 });
    expect(r.sourceOutcomes.find((o) => o.sourceId === "s2")).toMatchObject({ ok: false, error: "Feed returned HTTP 403" });
    expect(r.items).toHaveLength(1);
  });
  it("retries server errors and network failures a bounded number of times", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("err", { status: 503 }));
    const p = new RssProvider({ enabled: true, userAgent: "test", fetchImpl, retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => undefined } });
    const r = await p.collect({ sources: [source()], rules: [], now, readBudget: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.sourceOutcomes[0].ok).toBe(false);
  });
  it("keeps sec.gov feeds idle without a declared User-Agent", async () => {
    const fetchImpl = vi.fn();
    const p = new RssProvider({ enabled: true, userAgent: "test", fetchImpl });
    const r = await p.collect({ sources: [source({ externalId: "https://www.sec.gov/news/pressreleases.rss" })], rules: [], now, readBudget: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.sourceOutcomes[0].status).toBe("awaiting_credentials");
  });
});

describe("X API client", () => {
  it("parses rate-limit headers", () => {
    const rl = parseRateLimit(new Headers({ "x-rate-limit-limit": "450", "x-rate-limit-remaining": "3", "x-rate-limit-reset": "1791504000" }));
    expect(rl).toEqual({ limit: 450, remaining: 3, resetAt: new Date(1791504000 * 1000) });
  });
  it("builds chunked from: queries within the length limit and skips invalid handles", () => {
    const handles = Array.from({ length: 60 }, (_, i) => `account_${i}`).concat(["bad handle!"]);
    const qs = buildAccountQueries(handles, 512);
    expect(qs.length).toBeGreaterThan(1);
    expect(qs.every((q) => q.length <= 512)).toBe(true);
    expect(qs.join(" ")).not.toContain("bad handle");
  });
  it("builds canonical post URLs", () => {
    expect(xPostUrl("123", "federalreserve")).toBe("https://x.com/federalreserve/status/123");
    expect(xPostUrl("123", null)).toBe("https://x.com/i/web/status/123");
  });
  it("maps 429 to a retryable rate-limit error and 401 to a non-retryable auth error", async () => {
    const c429 = new XClient("t", "https://api.test/2", async () => json({ title: "Too Many Requests" }, { status: 429, headers: { "x-rate-limit-reset": "1791504000" } }));
    await expect(c429.searchRecent({ query: "q", maxResults: 10, expandAuthors: false })).rejects.toMatchObject({ options: { retryable: true, kind: "rate_limit" } });
    const c401 = new XClient("t", "https://api.test/2", async () => json({ title: "Unauthorized" }, { status: 401 }));
    await expect(c401.searchRecent({ query: "q", maxResults: 10, expandAuthors: false })).rejects.toMatchObject({ options: { retryable: false, kind: "auth" } });
  });
  it("sends the bearer token and documented parameters", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ data: [], meta: { result_count: 0 } }));
    await new XClient("secret-token", "https://api.test/2", fetchImpl).searchRecent({ query: "from:a", maxResults: 5, sinceId: "100", expandAuthors: true });
    const [url, init] = fetchImpl.mock.calls[0];
    const u = new URL(url);
    expect(u.pathname).toBe("/2/tweets/search/recent");
    expect(u.searchParams.get("max_results")).toBe("10"); // clamped to the documented minimum
    expect(u.searchParams.get("since_id")).toBe("100");
    expect(u.searchParams.get("tweet.fields")).toContain("created_at");
    expect(u.searchParams.get("expansions")).toBe("author_id");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
  });
  it("compares snowflake IDs numerically", () => {
    expect(compareIds("99", "100")).toBeLessThan(0);
    expect(maxId(["5", "1000", "999"])).toBe("1000");
    expect(minId(["5", "1000", "999"])).toBe("5");
  });
});

describe("X provider (mocked API)", () => {
  const fed = source({ id: "fed", provider: "x", externalId: "federalreserve", handle: "federalreserve", name: "Federal Reserve (X)" });
  const routes = (handlers: Record<string, (u: URL) => Response>) =>
    vi.fn(async (input: string) => {
      const u = new URL(input);
      for (const [path, h] of Object.entries(handlers)) if (u.pathname.endsWith(path)) return h(u);
      return json({ title: "not found" }, { status: 404 });
    });
  const xProvider = (o: Partial<XProviderOptions> = {}) =>
    new XProvider({ bearerToken: "t", baseUrl: "https://api.test/2", maxResultsPerQuery: 25, maxQueriesPerRun: 3, postReadCostUsd: 0.005, userReadCostUsd: 0.01, ...o });
  const at = (hhmm: string) => new Date(`2026-10-08T${hhmm}:00Z`);
  const rule = (o: Partial<CollectionRuleRef> = {}): CollectionRuleRef => ({ id: "r", name: "r", query: "(FOMC) lang:en", maxResults: 10, sinceId: null, ...o });
  /** Records each recent-search request and answers with an empty page. */
  const searchLog = () => {
    const queries: URL[] = [];
    const fetchImpl = routes({ "/tweets/search/recent": (u) => (queries.push(u), json({ meta: { result_count: 0 } })) });
    return { queries, fetchImpl };
  };

  it("is not configured without a token and does not call the API", async () => {
    const fetchImpl = vi.fn();
    const p = xProvider({ bearerToken: undefined, fetchImpl });
    expect(p.configured().ok).toBe(false);
    const r = await p.collect({ sources: [fed], rules: [], now: new Date(), readBudget: 100 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.sourceOutcomes[0].status).toBe("awaiting_credentials");
  });

  it("resolves user IDs once, normalizes posts and advances cursors", async () => {
    const fetchImpl = routes({
      "/users/by": () => json({ data: [{ id: "u1", username: "federalreserve", name: "Federal Reserve" }] }),
      "/tweets/search/recent": (u) => {
        expect(u.searchParams.get("query")).toContain("from:federalreserve");
        return json({ data: [{ id: "1001", text: "The FOMC decided to keep the policy rate unchanged.", author_id: "u1", created_at: "2026-10-08T18:00:00.000Z", lang: "en" }], meta: { result_count: 1, newest_id: "1001" } });
      },
    });
    const r = await xProvider({ fetchImpl }).collect({ sources: [fed], rules: [], now: new Date(), readBudget: 100 });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ provider: "x", externalId: "1001", sourceId: "fed", url: "https://x.com/federalreserve/status/1001" });
    expect(r.items[0].publishedAt!.toISOString()).toBe("2026-10-08T18:00:00.000Z");
    expect(r.postsRead).toBe(1);
    expect(r.usersRead).toBe(1);
    expect(r.sourceConfigUpdates.find((u) => u.sourceId === "fed")!.config).toMatchObject({ xUserId: "u1", sinceId: "1001" });
  });

  it("respects the read budget (no requests when exhausted)", async () => {
    const fetchImpl = vi.fn();
    await xProvider({ fetchImpl }).collect({ sources: [{ ...fed, config: { xUserId: "u1" } }], rules: [rule()], now: new Date(), readBudget: 5 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops on rate limiting and leaves the remaining queries for a later run", async () => {
    const fetchImpl = routes({ "/tweets/search/recent": () => json({}, { status: 429, headers: { "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 900) } }) });
    const p = xProvider({ fetchImpl, maxQueriesPerRun: 5, retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5, sleep: async () => undefined } });
    const r = await p.collect({ sources: [{ ...fed, config: { xUserId: "u1" } }], rules: [rule()], now: new Date(), readBudget: 100 });
    expect(r.sourceOutcomes[0].status).toBe("rate_limited");
    expect(r.items).toHaveLength(0);
    // One request: the reset is 15 minutes away, so it is surfaced rather than retried, and the rule is not attempted.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.ruleOutcomes[0]).toMatchObject({ ruleId: "r", deferred: true });
  });

  it("gives keyword rules a turn when only one query fits in a run", async () => {
    const accounts = [{ ...fed, config: { xUserId: "u1", sinceId: "100" }, lastAttemptAt: at("15:00") }];
    // The rule last ran before the accounts did, so it goes first.
    const first = searchLog();
    const r1 = await xProvider({ fetchImpl: first.fetchImpl }).collect({
      sources: accounts,
      rules: [rule({ lastRunAt: at("14:00") })],
      now: at("15:05"),
      readBudget: 100,
      limits: { queries: 1 },
    });
    expect(first.queries.map((u) => u.searchParams.get("query"))).toEqual(["(FOMC) lang:en"]);
    expect(r1.ruleOutcomes).toEqual([expect.objectContaining({ ruleId: "r", ok: true })]);
    expect(r1.deferred).toMatchObject({ accountGroups: 1, rules: 0, reason: "query limit for this run reached" });
    expect(r1.sourceOutcomes).toHaveLength(0);

    // Next run: the rule has just run, so the accounts go first and the rule waits its turn.
    const second = searchLog();
    const r2 = await xProvider({ fetchImpl: second.fetchImpl }).collect({
      sources: accounts,
      rules: [rule({ lastRunAt: at("15:05") })],
      now: at("15:10"),
      readBudget: 100,
      limits: { queries: 1 },
    });
    expect(second.queries[0].searchParams.get("query")).toContain("from:federalreserve");
    expect(r2.ruleOutcomes).toEqual([expect.objectContaining({ ruleId: "r", ok: false, deferred: true })]);
  });

  it("rotates through account groups that do not fit in one query", async () => {
    const handles = Array.from({ length: 40 }, (_, i) => `account_no_${String(i).padStart(2, "0")}`);
    const groups = buildAccountQueries(handles);
    expect(groups.length).toBeGreaterThan(1);
    const inFirstGroup = new Set(groups[0].match(/from:(\w+)/g)!.map((m) => m.slice(5)));
    const sources = handles.map((h, i) =>
      source({ id: `s${i}`, provider: "x", externalId: h, handle: h, config: { xUserId: `u${i}` }, lastAttemptAt: inFirstGroup.has(h) ? at("15:00") : at("14:00") }),
    );
    const log = searchLog();
    await xProvider({ fetchImpl: log.fetchImpl }).collect({ sources, rules: [], now: at("15:05"), readBudget: 100, limits: { queries: 1 } });
    expect(log.queries.map((u) => u.searchParams.get("query"))).toEqual([groups[1]]);
  });

  it("keeps keyword rules within their share of the budget and reports their reads separately", async () => {
    const accounts = [{ ...fed, config: { xUserId: "u1" } }];
    const capped = searchLog();
    const r1 = await xProvider({ fetchImpl: capped.fetchImpl }).collect({ sources: accounts, rules: [rule()], now: new Date(), readBudget: 100, limits: { costUsd: 1, keywordRuleCostUsd: 0.1 } });
    // 10 posts plus 10 author profiles would cost $0.15, more than the rule's remaining $0.10.
    expect(capped.queries).toHaveLength(1);
    expect(r1.ruleOutcomes[0]).toMatchObject({ deferred: true, error: "keyword-rule share of today's X budget used" });

    const fetchImpl = routes({
      "/tweets/search/recent": (u) =>
        u.searchParams.get("expansions") === "author_id"
          ? json({
              data: [{ id: "7", text: "a", author_id: "a1" }, { id: "8", text: "b", author_id: "a2" }],
              includes: { users: [{ id: "a1", username: "a", name: "A" }, { id: "a2", username: "b", name: "B" }] },
              meta: { result_count: 2, newest_id: "8" },
            })
          : json({ data: [{ id: "9", text: "c", author_id: "u1" }], meta: { result_count: 1, newest_id: "9" } }),
    });
    const r2 = await xProvider({ fetchImpl }).collect({ sources: accounts, rules: [rule()], now: new Date(), readBudget: 100, limits: { costUsd: 1, keywordRuleCostUsd: 0.5 } });
    expect(r2.postsRead).toBe(3);
    expect(r2.usersRead).toBe(2);
    expect(r2.keywordRule).toEqual({ postsRead: 2, usersRead: 2 });
  });

  it("sizes requests to the remaining cost budget and never pages past the query limit", async () => {
    const log = searchLog();
    await xProvider({ fetchImpl: log.fetchImpl }).collect({ sources: [{ ...fed, config: { xUserId: "u1" } }], rules: [], now: new Date(), readBudget: 100, limits: { costUsd: 0.06 } });
    expect(log.queries[0].searchParams.get("max_results")).toBe("12");

    const pages: URL[] = [];
    const fetchImpl = routes({
      "/tweets/search/recent": (u) => (pages.push(u), json({ data: [{ id: "250", text: "p", author_id: "u1" }], meta: { result_count: 10, newest_id: "300", next_token: "more" } })),
    });
    await xProvider({ fetchImpl }).collect({ sources: [{ ...fed, config: { xUserId: "u1", sinceId: "100" } }], rules: [], now: new Date(), readBudget: 100, limits: { queries: 1 } });
    expect(pages).toHaveLength(1);
  });

  it("detects deleted/unavailable posts for compliance refresh", async () => {
    const client = new XClient("t", "https://api.test/2", async () => json({ data: [{ id: "1", text: "still here" }], errors: [{ resource_id: "2", title: "Not Found Error" }] }));
    const r = await refreshPostAvailability(client, ["1", "2"]);
    expect(r).toEqual({ available: ["1"], unavailable: ["2"], reads: 1 });
  });
});

describe("X filtered stream (mocked)", () => {
  function streamResponse(chunks: string[]): Response {
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(enc.encode(ch));
          c.close();
        },
      }),
      { status: 200 },
    );
  }

  it("parses posts, ignores keep-alives and stops when the consumer asks", async () => {
    const line = (id: string) => JSON.stringify({ data: { id, text: `post ${id}`, author_id: "u1" }, includes: { users: [{ id: "u1", username: "a", name: "A" }] }, matching_rules: [{ tag: "accounts-0" }] });
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse([`${line("1")}\r\n`, "\r\n", `${line("2")}\r\n${line("3")}\r\n`]));
    const seen: string[] = [];
    const r = await runFilteredStream({
      bearerToken: "t",
      baseUrl: "https://api.test/2",
      fetchImpl,
      signal: new AbortController().signal,
      sleep: async () => undefined,
      onPost: ({ post }) => {
        seen.push(post.id);
        return seen.length < 2;
      },
    });
    expect(seen).toEqual(["1", "2"]);
    expect(r.reason).toBe("consumer_stopped");
  });

  it("reconnects with backoff but gives up after a bounded number of failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("err", { status: 503 }));
    const sleeps: number[] = [];
    const r = await runFilteredStream({
      bearerToken: "t",
      baseUrl: "https://api.test/2",
      fetchImpl,
      signal: new AbortController().signal,
      maxConsecutiveFailures: 4,
      sleep: async (ms) => void sleeps.push(ms),
      onPost: () => true,
    });
    expect(r.reason).toBe("max_failures");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([5_000, 10_000, 20_000]);
  });

  it("stops immediately on authorization failure", async () => {
    const r = await runFilteredStream({ bearerToken: "t", baseUrl: "https://api.test/2", fetchImpl: vi.fn().mockResolvedValue(new Response("", { status: 401 })), signal: new AbortController().signal, onPost: () => true });
    expect(r.reason).toBe("auth_401");
  });

  it("uses the documented reconnect schedule", () => {
    expect(streamBackoffMs("network", 1)).toBe(250);
    expect(streamBackoffMs("network", 100)).toBe(16_000);
    expect(streamBackoffMs("http", 1)).toBe(5_000);
    expect(streamBackoffMs("rate_limit", 1)).toBe(60_000);
  });

  it("reconciles stream rules by value", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: "a", value: "old rule" }, { id: "b", value: "keep" }] }))
      .mockImplementation(async () => json({}));
    const r = await syncStreamRules({ bearerToken: "t", baseUrl: "https://api.test/2", fetchImpl }, [{ value: "keep", tag: "k" }, { value: "new", tag: "n" }]);
    expect(r).toEqual({ added: 1, deleted: 1 });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ delete: { ids: ["a"] } });
  });

  it("ProviderError is retryable only when marked", () => {
    expect(new ProviderError("x", "e", { retryable: false }).options.retryable).toBe(false);
  });
});

describe("demo provider", () => {
  it("labels every item as demo with no URL and releases items progressively", async () => {
    const start = new Date("2026-10-08T12:00:00Z");
    const p = new DemoProvider({ enabled: true, intervalSeconds: 10, runStartedAt: start, runId: "r1" });
    const early = await p.collect({ sources: [], rules: [], now: start, readBudget: 0 });
    const later = await p.collect({ sources: [], rules: [], now: new Date(start.getTime() + 60_000), readBudget: 0 });
    expect(early.items.length).toBe(DEMO_FIXTURES.filter((f) => f.step <= 0).length);
    expect(later.items.length).toBeGreaterThan(early.items.length);
    expect(later.items.every((i) => i.isDemo && i.url === null && i.externalId.startsWith("demo-r1-"))).toBe(true);
  });
});

import { logger } from "@/server/lib/logger";
import { ProviderError } from "@/server/lib/errors";
import { withRetry } from "@/server/lib/retry";
import {
  emptyCollectResult,
  type CollectContext,
  type CollectionRuleRef,
  type CollectResult,
  type NormalizedItem,
  type SourceProvider,
  type SourceRef,
} from "../types";
import { buildAccountQueries, XClient, xPostUrl, type FetchLike, type XPost, type XUser } from "./client";

export interface XProviderOptions {
  bearerToken: string | undefined;
  baseUrl: string;
  fetchImpl?: FetchLike;
  /** Pages to follow per query per run (bounded). */
  maxPagesPerQuery?: number;
  maxResultsPerQuery: number;
  maxQueriesPerRun: number;
  /** Estimated prices, used to keep each run inside its cost limits. */
  postReadCostUsd: number;
  userReadCostUsd: number;
  retry?: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; sleep?: (ms: number) => Promise<void> };
}

/** Result side-channel: source config changes the job layer should persist (e.g. resolved user IDs, cursors). */
export interface XCollectResult extends CollectResult {
  sourceConfigUpdates: { sourceId: string; config: Record<string, unknown> }[];
  /** The part of postsRead / usersRead that came from keyword rules. */
  keywordRule: { postsRead: number; usersRead: number };
  /** Queries that were due but left for a later run, and the first reason. */
  deferred: { accountGroups: number; rules: number; reason: string | null };
}

type QueryTask =
  | { kind: "accounts"; query: string; sources: SourceRef[]; lastRun: number }
  | { kind: "rule"; rule: CollectionRuleRef; lastRun: number };

const lastRunOf = (d: Date | null | undefined) => (d ? d.getTime() : Number.NEGATIVE_INFINITY);

/** Whole units a budget covers at a unit price (unlimited when the price is 0). */
const afford = (budget: number, price: number) => (price > 0 ? Math.floor(budget / price + 1e-9) : Number.POSITIVE_INFINITY);

/** X recent search returns at least 10 posts per page. */
const MIN_PAGE = 10;

export class XProvider implements SourceProvider {
  readonly id = "x" as const;

  constructor(private readonly options: XProviderOptions) {}

  configured() {
    return this.options.bearerToken
      ? { ok: true }
      : { ok: false, reason: "X_BEARER_TOKEN is not set. Configure an X developer app (pay-per-use) to enable collection." };
  }

  private client(): XClient {
    return new XClient(this.options.bearerToken ?? "", this.options.baseUrl, this.options.fetchImpl);
  }

  async collect(ctx: CollectContext): Promise<XCollectResult> {
    const result: XCollectResult = {
      ...emptyCollectResult(),
      sourceConfigUpdates: [],
      keywordRule: { postsRead: 0, usersRead: 0 },
      deferred: { accountGroups: 0, rules: 0, reason: null },
    };
    if (!this.options.bearerToken) {
      for (const s of ctx.sources) {
        result.sourceOutcomes.push({ sourceId: s.id, ok: false, itemsFound: 0, status: "awaiting_credentials", error: "X_BEARER_TOKEN not configured" });
      }
      return result;
    }
    const client = this.client();
    const price = { post: this.options.postReadCostUsd, user: this.options.userReadCostUsd };
    const queryLimit = Math.min(this.options.maxQueriesPerRun, ctx.limits?.queries ?? Number.POSITIVE_INFINITY);
    let reads = ctx.readBudget;
    let cost = ctx.limits?.costUsd ?? Number.POSITIVE_INFINITY;
    let ruleCost = Math.min(cost, ctx.limits?.keywordRuleCostUsd ?? Number.POSITIVE_INFINITY);
    let queriesUsed = 0;
    const spend = (posts: number, users: number, keywordRule: boolean) => {
      const usd = posts * price.post + users * price.user;
      reads -= posts;
      cost -= usd;
      if (keywordRule) ruleCost -= usd;
      ruleCost = Math.min(ruleCost, cost);
    };
    const retry = this.options.retry ?? { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 30_000 };
    const call = <T>(fn: () => Promise<T>) =>
      withRetry(() => fn(), {
        ...retry,
        signal: ctx.signal,
        onRetry: ({ attempt, delayMs, error }) =>
          logger.warn("x.retry", { attempt, delayMs, error: (error as Error).message }),
      });

    const accountSources = ctx.sources.filter((s) => s.enabled && s.handle);
    const byHandle = new Map(accountSources.map((s) => [s.handle!.toLowerCase(), s]));
    const byUserId = new Map<string, SourceRef>();
    for (const s of accountSources) {
      const uid = typeof s.config.xUserId === "string" ? s.config.xUserId : null;
      if (uid) byUserId.set(uid, s);
    }

    // 1) Resolve user IDs once for registered handles (one billed user read each, cached in source config).
    const unresolved = accountSources.filter((s) => typeof s.config.xUserId !== "string");
    for (let i = 0; i < unresolved.length; ) {
      const n = Math.min(100, unresolved.length - i, afford(cost, price.user));
      if (n <= 0 || queriesUsed >= queryLimit) break;
      const chunk = unresolved.slice(i, i + n);
      i += n;
      try {
        const res = await call(() => client.lookupUsers(chunk.map((s) => s.handle!), ctx.signal));
        queriesUsed++;
        result.requests++;
        result.usersRead += res.data?.length ?? 0;
        spend(0, res.data?.length ?? 0, false);
        for (const u of res.data ?? []) {
          const src = byHandle.get(u.username.toLowerCase());
          if (src) {
            byUserId.set(u.id, src);
            result.sourceConfigUpdates.push({ sourceId: src.id, config: { ...src.config, xUserId: u.id, xName: u.name } });
          }
        }
        for (const e of res.errors ?? []) {
          const src = e.value ? byHandle.get(e.value.toLowerCase()) : undefined;
          if (src) result.sourceOutcomes.push({ sourceId: src.id, ok: false, itemsFound: 0, status: "error", error: e.detail ?? "User not found" });
        }
      } catch (error) {
        return this.failAll(result, ctx, error);
      }
    }

    // 2) Account groups (from:a OR from:b …) and keyword rules share the run's
    // limits. Least recently run goes first, so every group and rule gets a
    // turn when limits bind; account groups win ties.
    const tasks: QueryTask[] = [
      ...buildAccountQueries(accountSources.map((s) => s.handle!)).map((query): QueryTask => {
        const group = query
          .match(/from:([A-Za-z0-9_]+)/g)!
          .map((m) => byHandle.get(m.slice(5).toLowerCase()))
          .filter((s): s is SourceRef => Boolean(s));
        return { kind: "accounts", query, sources: group, lastRun: Math.min(...group.map((s) => lastRunOf(s.lastAttemptAt))) };
      }),
      ...ctx.rules.map((rule): QueryTask => ({ kind: "rule", rule, lastRun: lastRunOf(rule.lastRunAt) })),
    ];
    tasks.sort((a, b) => a.lastRun - b.lastRun || (a.kind === b.kind ? 0 : a.kind === "accounts" ? -1 : 1));

    const perSourceFound = new Map<string, number>();
    let stopReason: string | null = null;
    for (const task of tasks) {
      const isRule = task.kind === "rule";
      // Keyword rules expand author profiles: at most one billed user read per post.
      const perPost = price.post + (isRule ? price.user : 0);
      const affordable = Math.min(reads, afford(isRule ? ruleCost : cost, perPost));
      let deferReason = stopReason;
      if (!deferReason && queriesUsed >= queryLimit) deferReason = "query limit for this run reached";
      if (!deferReason && affordable < MIN_PAGE) {
        deferReason =
          isRule && Math.min(reads, afford(cost, perPost)) >= MIN_PAGE ? "keyword-rule share of today's X budget used" : "today's X read or cost budget reached";
      }
      if (deferReason) {
        result.deferred.reason ??= deferReason;
        if (task.kind === "rule") {
          result.deferred.rules++;
          result.ruleOutcomes.push({ ruleId: task.rule.id, ok: false, itemsFound: 0, deferred: true, error: deferReason });
        } else {
          result.deferred.accountGroups++;
        }
        continue;
      }

      const wanted = task.kind === "rule" ? task.rule.maxResults : this.options.maxResultsPerQuery;
      let sinceId: string | null;
      if (task.kind === "rule") {
        sinceId = task.rule.sinceId;
      } else {
        // Group cursor = the oldest since_id in the group, so no account misses posts.
        const cursors = task.sources.map((s) => (typeof s.config.sinceId === "string" ? s.config.sinceId : null));
        sinceId = cursors.every((c) => c) ? minId(cursors as string[]) : null;
      }
      try {
        const page = await this.searchPaged(client, call, task.kind === "rule" ? task.rule.query : task.query, sinceId, {
          maxResults: Math.min(wanted, affordable),
          maxPages: Math.min(this.options.maxPagesPerQuery ?? 2, queryLimit - queriesUsed),
          budget: affordable,
          expandAuthors: isRule,
        });
        queriesUsed += page.pages;
        result.requests += page.pages;
        result.postsRead += page.reads;
        result.usersRead += page.userReads;
        spend(page.reads, page.userReads, isRule);
        for (const post of page.posts) {
          const src = (post.author_id && byUserId.get(post.author_id)) || null;
          result.items.push(toItem(post, src, page.users));
          if (src && task.kind === "accounts") perSourceFound.set(src.id, (perSourceFound.get(src.id) ?? 0) + 1);
        }
        if (task.kind === "rule") {
          result.keywordRule.postsRead += page.reads;
          result.keywordRule.usersRead += page.userReads;
          result.ruleOutcomes.push({ ruleId: task.rule.id, ok: true, newestId: page.newestId ?? task.rule.sinceId, itemsFound: page.posts.length });
          continue;
        }
        if (page.newestId) {
          for (const s of task.sources) {
            const prev = result.sourceConfigUpdates.find((u) => u.sourceId === s.id);
            const base = prev?.config ?? s.config;
            const merged = { ...base, sinceId: maxId([page.newestId, typeof base.sinceId === "string" ? base.sinceId : "0"]) };
            if (prev) prev.config = merged;
            else result.sourceConfigUpdates.push({ sourceId: s.id, config: merged });
          }
        }
        for (const s of task.sources) {
          if (!result.sourceOutcomes.some((o) => o.sourceId === s.id)) {
            result.sourceOutcomes.push({ sourceId: s.id, ok: true, itemsFound: perSourceFound.get(s.id) ?? 0, status: "ok" });
          }
        }
      } catch (error) {
        const err = error as ProviderError;
        if (task.kind === "rule") {
          result.ruleOutcomes.push({ ruleId: task.rule.id, ok: false, itemsFound: 0, error: err.message });
        } else {
          for (const s of task.sources) {
            result.sourceOutcomes.push({
              sourceId: s.id,
              ok: false,
              itemsFound: 0,
              status: err.options?.kind === "rate_limit" ? "rate_limited" : "error",
              error: err.message,
            });
          }
        }
        // Further requests would fail the same way; leave the rest for a later run.
        if (err.options?.kind === "auth" || err.options?.kind === "rate_limit") stopReason = `stopped after an earlier error: ${err.message}`;
      }
    }

    result.rateLimit = client.lastRateLimit ? { remaining: client.lastRateLimit.remaining, resetAt: client.lastRateLimit.resetAt } : null;
    return result;
  }

  private async searchPaged(
    client: XClient,
    call: <T>(fn: () => Promise<T>) => Promise<T>,
    query: string,
    sinceId: string | null,
    opts: { maxResults: number; maxPages: number; budget: number; expandAuthors: boolean },
  ) {
    const posts: XPost[] = [];
    const users = new Map<string, XUser>();
    let newestId: string | null = null;
    let nextToken: string | null = null;
    let pages = 0;
    let reads = 0;
    let userReads = 0;
    const pageSize = Math.max(MIN_PAGE, opts.maxResults);
    const maxPages = Math.max(1, opts.maxPages);
    do {
      const res = await call(() =>
        client.searchRecent({ query, maxResults: pageSize, sinceId, nextToken, expandAuthors: opts.expandAuthors }),
      );
      pages++;
      const data = res.data ?? [];
      reads += res.meta?.result_count ?? data.length;
      userReads += res.includes?.users?.length ?? 0;
      posts.push(...data);
      for (const u of res.includes?.users ?? []) users.set(u.id, u);
      if (!newestId && res.meta?.newest_id) newestId = res.meta.newest_id;
      nextToken = res.meta?.next_token ?? null;
      // Only follow pagination when catching up from a cursor and the limits allow another full page.
    } while (nextToken && sinceId && pages < maxPages && opts.budget - reads >= pageSize);
    return { posts, users, newestId, pages, reads, userReads };
  }

  private failAll(result: XCollectResult, ctx: CollectContext, error: unknown): XCollectResult {
    const err = error as ProviderError;
    for (const s of ctx.sources) {
      if (!result.sourceOutcomes.some((o) => o.sourceId === s.id)) {
        result.sourceOutcomes.push({
          sourceId: s.id,
          ok: false,
          itemsFound: 0,
          status: err.options?.kind === "rate_limit" ? "rate_limited" : "error",
          error: err.message,
        });
      }
    }
    // Rules did not run, so they stay due.
    for (const r of ctx.rules) result.ruleOutcomes.push({ ruleId: r.id, ok: false, itemsFound: 0, deferred: true, error: err.message });
    result.deferred.rules += ctx.rules.length;
    result.deferred.reason ??= err.message;
    return result;
  }
}

export function toItem(post: XPost, source: SourceRef | null, users: Map<string, XUser>): NormalizedItem {
  const user = post.author_id ? users.get(post.author_id) : undefined;
  const username = user?.username ?? source?.handle ?? null;
  const published = post.created_at ? new Date(post.created_at) : null;
  return {
    provider: "x",
    externalId: post.id,
    sourceId: source?.id ?? null,
    authorHandle: username,
    authorName: user?.name ?? source?.name ?? null,
    authorExternalId: post.author_id ?? null,
    url: xPostUrl(post.id, username),
    title: null,
    text: post.text,
    lang: post.lang ?? null,
    publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    referenced: (post.referenced_tweets ?? []).map((r) => ({ type: r.type, id: r.id })),
    isDemo: false,
  };
}

/** X post IDs are 64-bit snowflakes encoded as decimal strings. */
export function compareIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}
export const minId = (ids: string[]) => ids.reduce((m, id) => (compareIds(id, m) < 0 ? id : m));
export const maxId = (ids: string[]) => ids.reduce((m, id) => (compareIds(id, m) > 0 ? id : m));

/**
 * Compliance refresh: looks up stored post IDs and reports which ones are no
 * longer available (deleted, protected, suspended). The caller purges content.
 */
export async function refreshPostAvailability(
  client: XClient,
  ids: string[],
  signal?: AbortSignal,
): Promise<{ available: string[]; unavailable: string[]; reads: number }> {
  const available: string[] = [];
  const unavailable: string[] = [];
  let reads = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await client.lookupPosts(chunk, signal);
    const found = new Set((res.data ?? []).map((p) => p.id));
    reads += found.size;
    for (const id of chunk) (found.has(id) ? available : unavailable).push(id);
  }
  return { available, unavailable, reads };
}

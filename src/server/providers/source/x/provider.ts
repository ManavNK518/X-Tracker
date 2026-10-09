import { logger } from "@/server/lib/logger";
import { ProviderError } from "@/server/lib/errors";
import { withRetry } from "@/server/lib/retry";
import {
  emptyCollectResult,
  type CollectContext,
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
  retry?: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; sleep?: (ms: number) => Promise<void> };
}

/** Result side-channel: source config changes the job layer should persist (e.g. resolved user IDs, cursors). */
export interface XCollectResult extends CollectResult {
  sourceConfigUpdates: { sourceId: string; config: Record<string, unknown> }[];
}

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
    const result: XCollectResult = { ...emptyCollectResult(), sourceConfigUpdates: [] };
    if (!this.options.bearerToken) {
      for (const s of ctx.sources) {
        result.sourceOutcomes.push({ sourceId: s.id, ok: false, itemsFound: 0, status: "awaiting_credentials", error: "X_BEARER_TOKEN not configured" });
      }
      return result;
    }
    const client = this.client();
    let budget = ctx.readBudget;
    let queriesUsed = 0;
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

    // 1) Resolve user IDs once for registered handles (cached in source config).
    const unresolved = accountSources.filter((s) => typeof s.config.xUserId !== "string");
    for (let i = 0; i < unresolved.length && budget > 0; i += 100) {
      const chunk = unresolved.slice(i, i + 100);
      try {
        const res = await call(() => client.lookupUsers(chunk.map((s) => s.handle!), ctx.signal));
        result.requests++;
        result.usersRead += res.data?.length ?? 0;
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

    // 2) Account queries (from:handle OR …), cursor = min since_id across the chunk.
    const handles = accountSources.map((s) => s.handle!);
    const accountQueries = buildAccountQueries(handles);
    const perSourceFound = new Map<string, number>();
    for (const query of accountQueries) {
      if (queriesUsed >= this.options.maxQueriesPerRun || budget < 10) break;
      const chunkSources = query
        .match(/from:([A-Za-z0-9_]+)/g)!
        .map((m) => byHandle.get(m.slice(5).toLowerCase()))
        .filter((s): s is SourceRef => Boolean(s));
      const cursors = chunkSources.map((s) => (typeof s.config.sinceId === "string" ? s.config.sinceId : null));
      const sinceId = cursors.every((c) => c) ? minId(cursors as string[]) : null;
      try {
        const { posts, users, newestId, pages, reads, userReads } = await this.searchPaged(
          client,
          call,
          query,
          sinceId,
          Math.min(this.options.maxResultsPerQuery, budget),
          false,
          budget,
        );
        queriesUsed += pages;
        result.requests += pages;
        result.postsRead += reads;
        result.usersRead += userReads;
        budget -= reads;
        for (const post of posts) {
          const src = (post.author_id && byUserId.get(post.author_id)) || null;
          result.items.push(toItem(post, src, users));
          if (src) perSourceFound.set(src.id, (perSourceFound.get(src.id) ?? 0) + 1);
        }
        if (newestId) {
          for (const s of chunkSources) {
            const prev = result.sourceConfigUpdates.find((u) => u.sourceId === s.id);
            const base = prev?.config ?? s.config;
            const merged = { ...base, sinceId: maxId([newestId, typeof base.sinceId === "string" ? base.sinceId : "0"]) };
            if (prev) prev.config = merged;
            else result.sourceConfigUpdates.push({ sourceId: s.id, config: merged });
          }
        }
        for (const s of chunkSources) {
          if (!result.sourceOutcomes.some((o) => o.sourceId === s.id)) {
            result.sourceOutcomes.push({ sourceId: s.id, ok: true, itemsFound: perSourceFound.get(s.id) ?? 0, status: "ok" });
          }
        }
      } catch (error) {
        const err = error as ProviderError;
        for (const s of chunkSources) {
          result.sourceOutcomes.push({
            sourceId: s.id,
            ok: false,
            itemsFound: 0,
            status: err.options?.kind === "rate_limit" ? "rate_limited" : "error",
            error: err.message,
          });
        }
        if (err.options?.kind === "auth" || err.options?.kind === "rate_limit") break;
      }
    }

    // 3) Keyword collection rules.
    for (const rule of ctx.rules) {
      if (queriesUsed >= this.options.maxQueriesPerRun || budget < 10) {
        result.ruleOutcomes.push({ ruleId: rule.id, ok: false, itemsFound: 0, error: "Skipped: query or read budget reached for this run" });
        continue;
      }
      try {
        const { posts, users, newestId, pages, reads, userReads } = await this.searchPaged(
          client,
          call,
          rule.query,
          rule.sinceId,
          Math.min(rule.maxResults, budget),
          true,
          budget,
        );
        queriesUsed += pages;
        result.requests += pages;
        result.postsRead += reads;
        result.usersRead += userReads;
        budget -= reads;
        for (const post of posts) {
          const src = (post.author_id && byUserId.get(post.author_id)) || null;
          result.items.push(toItem(post, src, users));
        }
        result.ruleOutcomes.push({ ruleId: rule.id, ok: true, newestId: newestId ?? rule.sinceId, itemsFound: posts.length });
      } catch (error) {
        result.ruleOutcomes.push({ ruleId: rule.id, ok: false, itemsFound: 0, error: (error as Error).message });
        const err = error as ProviderError;
        if (err.options?.kind === "auth" || err.options?.kind === "rate_limit") break;
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
    maxResults: number,
    expandAuthors: boolean,
    budget: number,
  ) {
    const posts: XPost[] = [];
    const users = new Map<string, XUser>();
    let newestId: string | null = null;
    let nextToken: string | null = null;
    let pages = 0;
    let reads = 0;
    let userReads = 0;
    const maxPages = Math.max(1, this.options.maxPagesPerQuery ?? 2);
    do {
      const res = await call(() =>
        client.searchRecent({ query, maxResults: Math.max(10, maxResults), sinceId, nextToken, expandAuthors }),
      );
      pages++;
      const data = res.data ?? [];
      reads += res.meta?.result_count ?? data.length;
      userReads += res.includes?.users?.length ?? 0;
      posts.push(...data);
      for (const u of res.includes?.users ?? []) users.set(u.id, u);
      if (!newestId && res.meta?.newest_id) newestId = res.meta.newest_id;
      nextToken = res.meta?.next_token ?? null;
      // Only follow pagination when catching up from a cursor and budget allows another page.
    } while (nextToken && sinceId && pages < maxPages && budget - reads >= maxResults);
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
    for (const r of ctx.rules) result.ruleOutcomes.push({ ruleId: r.id, ok: false, itemsFound: 0, error: err.message });
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

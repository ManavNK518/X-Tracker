import { ProviderError } from "@/server/lib/errors";

/**
 * Minimal X API v2 client (app-only Bearer auth).
 *
 * Checked against docs.x.com on 2026-10-08:
 *  - Base URL https://api.x.com/2, Bearer token for app-only requests.
 *  - GET /2/tweets/search/recent: query, max_results 10–100, since_id, next_token,
 *    tweet.fields, expansions, user.fields. Last 7 days only.
 *  - GET /2/tweets?ids=…: post lookup (used for compliance refresh).
 *  - GET /2/users/by?usernames=…: user lookup.
 *  - GET /2/tweets/search/stream (+ /rules): filtered stream, 1 connection on
 *    pay-per-use, keep-alive newline every ~20 seconds.
 *  - Rate-limit headers: x-rate-limit-limit / -remaining / -reset (unix seconds).
 *  - Pricing is pay-per-use (e.g. $0.005 per post read, $0.010 per user read at
 *    the time of writing); see docs/X_API.md. Callers enforce read budgets.
 */

export interface XPost {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  conversation_id?: string;
  referenced_tweets?: { type: string; id: string }[];
}

export interface XUser {
  id: string;
  name: string;
  username: string;
  verified?: boolean;
}

export interface XProblem {
  value?: string;
  detail?: string;
  title?: string;
  resource_id?: string;
  resource_type?: string;
  parameter?: string;
  type?: string;
}

export interface XSearchResponse {
  data?: XPost[];
  includes?: { users?: XUser[] };
  meta?: { newest_id?: string; oldest_id?: string; result_count?: number; next_token?: string };
  errors?: XProblem[];
}

export interface XLookupResponse {
  data?: XPost[];
  includes?: { users?: XUser[] };
  errors?: XProblem[];
}

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetAt: Date | null;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const POST_FIELDS = "created_at,lang,author_id,referenced_tweets,conversation_id";
export const USER_FIELDS = "username,name,verified";

export function parseRateLimit(headers: Headers): RateLimitInfo {
  const num = (name: string) => {
    const v = headers.get(name);
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const reset = num("x-rate-limit-reset");
  return {
    limit: num("x-rate-limit-limit"),
    remaining: num("x-rate-limit-remaining"),
    resetAt: reset !== null ? new Date(reset * 1000) : null,
  };
}

export class XClient {
  public lastRateLimit: RateLimitInfo | null = null;

  constructor(
    private readonly bearerToken: string,
    private readonly baseUrl = "https://api.x.com/2",
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 20_000,
  ) {
    if (!bearerToken) throw new ProviderError("x", "X bearer token is not configured", { retryable: false, kind: "not_configured" });
  }

  private async request<T>(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
    const url = new URL(this.baseUrl.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${this.bearerToken}`, "User-Agent": "SignalTerminal/0.1" },
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = controller.signal.aborted;
      throw new ProviderError("x", aborted ? "X API request timed out" : `X API network error: ${(error as Error).message}`, {
        retryable: true,
        kind: aborted ? "timeout" : "network",
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    const rl = parseRateLimit(res.headers);
    this.lastRateLimit = rl;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const detail = summarizeErrorBody(body);
      if (res.status === 429) {
        throw new ProviderError("x", `X API rate limit exceeded${detail ? `: ${detail}` : ""}`, {
          retryable: true,
          status: 429,
          rateLimitResetAt: rl.resetAt,
          kind: "rate_limit",
        });
      }
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError("x", `X API authorization failed (${res.status})${detail ? `: ${detail}` : ""}`, {
          retryable: false,
          status: res.status,
          kind: "auth",
        });
      }
      if (res.status === 402) {
        throw new ProviderError("x", `X API payment required — check credit balance${detail ? `: ${detail}` : ""}`, {
          retryable: false,
          status: 402,
          kind: "auth",
        });
      }
      if (res.status >= 500) {
        throw new ProviderError("x", `X API server error (${res.status})`, { retryable: true, status: res.status, kind: "server" });
      }
      throw new ProviderError("x", `X API request rejected (${res.status})${detail ? `: ${detail}` : ""}`, {
        retryable: false,
        status: res.status,
        kind: "client",
      });
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new ProviderError("x", "X API returned invalid JSON", { retryable: true, kind: "parse" });
    }
  }

  searchRecent(
    opts: { query: string; maxResults: number; sinceId?: string | null; nextToken?: string | null; expandAuthors: boolean },
    signal?: AbortSignal,
  ): Promise<XSearchResponse> {
    return this.request<XSearchResponse>(
      "/tweets/search/recent",
      {
        query: opts.query,
        max_results: Math.min(100, Math.max(10, opts.maxResults)),
        since_id: opts.sinceId ?? undefined,
        next_token: opts.nextToken ?? undefined,
        "tweet.fields": POST_FIELDS,
        expansions: opts.expandAuthors ? "author_id" : undefined,
        "user.fields": opts.expandAuthors ? USER_FIELDS : undefined,
      },
      signal,
    );
  }

  lookupPosts(ids: string[], signal?: AbortSignal): Promise<XLookupResponse> {
    if (ids.length === 0 || ids.length > 100) throw new Error("lookupPosts expects 1–100 ids");
    return this.request<XLookupResponse>("/tweets", { ids: ids.join(","), "tweet.fields": POST_FIELDS }, signal);
  }

  lookupUsers(usernames: string[], signal?: AbortSignal): Promise<{ data?: XUser[]; errors?: XProblem[] }> {
    if (usernames.length === 0 || usernames.length > 100) throw new Error("lookupUsers expects 1–100 usernames");
    return this.request("/users/by", { usernames: usernames.join(","), "user.fields": USER_FIELDS }, signal);
  }
}

function summarizeErrorBody(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as { title?: string; detail?: string; errors?: { message?: string }[] };
    return (parsed.detail ?? parsed.title ?? parsed.errors?.[0]?.message ?? "").slice(0, 200);
  } catch {
    return body.slice(0, 120);
  }
}

export function xPostUrl(id: string, username?: string | null): string {
  return username ? `https://x.com/${encodeURIComponent(username)}/status/${id}` : `https://x.com/i/web/status/${id}`;
}

/**
 * Builds `from:` queries for registered accounts, chunked so each query stays
 * within `maxLength` characters (512 is the documented recent-search limit for
 * standard access).
 */
export function buildAccountQueries(handles: string[], maxLength = 512, suffix = "-is:retweet"): string[] {
  const queries: string[] = [];
  let current: string[] = [];
  const render = (hs: string[]) => `(${hs.map((h) => `from:${h}`).join(" OR ")}) ${suffix}`.trim();
  for (const handle of handles) {
    const clean = handle.replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) continue;
    const next = [...current, clean];
    if (render(next).length > maxLength && current.length > 0) {
      queries.push(render(current));
      current = [clean];
    } else {
      current = next;
    }
  }
  if (current.length > 0) queries.push(render(current));
  return queries;
}

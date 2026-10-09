import { logger } from "@/server/lib/logger";
import { ProviderError } from "@/server/lib/errors";
import { POST_FIELDS, USER_FIELDS, parseRateLimit, type FetchLike, type XPost, type XUser } from "./client";

/**
 * Filtered-stream support (GET /2/tweets/search/stream). Pay-per-use access
 * allows one connection and up to 1,000 rules; each delivered post is billed.
 * The stream emits a keep-alive newline roughly every 20 seconds; if nothing
 * arrives for `stallTimeoutMs` the connection is considered dead and restarted.
 */

export interface StreamRule {
  value: string;
  tag: string;
}

export interface StreamMessage {
  post: XPost;
  users: Map<string, XUser>;
  matchingRuleTags: string[];
}

export interface StreamOptions {
  bearerToken: string;
  baseUrl: string;
  fetchImpl?: FetchLike;
  stallTimeoutMs?: number;
  /** Bounded reconnect attempts before giving up for this cycle. */
  maxConsecutiveFailures?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called for each delivered post. Return false to stop streaming (e.g. budget reached). */
  onPost: (message: StreamMessage) => Promise<boolean> | boolean;
  onStatus?: (status: { state: "connecting" | "connected" | "reconnecting" | "stopped"; detail?: string }) => void;
  signal: AbortSignal;
}

async function api<T>(opts: { bearerToken: string; baseUrl: string; fetchImpl: FetchLike }, path: string, init?: RequestInit): Promise<T> {
  const res = await opts.fetchImpl(opts.baseUrl.replace(/\/$/, "") + path, {
    ...init,
    headers: { Authorization: `Bearer ${opts.bearerToken}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new ProviderError("x", `X stream rules request failed (${res.status})`, {
      retryable: res.status >= 500 || res.status === 429,
      status: res.status,
      rateLimitResetAt: parseRateLimit(res.headers).resetAt,
      kind: res.status === 429 ? "rate_limit" : res.status === 401 || res.status === 403 ? "auth" : "client",
    });
  }
  return (await res.json()) as T;
}

/** Reconciles server-side stream rules with the desired set (by value). */
export async function syncStreamRules(
  opts: { bearerToken: string; baseUrl: string; fetchImpl?: FetchLike },
  desired: StreamRule[],
): Promise<{ added: number; deleted: number }> {
  const o = { ...opts, fetchImpl: opts.fetchImpl ?? fetch };
  const current = await api<{ data?: { id: string; value: string; tag?: string }[] }>(o, "/tweets/search/stream/rules");
  const existing = current.data ?? [];
  const desiredValues = new Set(desired.map((r) => r.value));
  const toDelete = existing.filter((r) => !desiredValues.has(r.value)).map((r) => r.id);
  const existingValues = new Set(existing.map((r) => r.value));
  const toAdd = desired.filter((r) => !existingValues.has(r.value));
  if (toDelete.length) {
    await api(o, "/tweets/search/stream/rules", { method: "POST", body: JSON.stringify({ delete: { ids: toDelete } }) });
  }
  if (toAdd.length) {
    await api(o, "/tweets/search/stream/rules", { method: "POST", body: JSON.stringify({ add: toAdd }) });
  }
  return { added: toAdd.length, deleted: toDelete.length };
}

/** Backoff schedule following X's long-standing guidance for streaming reconnects. */
export function streamBackoffMs(kind: "network" | "http" | "rate_limit", consecutiveFailures: number): number {
  const n = Math.max(0, consecutiveFailures - 1);
  if (kind === "network") return Math.min(16_000, 250 * (n + 1));
  if (kind === "rate_limit") return Math.min(15 * 60_000, 60_000 * 2 ** n);
  return Math.min(320_000, 5_000 * 2 ** n);
}

/**
 * Connects and processes the stream until aborted, the consumer stops, or the
 * bounded number of consecutive failures is reached.
 */
export async function runFilteredStream(options: StreamOptions): Promise<{ delivered: number; reason: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const stallTimeoutMs = options.stallTimeoutMs ?? 30_000;
  const maxFailures = options.maxConsecutiveFailures ?? 8;
  let failures = 0;
  let delivered = 0;

  while (!options.signal.aborted) {
    options.onStatus?.({ state: failures === 0 ? "connecting" : "reconnecting" });
    const controller = new AbortController();
    const abortOuter = () => controller.abort();
    options.signal.addEventListener("abort", abortOuter, { once: true });
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), stallTimeoutMs);
    };
    let failureKind: "network" | "http" | "rate_limit" | null = null;
    let stopRequested = false;
    try {
      const url = new URL(options.baseUrl.replace(/\/$/, "") + "/tweets/search/stream");
      url.searchParams.set("tweet.fields", POST_FIELDS);
      url.searchParams.set("expansions", "author_id");
      url.searchParams.set("user.fields", USER_FIELDS);
      armStall();
      const res = await fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${options.bearerToken}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        failureKind = res.status === 429 ? "rate_limit" : "http";
        if (res.status === 401 || res.status === 403) {
          options.onStatus?.({ state: "stopped", detail: `authorization failed (${res.status})` });
          return { delivered, reason: `auth_${res.status}` };
        }
        throw new Error(`stream HTTP ${res.status}`);
      }
      options.onStatus?.({ state: "connected" });
      // The failure counter only resets once the connection has proven stable
      // (data received or 60s up), so a server that closes immediately cannot
      // cause an unbounded reconnect loop.
      const connectedAt = Date.now();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        armStall();
        if (failures > 0 && Date.now() - connectedAt > 60_000) failures = 0;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue; // keep-alive
          let parsed: { data?: XPost; includes?: { users?: XUser[] }; matching_rules?: { tag?: string }[]; errors?: unknown[] };
          try {
            parsed = JSON.parse(line);
          } catch {
            logger.warn("x.stream.bad_line", { length: line.length });
            continue;
          }
          if (!parsed.data) continue;
          const users = new Map((parsed.includes?.users ?? []).map((u) => [u.id, u]));
          delivered++;
          failures = 0;
          const keepGoing = await options.onPost({
            post: parsed.data,
            users,
            matchingRuleTags: (parsed.matching_rules ?? []).map((r) => r.tag ?? "").filter(Boolean),
          });
          if (keepGoing === false) {
            stopRequested = true;
            controller.abort();
            break;
          }
        }
        if (stopRequested) break;
      }
      if (stopRequested) {
        options.onStatus?.({ state: "stopped", detail: "consumer stopped the stream" });
        return { delivered, reason: "consumer_stopped" };
      }
      failureKind = failureKind ?? "network"; // server closed the stream
    } catch (error) {
      if (options.signal.aborted) break;
      if (stopRequested) return { delivered, reason: "consumer_stopped" };
      failureKind = failureKind ?? "network";
      logger.warn("x.stream.disconnected", { error: (error as Error).message, failures: failures + 1 });
    } finally {
      clearTimeout(stallTimer);
      options.signal.removeEventListener("abort", abortOuter);
    }
    failures++;
    if (failures >= maxFailures) {
      options.onStatus?.({ state: "stopped", detail: `gave up after ${failures} consecutive failures` });
      return { delivered, reason: "max_failures" };
    }
    await sleep(streamBackoffMs(failureKind ?? "network", failures));
  }
  options.onStatus?.({ state: "stopped", detail: "aborted" });
  return { delivered, reason: "aborted" };
}

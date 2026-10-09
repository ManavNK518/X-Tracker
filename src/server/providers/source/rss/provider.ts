import { ProviderError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { withRetry } from "@/server/lib/retry";
import { hostnameOf } from "@/server/lib/url";
import type { FetchLike } from "../x/client";
import { emptyCollectResult, type CollectContext, type CollectResult, type SourceProvider } from "../types";
import { parseFeed } from "./parse";

export interface RssProviderOptions {
  enabled: boolean;
  userAgent: string;
  secUserAgent?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxItemsPerFeed?: number;
  /** Entries older than this are ignored entirely (no archive backfill). */
  maxItemAgeDays?: number;
  retry?: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; sleep?: (ms: number) => Promise<void> };
}

const SEC_HOSTS = new Set(["sec.gov"]);

/**
 * Official RSS/Atom collector. Uses conditional requests (ETag /
 * Last-Modified) to avoid re-downloading unchanged feeds. Government feeds are
 * public, but SEC requires a descriptive User-Agent with contact details for
 * automated access, so sec.gov feeds stay idle until SEC_USER_AGENT is set.
 */
export class RssProvider implements SourceProvider {
  readonly id = "rss" as const;

  constructor(private readonly options: RssProviderOptions) {}

  configured() {
    return this.options.enabled ? { ok: true } : { ok: false, reason: "RSS collection is disabled (RSS_ENABLED=false)." };
  }

  async collect(ctx: CollectContext): Promise<CollectResult> {
    const result = emptyCollectResult();
    if (!this.options.enabled) return result;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const maxItems = this.options.maxItemsPerFeed ?? 20;
    const maxAgeMs = (this.options.maxItemAgeDays ?? 7) * 86_400_000;

    for (const source of ctx.sources) {
      if (ctx.signal?.aborted) break;
      const host = hostnameOf(source.externalId) ?? "";
      const isSec = [...SEC_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));
      if (isSec && !this.options.secUserAgent) {
        result.sourceOutcomes.push({
          sourceId: source.id,
          ok: false,
          itemsFound: 0,
          status: "awaiting_credentials",
          error: "SEC requires a declared User-Agent with contact details. Set SEC_USER_AGENT to enable this feed.",
        });
        continue;
      }
      const headers: Record<string, string> = {
        "User-Agent": isSec ? this.options.secUserAgent! : this.options.userAgent,
        Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
      };
      if (typeof source.config.etag === "string") headers["If-None-Match"] = source.config.etag;
      if (typeof source.config.lastModified === "string") headers["If-Modified-Since"] = source.config.lastModified;

      try {
        const res = await withRetry(
          async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
            try {
              const r = await fetchImpl(source.externalId, { headers, signal: controller.signal, redirect: "follow" });
              if (r.status >= 500 || r.status === 429) {
                throw new ProviderError("rss", `Feed returned HTTP ${r.status}`, { retryable: true, status: r.status, kind: "server" });
              }
              return r;
            } catch (error) {
              if (error instanceof ProviderError) throw error;
              throw new ProviderError("rss", controller.signal.aborted ? "Feed request timed out" : `Network error: ${(error as Error).message}`, {
                retryable: true,
                kind: controller.signal.aborted ? "timeout" : "network",
              });
            } finally {
              clearTimeout(timer);
            }
          },
          { maxAttempts: 2, baseDelayMs: 1_000, maxDelayMs: 5_000, ...(this.options.retry ?? {}), signal: ctx.signal },
        );
        result.requests++;
        if (res.status === 304) {
          result.sourceOutcomes.push({ sourceId: source.id, ok: true, itemsFound: 0, status: "ok", notModified: true });
          continue;
        }
        if (!res.ok) {
          logger.warn("rss.collect_http_error", { source: source.name, status: res.status });
          result.sourceOutcomes.push({ sourceId: source.id, ok: false, itemsFound: 0, status: "error", error: `Feed returned HTTP ${res.status}` });
          continue;
        }
        const xml = await res.text();
        const feed = parseFeed(xml);
        const fresh = feed.entries
          .filter((e) => !e.publishedAt || ctx.now.getTime() - e.publishedAt.getTime() <= maxAgeMs)
          .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
          .slice(0, maxItems);
        for (const entry of fresh) {
          result.items.push({
            provider: "rss",
            externalId: entry.externalId,
            sourceId: source.id,
            authorHandle: null,
            authorName: source.name,
            authorExternalId: null,
            url: entry.link,
            title: entry.title,
            text: entry.text,
            lang: null,
            publishedAt: entry.publishedAt,
            referenced: [],
            isDemo: false,
          });
        }
        result.sourceOutcomes.push({
          sourceId: source.id,
          ok: true,
          itemsFound: fresh.length,
          status: "ok",
          etag: res.headers.get("etag"),
          lastModified: res.headers.get("last-modified"),
        });
      } catch (error) {
        logger.warn("rss.collect_failed", { source: source.name, error: (error as Error).message });
        result.sourceOutcomes.push({ sourceId: source.id, ok: false, itemsFound: 0, status: "error", error: (error as Error).message });
      }
    }
    return result;
  }
}

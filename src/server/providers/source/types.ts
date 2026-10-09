import type { ProviderId, SourceCategory } from "@/domain/sources";
import type { EventCategory } from "@/domain/categories";

/**
 * Provider abstraction separating external collection from the internal
 * pipeline. A provider turns provider-specific payloads into NormalizedItems;
 * everything downstream (dedupe, classification, clustering, scoring) is
 * provider-agnostic.
 */
export interface NormalizedItem {
  provider: ProviderId;
  /** Stable provider identifier (post ID, feed GUID/link). Used for idempotent ingestion. */
  externalId: string;
  sourceId: string | null;
  authorHandle: string | null;
  authorName: string | null;
  authorExternalId: string | null;
  /** Original URL from the provider. Never synthesised from model output. */
  url: string | null;
  title: string | null;
  text: string;
  lang: string | null;
  /** Original publication time from the provider (UTC). Null when the provider omits it. */
  publishedAt: Date | null;
  /** References to other posts (repost/quote/reply), used for independence analysis. */
  referenced: { type: string; id: string }[];
  isDemo: boolean;
}

/** The subset of a registered source a provider needs. */
export interface SourceRef {
  id: string;
  provider: ProviderId;
  externalId: string;
  handle: string | null;
  name: string;
  category: SourceCategory;
  isPrimary: boolean;
  authorityDomains: EventCategory[];
  organization: string | null;
  enabled: boolean;
  isDemo: boolean;
  config: Record<string, unknown>;
  /** Last collection attempt; used to rotate fairly between queries when limits bind. */
  lastAttemptAt?: Date | null;
}

export interface CollectionRuleRef {
  id: string;
  name: string;
  query: string;
  maxResults: number;
  sinceId: string | null;
  lastRunAt?: Date | null;
}

export interface SourceOutcome {
  sourceId: string;
  ok: boolean;
  itemsFound: number;
  error?: string;
  status?: "ok" | "error" | "rate_limited" | "awaiting_credentials";
  /** Conditional-request validators for efficient polling (RSS). */
  etag?: string | null;
  lastModified?: string | null;
  notModified?: boolean;
}

export interface RuleOutcome {
  ruleId: string;
  ok: boolean;
  newestId?: string | null;
  itemsFound: number;
  error?: string;
  /** Not run this time (limits or an earlier stop); it stays due and keeps its place in the rotation. */
  deferred?: boolean;
}

export interface CollectResult {
  items: NormalizedItem[];
  sourceOutcomes: SourceOutcome[];
  ruleOutcomes: RuleOutcome[];
  requests: number;
  /** Billable post reads (X). */
  postsRead: number;
  /** Billable user reads (X). */
  usersRead: number;
  rateLimit?: { remaining: number | null; resetAt: Date | null } | null;
}

export interface CollectContext {
  sources: SourceRef[];
  rules: CollectionRuleRef[];
  now: Date;
  signal?: AbortSignal;
  /** Remaining billable reads allowed today (X). */
  readBudget: number;
  /** Further per-run limits (X). Omitted fields are unlimited. */
  limits?: {
    /** API requests this run may make. */
    queries?: number;
    /** Estimated spend this run may add. */
    costUsd?: number;
    /** Estimated spend keyword rules may add (part of costUsd). */
    keywordRuleCostUsd?: number;
  };
}

export interface SourceProvider {
  id: ProviderId;
  configured(): { ok: boolean; reason?: string };
  collect(ctx: CollectContext): Promise<CollectResult>;
}

export function emptyCollectResult(): CollectResult {
  return { items: [], sourceOutcomes: [], ruleOutcomes: [], requests: 0, postsRead: 0, usersRead: 0, rateLimit: null };
}

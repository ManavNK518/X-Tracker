import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Relational schema. Conventions:
 *  - All timestamps are `timestamptz` and stored in UTC.
 *  - Publication time (`publishedAt`) is distinct from collection time (`collectedAt`).
 *  - Raw third-party content lives only in `item_contents` so it can be purged
 *    for provider retention/deletion requirements without losing event metadata.
 *  - Scores keep their component breakdown and an audit trail (`score_records`).
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const textArray = (name: string) => text(name).array().notNull().default(sql`'{}'::text[]`);

// ---------------------------------------------------------------------------
// Users, sessions, preferences
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  /** "owner" administers sources and integrations; "member" has a private research workspace. */
  role: text("role").notNull().default("member"),
  /** Subscription readiness: entitlements are resolved server-side from this value only. */
  plan: text("plan").notNull().default("personal"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token; the raw token only exists in the user's cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  theme: text("theme").notNull().default("dark"),
  feedSort: text("feed_sort").notNull().default("newest"),
  feedMinImportance: integer("feed_min_importance").notNull().default(0),
  showDemo: boolean("show_demo").notNull().default(true),
  hideReviewed: boolean("hide_reviewed").notNull().default(false),
  quietHours: jsonb("quiet_hours")
    .$type<{ enabled: boolean; start: string; end: string; allowCritical: boolean }>()
    .notNull()
    .default({ enabled: false, start: "22:00", end: "07:00", allowCritical: true }),
  channels: jsonb("channels")
    .$type<Record<string, boolean>>()
    .notNull()
    .default({ in_app: true, browser: false, email: false, telegram: false, discord: false }),
  noteRetentionDays: integer("note_retention_days"),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Sources and collection configuration
// ---------------------------------------------------------------------------

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    /** Provider-specific identifier: lower-cased X handle, or feed URL. */
    externalId: text("external_id").notNull(),
    handle: text("handle"),
    name: text("name").notNull(),
    category: text("category").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    authorityDomains: textArray("authority_domains"),
    organization: text("organization"),
    topics: textArray("topics"),
    enabled: boolean("enabled").notNull().default(true),
    isDemo: boolean("is_demo").notNull().default(false),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("never_run"),
    lastAttemptAt: ts("last_attempt_at"),
    lastSuccessAt: ts("last_success_at"),
    lastError: text("last_error"),
    consecutiveErrors: integer("consecutive_errors").notNull().default(0),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sources_provider_external_uq").on(t.provider, t.externalId)],
);

export const sourceReliabilityObservations = pgTable(
  "source_reliability_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    /** confirmed | refuted | corrected | unresolved */
    outcome: text("outcome").notNull(),
    eventId: uuid("event_id"),
    note: text("note"),
    recordedBy: text("recorded_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("reliability_source_idx").on(t.sourceId)],
);

export const collectionRules = pgTable("collection_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  query: text("query").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  maxResults: integer("max_results").notNull().default(25),
  intervalSeconds: integer("interval_seconds").notNull().default(900),
  sinceId: text("since_id"),
  lastRunAt: ts("last_run_at"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Ingested items (posts / feed entries) and analysis records
// ---------------------------------------------------------------------------

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    authorHandle: text("author_handle"),
    authorName: text("author_name"),
    authorExternalId: text("author_external_id"),
    url: text("url"),
    lang: text("lang"),
    publishedAt: ts("published_at"),
    collectedAt: ts("collected_at").notNull().defaultNow(),
    contentHash: text("content_hash").notNull(),
    referenced: jsonb("referenced").$type<{ type: string; id: string }[]>().notNull().default([]),
    isDemo: boolean("is_demo").notNull().default(false),
    /** available | deleted | unavailable | expired */
    contentStatus: text("content_status").notNull().default("available"),
    lastRefreshedAt: ts("last_refreshed_at"),
    /** pending | processing | done | failed — the DB doubles as a durable work queue. */
    processingState: text("processing_state").notNull().default("pending"),
    processingAttempts: integer("processing_attempts").notNull().default(0),
    processedAt: ts("processed_at"),
  },
  (t) => [
    uniqueIndex("items_provider_external_uq").on(t.provider, t.externalId),
    index("items_processing_idx").on(t.processingState, t.collectedAt),
    index("items_hash_idx").on(t.contentHash),
    index("items_published_idx").on(t.publishedAt),
    index("items_source_idx").on(t.sourceId),
  ],
);

/** Restricted third-party content. Purged on retention expiry or provider deletion. */
export const itemContents = pgTable("item_contents", {
  itemId: uuid("item_id")
    .primaryKey()
    .references(() => items.id, { onDelete: "cascade" }),
  title: text("title"),
  text: text("text").notNull(),
  retentionExpiresAt: ts("retention_expires_at"),
  createdAt: createdAt(),
});

export const itemAnalyses = pgTable(
  "item_analyses",
  {
    itemId: uuid("item_id")
      .primaryKey()
      .references(() => items.id, { onDelete: "cascade" }),
    /** filtered_spam | filtered_low_info | filtered_irrelevant | duplicate | attached | new_event | error */
    outcome: text("outcome").notNull(),
    filterFlags: textArray("filter_flags"),
    filterReason: text("filter_reason"),
    classification: jsonb("classification").$type<unknown>(),
    entities: jsonb("entities").$type<unknown>(),
    eventId: uuid("event_id"),
    role: text("role"),
    aiStatus: text("ai_status").notNull().default("not_requested"),
    aiModel: text("ai_model"),
    aiOutput: jsonb("ai_output").$type<unknown>(),
    aiError: text("ai_error"),
    aiWarnings: jsonb("ai_warnings").$type<string[]>(),
    rulesVersion: text("rules_version").notNull(),
    latencyMs: integer("latency_ms"),
    processedAt: ts("processed_at").notNull().defaultNow(),
  },
  (t) => [index("item_analyses_outcome_idx").on(t.outcome, t.processedAt), index("item_analyses_event_idx").on(t.eventId)],
);

// ---------------------------------------------------------------------------
// Events (clusters) and their evidence
// ---------------------------------------------------------------------------

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ref: text("ref").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    primaryCategory: text("primary_category").notNull(),
    categories: textArray("categories"),
    lifecycle: text("lifecycle").notNull().default("new"),
    verificationStatus: text("verification_status").notNull().default("unverified"),
    importance: integer("importance").notNull().default(0),
    importanceCoverage: real("importance_coverage").notNull().default(0),
    confidence: integer("confidence").notNull().default(0),
    confidenceCoverage: real("confidence_coverage").notNull().default(0),
    band: text("band").notNull().default("minimal"),
    importanceComponents: jsonb("importance_components").$type<unknown>().notNull().default([]),
    confidenceComponents: jsonb("confidence_components").$type<unknown>().notNull().default([]),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    firstPublishedAt: ts("first_published_at"),
    lastActivityAt: ts("last_activity_at").notNull().defaultNow(),
    eventTime: ts("event_time"),
    sourceCount: integer("source_count").notNull().default(1),
    independentSourceCount: integer("independent_source_count").notNull().default(1),
    originItemId: uuid("origin_item_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    /** Normalised text of the origin item, used for similarity matching. */
    signature: text("signature").notNull().default(""),
    entityKeys: textArray("entity_keys"),
    explanation: jsonb("explanation").$type<unknown>().notNull().default({}),
    analysis: jsonb("analysis").$type<unknown>().notNull().default({}),
    aiStatus: text("ai_status").notNull().default("not_requested"),
    /** Increments on material changes; drives update notifications. */
    materialVersion: integer("material_version").notNull().default(1),
    lastVerifiedAt: ts("last_verified_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("events_updated_idx").on(t.updatedAt),
    index("events_activity_idx").on(t.lastActivityAt),
    index("events_first_seen_idx").on(t.firstSeenAt),
    index("events_importance_idx").on(t.importance),
    index("events_category_idx").on(t.primaryCategory),
    index("events_verification_idx").on(t.verificationStatus),
    index("events_categories_gin").using("gin", t.categories),
    index("events_entities_gin").using("gin", t.entityKeys),
  ],
);

export const eventItems = pgTable(
  "event_items",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    independenceKey: text("independence_key").notNull(),
    similarity: real("similarity"),
    note: text("note"),
    addedAt: ts("added_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.itemId] }), index("event_items_item_idx").on(t.itemId)],
);

export const eventAssets = pgTable(
  "event_assets",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    assetClass: text("asset_class"),
    relation: text("relation").notNull(),
    confidence: real("confidence").notNull(),
    rationale: text("rationale").notNull(),
    matchedText: text("matched_text"),
    method: text("method").notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.symbol] }), index("event_assets_symbol_idx").on(t.symbol)],
);

export const eventClassifications = pgTable(
  "event_classifications",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    score: real("score").notNull(),
    method: text("method").notNull(),
    evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.category, t.method] })],
);

export const scoreRecords = pgTable(
  "score_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    importance: integer("importance").notNull(),
    confidence: integer("confidence").notNull(),
    importanceCoverage: real("importance_coverage").notNull(),
    confidenceCoverage: real("confidence_coverage").notNull(),
    verificationStatus: text("verification_status").notNull(),
    band: text("band").notNull(),
    components: jsonb("components").$type<unknown>().notNull(),
    reason: text("reason").notNull(),
    scoringVersion: text("scoring_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("score_records_event_idx").on(t.eventId, t.createdAt)],
);

export const verificationAttempts = pgTable(
  "verification_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    attemptedAt: ts("attempted_at").notNull().defaultNow(),
    method: text("method").notNull(),
    /** completed | partial | failed */
    status: text("status").notNull(),
    resultStatus: text("result_status").notNull(),
    details: jsonb("details").$type<unknown>().notNull().default({}),
    error: text("error"),
  },
  (t) => [index("verification_attempts_event_idx").on(t.eventId, t.attemptedAt)],
);

export const contradictions = pgTable(
  "contradictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    resolved: boolean("resolved").notNull().default(false),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [index("contradictions_event_idx").on(t.eventId)],
);

// ---------------------------------------------------------------------------
// Watchlists and alerting
// ---------------------------------------------------------------------------

export const watchlists = pgTable(
  "watchlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    minImportance: integer("min_importance").notNull().default(40),
    minConfidence: integer("min_confidence").notNull().default(0),
    categories: textArray("categories"),
    sourceIds: uuid("source_ids").array().notNull().default(sql`'{}'::uuid[]`),
    keywords: textArray("keywords"),
    notify: boolean("notify").notNull().default(true),
    channels: text("channels").array().notNull().default(sql`'{in_app}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("watchlists_user_idx").on(t.userId)],
);

export const watchlistAssets = pgTable(
  "watchlist_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    watchlistId: uuid("watchlist_id")
      .notNull()
      .references(() => watchlists.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    assetClass: text("asset_class"),
    aliases: textArray("aliases"),
    /** True when the symbol is not in the alias dictionary (mapping not verified). */
    custom: boolean("custom").notNull().default(false),
  },
  (t) => [uniqueIndex("watchlist_assets_uq").on(t.watchlistId, t.symbol)],
);

export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    watchlistId: uuid("watchlist_id").references(() => watchlists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    minImportance: integer("min_importance").notNull().default(60),
    minConfidence: integer("min_confidence").notNull().default(0),
    categories: textArray("categories"),
    assetSymbols: textArray("asset_symbols"),
    sourceCategories: textArray("source_categories"),
    verificationStates: textArray("verification_states"),
    requireTimeSensitive: boolean("require_time_sensitive").notNull().default(false),
    channels: text("channels").array().notNull().default(sql`'{in_app}'::text[]`),
    cooldownMinutes: integer("cooldown_minutes"),
    includeDemo: boolean("include_demo").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("alert_rules_user_idx").on(t.userId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    ruleIds: uuid("rule_ids").array().notNull().default(sql`'{}'::uuid[]`),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    materialVersion: integer("material_version").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_uq").on(t.userId, t.dedupeKey),
    index("notifications_user_idx").on(t.userId, t.createdAt),
    index("notifications_event_idx").on(t.eventId),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: ts("next_attempt_at"),
    deliveredAt: ts("delivered_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("deliveries_status_idx").on(t.status, t.nextAttemptAt),
    index("deliveries_notification_idx").on(t.notificationId),
  ],
);

/** Per-user record of why an event did or did not alert. Powers "why no alert?" diagnostics. */
export const alertDecisions = pgTable(
  "alert_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    materialVersion: integer("material_version").notNull(),
    decision: text("decision").notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("alert_decisions_event_idx").on(t.eventId), index("alert_decisions_user_idx").on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Research workspace and feedback
// ---------------------------------------------------------------------------

export const researchNotes = pgTable(
  "research_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    sources: jsonb("sources").$type<{ label: string; url: string | null; itemId?: string | null }[]>().notNull().default([]),
    thesis: text("thesis").notNull().default(""),
    assets: textArray("assets"),
    transmission: text("transmission").notNull().default(""),
    bullish: text("bullish").notNull().default(""),
    bearish: text("bearish").notNull().default(""),
    alternatives: text("alternatives").notNull().default(""),
    risks: text("risks").notNull().default(""),
    evidenceNeeded: text("evidence_needed").notNull().default(""),
    invalidation: text("invalidation").notNull().default(""),
    followUpDate: date("follow_up_date", { mode: "string" }),
    status: text("status").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("notes_user_idx").on(t.userId, t.updatedAt)],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("feedback_uq").on(t.userId, t.eventId, t.label), index("feedback_event_idx").on(t.eventId)],
);

export const userEventStates = pgTable(
  "user_event_states",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    saved: boolean("saved").notNull().default(false),
    reviewedAt: ts("reviewed_at"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId] })],
);

// ---------------------------------------------------------------------------
// Operations: audit, health, usage, jobs
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").$type<unknown>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

export const providerHealth = pgTable("provider_health", {
  provider: text("provider").primaryKey(),
  /** ok | degraded | error | not_configured | disabled | unknown */
  status: text("status").notNull().default("unknown"),
  lastSuccessAt: ts("last_success_at"),
  lastErrorAt: ts("last_error_at"),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  rateLimitRemaining: integer("rate_limit_remaining"),
  rateLimitResetAt: ts("rate_limit_reset_at"),
  /** For notification channels: time of the last successful test delivery. */
  verifiedAt: ts("verified_at"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updatedAt(),
});

export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    units: integer("units").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    /** Estimated cost in USD (provider pricing table; not an invoice). */
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }).notNull().default("0"),
    day: date("day", { mode: "string" }).notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("usage_provider_day_idx").on(t.provider, t.day)],
);

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    /** running | ok | error | skipped */
    status: text("status").notNull(),
    stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
  },
  (t) => [index("pipeline_runs_job_idx").on(t.job, t.startedAt), index("pipeline_runs_started_idx").on(t.startedAt)],
);

/** Dead-letter records for work that failed after bounded retries. */
export const failedJobs = pgTable(
  "failed_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    refId: text("ref_id"),
    payload: jsonb("payload").$type<unknown>().notNull().default({}),
    error: text("error").notNull(),
    attempts: integer("attempts").notNull().default(1),
    createdAt: createdAt(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [index("failed_jobs_open_idx").on(t.resolvedAt, t.createdAt)],
);

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  mode: text("mode").notNull(),
  startedAt: ts("started_at").notNull(),
  lastBeatAt: ts("last_beat_at").notNull(),
  info: jsonb("info").$type<Record<string, unknown>>().notNull().default({}),
});

export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Market data and event studies (foundation; requires an authorized provider)
// ---------------------------------------------------------------------------

export const priceObservations = pgTable(
  "price_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    provider: text("provider").notNull(),
    price: numeric("price", { precision: 24, scale: 10 }).notNull(),
    currency: text("currency").notNull(),
    marketTs: ts("market_ts").notNull(),
    collectedAt: ts("collected_at").notNull().defaultNow(),
    isRealtime: boolean("is_realtime").notNull(),
    delaySeconds: integer("delay_seconds"),
  },
  (t) => [uniqueIndex("price_obs_uq").on(t.symbol, t.provider, t.marketTs), index("price_obs_symbol_ts_idx").on(t.symbol, t.marketTs)],
);

export const eventStudies = pgTable(
  "event_studies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    benchmark: text("benchmark"),
    horizon: text("horizon").notNull(),
    status: text("status").notNull(),
    results: jsonb("results").$type<unknown>().notNull().default({}),
    computedAt: ts("computed_at").notNull().defaultNow(),
  },
  (t) => [index("event_studies_event_idx").on(t.eventId)],
);

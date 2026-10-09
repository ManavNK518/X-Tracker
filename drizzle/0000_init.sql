CREATE TABLE "alert_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"material_version" integer NOT NULL,
	"decision" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"watchlist_id" uuid,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"min_importance" integer DEFAULT 60 NOT NULL,
	"min_confidence" integer DEFAULT 0 NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"asset_symbols" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"verification_states" text[] DEFAULT '{}'::text[] NOT NULL,
	"require_time_sensitive" boolean DEFAULT false NOT NULL,
	"channels" text[] DEFAULT '{in_app}'::text[] NOT NULL,
	"cooldown_minutes" integer,
	"include_demo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"max_results" integer DEFAULT 25 NOT NULL,
	"interval_seconds" integer DEFAULT 900 NOT NULL,
	"since_id" text,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contradictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"item_id" uuid,
	"description" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_assets" (
	"event_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"asset_class" text,
	"relation" text NOT NULL,
	"confidence" real NOT NULL,
	"rationale" text NOT NULL,
	"matched_text" text,
	"method" text NOT NULL,
	CONSTRAINT "event_assets_event_id_symbol_pk" PRIMARY KEY("event_id","symbol")
);
--> statement-breakpoint
CREATE TABLE "event_classifications" (
	"event_id" uuid NOT NULL,
	"category" text NOT NULL,
	"score" real NOT NULL,
	"method" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "event_classifications_event_id_category_method_pk" PRIMARY KEY("event_id","category","method")
);
--> statement-breakpoint
CREATE TABLE "event_items" (
	"event_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"role" text NOT NULL,
	"independence_key" text NOT NULL,
	"similarity" real,
	"note" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_items_event_id_item_id_pk" PRIMARY KEY("event_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "event_studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"benchmark" text,
	"horizon" text NOT NULL,
	"status" text NOT NULL,
	"results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"primary_category" text NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"lifecycle" text DEFAULT 'new' NOT NULL,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"importance" integer DEFAULT 0 NOT NULL,
	"importance_coverage" real DEFAULT 0 NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"confidence_coverage" real DEFAULT 0 NOT NULL,
	"band" text DEFAULT 'minimal' NOT NULL,
	"importance_components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence_components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_published_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_time" timestamp with time zone,
	"source_count" integer DEFAULT 1 NOT NULL,
	"independent_source_count" integer DEFAULT 1 NOT NULL,
	"origin_item_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"signature" text DEFAULT '' NOT NULL,
	"entity_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"explanation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"analysis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_status" text DEFAULT 'not_requested' NOT NULL,
	"material_version" integer DEFAULT 1 NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "failed_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"ref_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"label" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_analyses" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"filter_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"filter_reason" text,
	"classification" jsonb,
	"entities" jsonb,
	"event_id" uuid,
	"role" text,
	"ai_status" text DEFAULT 'not_requested' NOT NULL,
	"ai_model" text,
	"ai_output" jsonb,
	"ai_error" text,
	"ai_warnings" jsonb,
	"rules_version" text NOT NULL,
	"latency_ms" integer,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_contents" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"title" text,
	"text" text NOT NULL,
	"retention_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"source_id" uuid,
	"author_handle" text,
	"author_name" text,
	"author_external_id" text,
	"url" text,
	"lang" text,
	"published_at" timestamp with time zone,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL,
	"referenced" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"content_status" text DEFAULT 'available' NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"processing_state" text DEFAULT 'pending' NOT NULL,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"rule_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"material_version" integer NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "price_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"provider" text NOT NULL,
	"price" numeric(24, 10) NOT NULL,
	"currency" text NOT NULL,
	"market_ts" timestamp with time zone NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_realtime" boolean NOT NULL,
	"delay_seconds" integer
);
--> statement-breakpoint
CREATE TABLE "provider_health" (
	"provider" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"rate_limit_remaining" integer,
	"rate_limit_reset_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thesis" text DEFAULT '' NOT NULL,
	"assets" text[] DEFAULT '{}'::text[] NOT NULL,
	"transmission" text DEFAULT '' NOT NULL,
	"bullish" text DEFAULT '' NOT NULL,
	"bearish" text DEFAULT '' NOT NULL,
	"alternatives" text DEFAULT '' NOT NULL,
	"risks" text DEFAULT '' NOT NULL,
	"evidence_needed" text DEFAULT '' NOT NULL,
	"invalidation" text DEFAULT '' NOT NULL,
	"follow_up_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"importance" integer NOT NULL,
	"confidence" integer NOT NULL,
	"importance_coverage" real NOT NULL,
	"confidence_coverage" real NOT NULL,
	"verification_status" text NOT NULL,
	"band" text NOT NULL,
	"components" jsonb NOT NULL,
	"reason" text NOT NULL,
	"scoring_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_reliability_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"category" text NOT NULL,
	"outcome" text NOT NULL,
	"event_id" uuid,
	"note" text,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"handle" text,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"authority_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"organization" text,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'never_run' NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"consecutive_errors" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 6) DEFAULT '0' NOT NULL,
	"day" date NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_event_states" (
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"saved" boolean DEFAULT false NOT NULL,
	"reviewed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_event_states_user_id_event_id_pk" PRIMARY KEY("user_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"theme" text DEFAULT 'dark' NOT NULL,
	"feed_sort" text DEFAULT 'newest' NOT NULL,
	"feed_min_importance" integer DEFAULT 0 NOT NULL,
	"show_demo" boolean DEFAULT true NOT NULL,
	"hide_reviewed" boolean DEFAULT false NOT NULL,
	"quiet_hours" jsonb DEFAULT '{"enabled":false,"start":"22:00","end":"07:00","allowCritical":true}'::jsonb NOT NULL,
	"channels" jsonb DEFAULT '{"in_app":true,"browser":false,"email":false,"telegram":false,"discord":false}'::jsonb NOT NULL,
	"note_retention_days" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"plan" text DEFAULT 'personal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"result_status" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "watchlist_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"asset_class" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"custom" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"min_importance" integer DEFAULT 40 NOT NULL,
	"min_confidence" integer DEFAULT 0 NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"notify" boolean DEFAULT true NOT NULL,
	"channels" text[] DEFAULT '{in_app}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_beat_at" timestamp with time zone NOT NULL,
	"info" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_decisions" ADD CONSTRAINT "alert_decisions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_decisions" ADD CONSTRAINT "alert_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_assets" ADD CONSTRAINT "event_assets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_classifications" ADD CONSTRAINT "event_classifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_items" ADD CONSTRAINT "event_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_items" ADD CONSTRAINT "event_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_studies" ADD CONSTRAINT "event_studies_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_analyses" ADD CONSTRAINT "item_analyses_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_contents" ADD CONSTRAINT "item_contents_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_records" ADD CONSTRAINT "score_records_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_reliability_observations" ADD CONSTRAINT "source_reliability_observations_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_event_states" ADD CONSTRAINT "user_event_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_event_states" ADD CONSTRAINT "user_event_states_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_assets" ADD CONSTRAINT "watchlist_assets_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_decisions_event_idx" ON "alert_decisions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "alert_decisions_user_idx" ON "alert_decisions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "alert_rules_user_idx" ON "alert_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "contradictions_event_idx" ON "contradictions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_assets_symbol_idx" ON "event_assets" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "event_items_item_idx" ON "event_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "event_studies_event_idx" ON "event_studies" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_updated_idx" ON "events" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "events_activity_idx" ON "events" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "events_first_seen_idx" ON "events" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "events_importance_idx" ON "events" USING btree ("importance");--> statement-breakpoint
CREATE INDEX "events_category_idx" ON "events" USING btree ("primary_category");--> statement-breakpoint
CREATE INDEX "events_verification_idx" ON "events" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "events_categories_gin" ON "events" USING gin ("categories");--> statement-breakpoint
CREATE INDEX "events_entities_gin" ON "events" USING gin ("entity_keys");--> statement-breakpoint
CREATE INDEX "failed_jobs_open_idx" ON "failed_jobs" USING btree ("resolved_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_uq" ON "feedback" USING btree ("user_id","event_id","label");--> statement-breakpoint
CREATE INDEX "feedback_event_idx" ON "feedback" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "item_analyses_outcome_idx" ON "item_analyses" USING btree ("outcome","processed_at");--> statement-breakpoint
CREATE INDEX "item_analyses_event_idx" ON "item_analyses" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "items_provider_external_uq" ON "items" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "items_processing_idx" ON "items" USING btree ("processing_state","collected_at");--> statement-breakpoint
CREATE INDEX "items_hash_idx" ON "items" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "items_published_idx" ON "items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "items_source_idx" ON "items" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "deliveries_status_idx" ON "notification_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "deliveries_notification_idx" ON "notification_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_event_idx" ON "notifications" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "pipeline_runs_job_idx" ON "pipeline_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "pipeline_runs_started_idx" ON "pipeline_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_obs_uq" ON "price_observations" USING btree ("symbol","provider","market_ts");--> statement-breakpoint
CREATE INDEX "price_obs_symbol_ts_idx" ON "price_observations" USING btree ("symbol","market_ts");--> statement-breakpoint
CREATE INDEX "notes_user_idx" ON "research_notes" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "score_records_event_idx" ON "score_records" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reliability_source_idx" ON "source_reliability_observations" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_provider_external_uq" ON "sources" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "usage_provider_day_idx" ON "usage_records" USING btree ("provider","day");--> statement-breakpoint
CREATE INDEX "verification_attempts_event_idx" ON "verification_attempts" USING btree ("event_id","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_assets_uq" ON "watchlist_assets" USING btree ("watchlist_id","symbol");--> statement-breakpoint
CREATE INDEX "watchlists_user_idx" ON "watchlists" USING btree ("user_id");
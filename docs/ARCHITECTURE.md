# Architecture

A single Next.js 16 application (App Router, TypeScript) with typed API routes, a background worker, and PostgreSQL through Drizzle ORM. It is deliberately not a microservice system: one deployable plus an optional separate worker process.

```
 Providers ─────────► Ingestion ─► items (+ item_contents) ─► Pipeline ─────────────► events ─► Alerts ─► notifications
 (RSS, X, demo)        idempotent   durable work queue        filter → classify →        │          dedupe, cooldown,   deliveries
                                                               entities → cluster →       │          quiet hours         (in-app, browser,
                                                               assets → verify → score    │                               email, Telegram, Discord)
                                                               → explain → (AI)           ▼
                                                                                 API routes ◄── SSE stream ──► Browser UI
```

## Directory layout

| Path | Responsibility |
| --- | --- |
| `src/config/` | Product name, env schema (`env.ts`, server-only), scoring weights/bands, asset alias dictionary, classification rules, category transmission map, default sources, AI pricing |
| `src/domain/` | Shared enums, labels and DTO types (no runtime server code; safe for the client) |
| `src/server/db/` | Drizzle schema, client (PGlite or node-postgres), migrations runner, seed |
| `src/server/providers/source/` | Source connectors: `rss/`, `x/` (client, provider, filtered stream), `demo/` |
| `src/server/providers/ai/` | AI provider abstraction, Claude adapter, schema, prompt, output validation |
| `src/server/providers/notify/` | Email, Telegram and Discord adapters; alert text formatting |
| `src/server/providers/market/` | Market-data provider interface (no implementation connected) |
| `src/server/pipeline/` | Pure stages (`filter`, `classify`, `entities`, `independence`, `novelty`, `assets`, `verification`, `scoring`, `explain`) and the DB-bound orchestrators (`process`, `recompute`, `budget`, `repo`) |
| `src/server/alerts/` | Pure rule matching + quiet hours (`match.ts`) and the alert engine/delivery (`engine.ts`) |
| `src/server/worker/` | Job implementations, scheduler, inline and standalone entry points |
| `src/server/services/` | Query/command logic used by API routes (events, overview, watchlists, sources, notes, notifications, users, status) |
| `src/server/api/` | Route wrapper (auth, CSRF, validation, errors) and input schemas |
| `src/server/auth/` | Password hashing, sessions, entitlements |
| `src/server/evaluation/` | NYSE calendar, event-study calculator, evaluation metrics |
| `src/app/api/` | HTTP API routes (see `docs/API.md`) |
| `src/app/(app)/` | Application pages (client components that call the API) |
| `src/components/` | UI: shell, feed, research editor, primitives, charts |

Client code may not import `@/server/*` or `@/config/env`; ESLint enforces this.

## Pipeline

1. **Collection** (`worker/jobs.ts → collectJob`) loads enabled sources and rules, enforces backpressure (`MAX_QUEUE_DEPTH`) and X budgets, calls the provider, and persists per-source outcomes, cursors (`since_id`, ETag/Last-Modified), provider health and usage.
2. **Ingestion** (`pipeline/process.ts → ingestItems`) inserts items idempotently (`UNIQUE(provider, external_id)`). Text goes to `item_contents`, which carries a retention expiry, separate from metadata.
3. **Processing** (`processPending`) claims pending items. The `items` table is a durable queue with bounded attempts (3); exhausted items go to `failed_jobs`. Each item passes through these stages:
   - **Stage 1 filter:** spam, promotion, engagement bait, low information and coordinated repetition. Tracked sources are flagged, never discarded. Instruction-like text is flagged as untrusted.
   - **Stage 2 classification:** deterministic multi-label rules with evidence. Uncategorized items can still attach to an existing event (corrections, follow-ups).
   - **Stage 3 entity resolution** against the alias dictionary, with ticker disambiguation.
   - **Stage 4 novelty/clustering** against active events (48h) and exact-text matches in the archive. Outcomes: new, exact duplicate, same claim, related, correction or contradiction. Roles: origin, corroboration, repeat, update, correction, contradiction, primary source or commentary. Independence keys group reposts, quotes, attributions and same-organization accounts.
   - **Recompute** (`recompute.ts`): verification state machine, asset mapping, importance and confidence scoring, lifecycle, explanation, material-change detection, score audit trail, verification attempts, and automatic reliability observations.
   - **Optional AI** for events at or above `MIN_SCORE_FOR_AI`, within budget and not already analyzed (cached by content hash). Output is schema-constrained and source-validated; failures leave the event rules-only with a visible warning.
4. **Alerts** run on material changes: creation, a verification change, an upward band change, a new independent source group, or a correction or dispute.
5. **Re-verification** runs every 30 min: staleness, and authoritative sources failing (`unable_to_verify`).
6. **Delivery** runs every 30 s: external channels with bounded retries (4 attempts; 1, 5 and 15 min backoff) and visible failures.
7. **Maintenance** runs hourly: retention purge, expired sessions and pruning of operational history. **X compliance** runs every 6h: availability re-check of stored posts within the read budget.

## Worker modes

- `inline` (default): the scheduler starts from `src/instrumentation.ts` inside the Next.js server, never during `next build`. Required with PGlite.
- `separate`: `npm run worker` runs the same scheduler as its own process, with graceful shutdown on SIGINT/SIGTERM. Requires `DATABASE_URL`.
- `off`: no background processing.

Each job is non-overlapping, has a timeout, records a `pipeline_runs` row, and runs independently, so one failing provider cannot stop the others. A worker heartbeat is written every 30 s. Items left "processing" by a crash are re-queued on start.

## Real-time

`GET /api/stream` (SSE) pushes `event`, `notification` and `connection` messages. Changes arrive immediately through the in-process bus and are also reconciled from the database every 3 s, which keeps it working with a separate worker. Clients reconnect with backoff, dedupe notifications by ID, and show the stream state in the top bar.

## Data model (main tables)

`users`, `sessions` (hashed tokens), `user_preferences`, `sources`, `source_reliability_observations`, `collection_rules`, `items`, `item_contents` (restricted content, purgeable), `item_analyses` (per-item pipeline trace), `events`, `event_items` (role, independence key, similarity), `event_assets`, `event_classifications`, `score_records` (audit trail), `verification_attempts`, `contradictions`, `watchlists`, `watchlist_assets`, `alert_rules`, `notifications` (unique per user + event version), `notification_deliveries`, `alert_decisions` ("why no alert"), `research_notes`, `feedback`, `user_event_states`, `audit_log`, `provider_health`, `usage_records`, `pipeline_runs`, `failed_jobs`, `worker_heartbeats`, `app_state`, `price_observations`, `event_studies`.

All timestamps are `timestamptz` (UTC) and are rendered in the user's time zone. Publication time and collection time are separate columns. Prices use `numeric`. Migrations live in `drizzle/` (generated by drizzle-kit).

## Why these choices

- **PGlite** gives real PostgreSQL semantics with zero installation, so the app runs at $0 locally and the same migrations apply to managed Postgres.
- **Cache Components is off.** Every screen is authenticated and loads data client-side through the API, so request-time rendering is simpler and more predictable.
- **Rules first, AI optional.** The deterministic baseline makes every result reproducible and explainable, and the system works without paid APIs.

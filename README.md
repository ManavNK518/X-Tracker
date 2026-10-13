# Signal Terminal

A market-intelligence research terminal. It collects posts and announcements from **authorized** sources (official RSS/Atom feeds today; the X API v2 when you add credentials), detects potentially market-moving events, scores them transparently, checks them against other sources, and helps you investigate them with structured research notes.

It answers: *what just happened, why could it matter, how credible is it, which assets could be affected, and what should I check next?*

> **Research tool only.** Importance scores rank events for research attention. They are not probabilities of price moves or trading recommendations. Nothing here predicts profitable trades.

The product name is set in one place: `src/config/product.ts`.

---

## What works today

| Area | Status |
| --- | --- |
| App shell, Overview, Live Feed, Event Intelligence, Historical Events, Watchlists, Research workspace, Alerts, Sources, System Status, Settings | Working. Responsive (desktop + mobile), with loading, empty and error states |
| Accounts | Working. First account becomes **owner**; scrypt-hashed passwords; DB-backed sessions (hashed tokens, httpOnly cookies). Optional `LOCAL_NO_LOGIN=true` skips sign-in on this computer with `npm run dev` (see [docs/SECURITY.md](docs/SECURITY.md)) |
| Database | Working. Embedded PostgreSQL (**PGlite**) with no install; managed PostgreSQL via `DATABASE_URL` (driver implemented, **not run against a real Postgres server in this environment**) |
| Official RSS/Atom collection | **Working and live.** Verified against the Federal Reserve, ECB, Bank of England, Bank of Canada, BEA and EIA feeds on 2026-10-08. SEC feeds wait for `SEC_USER_AGENT`. CFTC is off by default (it intermittently refuses automated requests; this is reported, never bypassed) |
| Event pipeline | Working. Filtering → classification → entity resolution → clustering/novelty → asset mapping → verification → importance & confidence scoring → explanation, with a score audit trail |
| Real-time updates | Working. Server-Sent Events with reconnect, dedupe, a pause/resume control and a visible connection state |
| In-app alerts | Working. Rules and watchlists; dedupe, cooldowns, hourly caps, quiet hours, escalation/correction updates, per-channel delivery tracking |
| Browser notifications | Implemented (opt-in, needs your browser's permission) |
| Demo mode | Working. Fictional, clearly labelled **SAMPLE DATA** replayed through the real pipeline |
| X API v2 | **Implemented, not connected.** Recent search, user lookup, post lookup (compliance), filtered stream. Tested only against mocked responses; needs `X_BEARER_TOKEN` (paid) |
| AI analysis (Claude) | **Implemented, not connected.** Structured outputs + source-grounded validation; tested with fake clients. Needs `ANTHROPIC_API_KEY` (paid) |
| Email / Telegram / Discord alerts | **Implemented, not verified.** Each channel shows "verified" only after a successful test send from Settings |
| Market data / event studies | Interface, calendar and calculator implemented and unit-tested; **no market-data provider is connected** |

---

## Quick start

Requirements: **Node.js 20.9+** (developed with Node 24). No database or Docker is needed.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. The first visit asks you to create the **owner** account. With no configuration the app:

- uses the embedded database in `.data/pglite` (migrations and default sources are applied on start),
- starts the background worker inside the web server (`WORKER_MODE=inline`),
- polls the free official RSS feeds every 5 minutes.

To see the interface working with sample data as well, copy `.env.example` to `.env.local` and set `DEMO_MODE=true`. Sample items are labelled everywhere and never sent to external channels.

### Windows / OneDrive notes

- The project folder path contains `&` (`Trading&Finance`), which breaks npm's Windows `.cmd` shims. All npm scripts therefore call each tool's entry file with `node` directly, so `npm run …` works. If you invoke tools yourself, use `node node_modules/<tool>/…` rather than `npx <tool>`.
- The folder is inside OneDrive. `node_modules`, `.next` and `.data` are large and change often, so OneDrive will try to sync them. Consider moving the project outside OneDrive or excluding those folders from sync. Avoid syncing `.data/` while the app is running.

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server (http://localhost:3000) |
| `npm run build` / `npm start` | Production build / server |
| `npm run worker` | Standalone worker (`WORKER_MODE=separate`, requires `DATABASE_URL`) |
| `npm run db:migrate` | Apply migrations + default seed (uses `DATABASE_URL` or PGlite) |
| `npm run db:generate` | Generate a new migration after editing `src/server/db/schema.ts` |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint (includes a rule that blocks client code from importing server modules) |
| `npm test` | Unit + integration tests (Vitest; integration tests use a real in-memory PostgreSQL) |
| `npm run test:e2e` | Playwright end-to-end journey (builds and starts the app in demo mode on port 3211) |
| `npm run check` | typecheck + lint + tests |

End-to-end tests use the installed **Microsoft Edge** on Windows. Elsewhere, run `npx playwright install chromium` once and set `PW_CHANNEL=chromium`.

---

## Configuration

All configuration is through environment variables. `.env.example` lists every variable with placeholder values and comments. Secrets are read **only on the server** and are never sent to the browser or stored in the database. The Settings → Integrations screen shows only *whether* each integration is configured.

| Feature | Variables | Cost |
| --- | --- | --- |
| Official RSS feeds | `RSS_ENABLED` (default on), `SEC_USER_AGENT` for sec.gov | Free |
| X API v2 | `X_BEARER_TOKEN`, then enable X sources on the Sources screen | **Paid** (pay-per-use) |
| AI analysis | `ANTHROPIC_API_KEY`, `AI_MODEL` | **Paid** per token |
| Email | `SMTP_*`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` | Depends on provider |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Free |
| Discord | `DISCORD_WEBHOOK_URL` | Free |
| Managed Postgres | `DATABASE_URL` | Free tiers exist (e.g. Neon, Supabase); check current limits |

External notification channels deliver only for the workspace **owner**: credentials are workspace-level, not per user.

---

## Costs (be explicit before enabling paid services)

- **Zero-cost configuration:** embedded database, official RSS feeds, rules-based analysis, in-app/browser alerts, local hosting. This has no third-party fees. Hosting it publicly is a separate cost.
- **X API (paid):** pay-per-use credits. Per [docs.x.com](https://docs.x.com/x-api/getting-started/pricing) at the time of writing: about **$0.005 per post read**, **$0.010 per user read**, and a cap of 3M post reads per billing cycle. The X Developer Console has the authoritative prices. This app bounds estimated spend with `X_MAX_DAILY_COST_USD` (default $2.50/day, covering post and author-profile reads) and `X_MAX_POST_READS_PER_DAY` (default 500). Within that, keyword rules may use at most half and deletion re-checks have a reserve of 50 reads. Estimated spend is shown on System Status; see [docs/X_API.md](docs/X_API.md#budgets). X sources and keyword rules are **disabled by default**.
- **AI (paid):** default model `claude-opus-5-5` ($4 / $20 per million input/output tokens). `claude-haiku-5-5` ($0.10 / $0.50) is roughly 40× cheaper and may suffice for this extraction task; the choice is yours via `AI_MODEL`. Bounded by `MAX_AI_ANALYSES_PER_DAY` (100) and `MAX_AI_DAILY_COST_USD` ($1). Only events scoring at or above `MIN_SCORE_FOR_AI` are analyzed, identical content is never analyzed twice, and the system prompt is cached. When the budget is reached, processing continues rules-only and System Status says so.
- Cost figures in the app are **estimates** from configured price tables, not invoices.

---

## Data honesty

- The UI always shows the data mode: **Live**, **Demo**, **Live + Demo**, **Awaiting setup**, **Disconnected** or **Offline**. A failed live feed is never replaced with sample data.
- Collection failures are reported per source and are never treated as "no news".
- Unknown values stay unknown: unassessable score components are marked *unknown*, assets show *unknown* when none can be identified, and missing links say so.
- Source links are only those returned by the provider. Sample data has no links rather than invented ones.
- Repetition is not confirmation: items are grouped by *independence* (reposts, quotes, attributions and same-organization accounts share a group).

---

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): modules, pipeline, data model, worker, real-time
- [docs/SCORING.md](docs/SCORING.md): importance and confidence, weights, unknown-component policy, bands
- [docs/VERIFICATION.md](docs/VERIFICATION.md): verification states and their exact criteria
- [docs/API.md](docs/API.md): HTTP API reference
- [docs/X_API.md](docs/X_API.md): X integration, endpoints used, rate limits, compliance and retention
- [docs/SECURITY.md](docs/SECURITY.md): authentication, authorization, CSRF, prompt-injection defences
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): production deployment
- [docs/MARKET_DATA.md](docs/MARKET_DATA.md): connecting a market-data provider and running event studies

---

## Known limitations

- **X and AI have never been called live** from this codebase; they are implemented against current documentation and tested with mocks only. Expect to adjust details (for example, endpoint access on your plan) when you first connect them.
- **PostgreSQL via `DATABASE_URL`** has not been exercised against a real server here. The same migrations run on PGlite (PostgreSQL 17 compiled to WASM) in the tests.
- The PGlite database is single-process, so the separate worker requires `DATABASE_URL`.
- The login rate limiter is in-memory (single instance). Multi-instance deployments need a shared store.
- Classification and entity resolution are rule-based baselines with a starter dictionary (`src/config/assets.ts`, `src/config/classification-rules.ts`). They will miss things and need tuning against real traffic.
- Source reliability starts **provisional**. It adjusts only after enough resolved observations, recorded automatically on authoritative confirmation or correction, or manually with evidence.
- Evaluation metrics need user feedback labels. Recall is not reported, because no labelled ground truth exists.
- No billing integration. Plans and entitlements are resolved server-side, ready for a payment provider later.
- Historical archive coverage is limited to what this installation collected.

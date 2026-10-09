# HTTP API

All endpoints live under `/api`. Responses use a consistent envelope:

```json
{ "data": … }
{ "error": { "code": "validation_error", "message": "Invalid request", "details": [{ "path": "limit", "message": "…" }], "requestId": "…" } }
```

- **Auth:** the session cookie `st_session` (httpOnly, SameSite=Lax, Secure in production over HTTPS). "user" endpoints require a session; "owner" endpoints require the workspace owner.
- **CSRF:** state-changing requests must be same-origin (`Sec-Fetch-Site` / `Origin` checked) and use `Content-Type: application/json`.
- **Errors:** 400 validation, 401 unauthenticated, 403 forbidden or cross-site, 404 not found (also returned for other users' private resources), 409 conflict, 429 rate limited, 500 internal (logged with `requestId`; no internals returned).
- **Limits:** list endpoints are paginated and bounded (`limit` ≤ 100 for feeds; 200 for notifications); request bodies ≤ 256 KB.

## Auth

| Method & path | Auth | Body / query | Returns |
| --- | --- | --- | --- |
| `GET /api/auth/setup` | public | — | `{ hasUsers, signupOpen }` |
| `POST /api/auth/signup` | public, 5/15 min | `{ email, password (≥10), displayName }` | `{ user }` + cookie. First user becomes owner; later sign-ups need `ALLOW_SIGNUP=true` |
| `POST /api/auth/login` | public, 10/15 min | `{ email, password }` | `{ user }` + cookie |
| `POST /api/auth/logout` | any | — | `{ ok }` |
| `GET /api/auth/me` | user | — | user, preferences, entitlements, unread count |
| `POST /api/auth/password` | user, 5/15 min | `{ currentPassword, newPassword }` | signs out other sessions |
| `DELETE /api/auth/sessions` | user | — | signs out everywhere |
| `POST /api/auth/account` | user | `{ password }` | deletes the account and its private data |

## Events

| Method & path | Auth | Notes |
| --- | --- | --- |
| `GET /api/feed` | user | Query: `q`, `sort` (`newest`/`importance`/`updated`), `categories`, `assets`, `sources` (UUIDs), `verification`, `minImportance`, `minConfidence`, `from`, `to` (ISO), `includeDemo`, `hideReviewed`, `savedOnly`, `cursor`, `limit`. List values are comma-separated. Keyset pagination: `{ items, nextCursor }` |
| `GET /api/history` | user | Same as feed, plus `coverage: { firstCollectionAt, complete: false }` |
| `GET /api/events/:id` | user | `id` is a UUID or `EV-…` reference. Full detail: items, assets, classifications, score history, verification attempts, contradictions, your feedback, notes and alert decisions |
| `POST /api/events/:id/state` | user | `{ saved?, reviewed? }` |
| `POST /api/events/:id/feedback` | user | `{ label: useful/irrelevant/duplicate/incorrect/late/missing_context, comment?, remove? }` |
| `GET /api/events/:id/note-draft` | user | Research-note draft pre-filled with stored source links |
| `GET /api/overview?period=24h/7d` | user | Dashboard aggregates (all computed from stored data) |
| `GET /api/stream` | user | Server-Sent Events: `connection`, `event`, `notification` |

## Watchlists & alerts

| Method & path | Auth | Notes |
| --- | --- | --- |
| `GET/POST /api/watchlists` | user | Body: `{ name, description?, minImportance, minConfidence, categories, sourceIds, keywords, notify, channels, assets: [{ symbol, name?, aliases? }] }` |
| `PUT/DELETE /api/watchlists/:id` | user (own only) | |
| `GET/POST /api/watchlists/templates` | user | `POST { templateId }` |
| `GET/POST /api/alert-rules` | user | `{ name, enabled, minImportance, minConfidence, categories, assetSymbols, sourceCategories, verificationStates, requireTimeSensitive, channels, cooldownMinutes?, includeDemo }` |
| `PUT/DELETE /api/alert-rules/:id` | user (own only) | |
| `GET /api/notifications` | user | `unreadOnly`, `limit`, `before`; includes per-channel delivery status |
| `POST /api/notifications/read` | user | `{ ids? , all? }` |
| `POST /api/notifications/test` | owner, 5/10 min | `{ channel: email/telegram/discord }`. Sends a labelled test; marks the channel verified on success |
| `PATCH /api/preferences` | user | timezone, theme, feed defaults, showDemo, quiet hours, channel toggles, displayName |

## Sources & research

| Method & path | Auth | Notes |
| --- | --- | --- |
| `GET /api/sources` | user | Includes status, errors, item counts and reliability summary |
| `POST /api/sources` | owner | `{ provider: x/rss, externalId, handle?, name, category, isPrimary, authorityDomains, organization?, topics, enabled, notes? }` |
| `PATCH/DELETE /api/sources/:id` | owner | |
| `GET/POST /api/sources/:id/reliability` | user / owner | Observations with evidence notes |
| `GET/POST /api/collection-rules`, `PUT/DELETE /api/collection-rules/:id` | user / owner | X keyword queries |
| `GET/POST /api/notes`, `GET/PUT/DELETE /api/notes/:id` | user (own only) | Research notes |
| `GET /api/assets/search?q=` | user | Alias dictionary lookup |

## Operations

| Method & path | Auth | Notes |
| --- | --- | --- |
| `GET /api/health` | public | `{ ok, db }`; 503 if the database is unreachable |
| `GET /api/status` | user | Providers, worker, queue, funnel, runs, dead letters, AI/X usage, channels. Error details only for the owner |
| `GET /api/status/connection` | user | Data mode and provider connectivity |
| `GET /api/status/trace?q=` | user | Pipeline trace and "why no alert" diagnosis for an event ref/UUID or item UUID/provider ID |
| `GET /api/status/metrics?days=` | user | Evaluation metrics (insufficient data is reported as such) |
| `GET /api/usage?days=` | user | Estimated usage and cost by provider/day |
| `GET /api/settings/info` | user | Non-secret configuration (integration booleans, budgets, retention, scoring) |
| `GET/POST /api/admin/jobs` | user / owner | List jobs / run one now (inline worker only) |
| `POST /api/admin/demo` | owner | Delete sample data and restart the demo |

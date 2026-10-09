# X (Twitter) integration

Collection uses only the official X API v2 with an app-only Bearer token. There is no scraping, no session cookies and no bot-detection workarounds.

## What was checked (docs.x.com, 2026-10-08)

- **Access model:** pay-per-use credits; no subscriptions for new developers. Legacy Basic/Pro plans are closed to new sign-ups. Enterprise is custom-priced.
- **Pricing (subject to change; the Developer Console is authoritative):** post read $0.005 per post returned, user read $0.010 per user returned; resources re-requested within the same UTC day are deduplicated (described by X as a soft guarantee). Pay-per-use is capped at 3M post reads per billing cycle.
- **Recent search:** `GET /2/tweets/search/recent`, last 7 days, `max_results` 10–100, `since_id`/`next_token`, `tweet.fields`, `expansions=author_id`, `user.fields`. The documented rate limit is 450 requests per 15 min (app).
- **Filtered stream:** `GET /2/tweets/search/stream` with `/rules`. Pay-per-use allows 1 connection and 1,000 rules of up to 1,024 characters. A keep-alive is sent about every 20 s.
- **Post lookup:** `GET /2/tweets?ids=` (up to 100), used for the compliance refresh. **User lookup:** `GET /2/users/by?usernames=`.
- **Rate-limit headers:** `x-rate-limit-limit`, `-remaining`, `-reset` (unix seconds). HTTP 429 when exceeded.

Endpoint availability can differ by account; it has **not** been verified against a live account from this codebase.

## How the app uses it

- **Registered accounts** (Sources screen): handles are resolved to user IDs once, then polled with batched `from:a OR from:b … -is:retweet` queries of at most 512 characters, with a per-group `since_id` cursor. Only following pages when catching up keeps reads low.
- **Keyword rules** (Sources → X keyword rules): focused recent-search queries with their own interval, `max_results` and cursor. They are off by default, and the editor shows a worst-case cost estimate. Keyword-rule results include the author's profile (one billed user read per post).
- **Fair scheduling (search mode):** each run, account groups and due keyword rules are ordered least-recently-run first and run until the run's limits are reached. Anything left over is deferred, not marked as run, so it goes first next time. Deferrals show on System Status.
- **Stream mode** (`X_COLLECTION_MODE=stream`): rules are reconciled from enabled accounts and keyword rules. The client reconnects with backoff (network: linear up to 16 s; HTTP: exponential from 5 s; 429: exponential from 60 s), resets after a stable connection, gives up after 8 consecutive failures per cycle, and stops when the daily budget is spent. Each delivered post is recorded as a post read plus its expanded author profile. When keyword rules reach their share of the budget, the stream reconnects with account rules only.
- **Failure handling:** 401/403/402 stop immediately with a visible error, 429 surfaces the reset time and leaves the remaining queries for a later run, and 5xx/network errors retry with exponential backoff and jitter, bounded. Failures are never treated as "no posts".

## Budgets

Every request, post read and user read is recorded in `usage_records` with an estimated cost and a purpose (`accounts`, `keyword_rule` or `compliance`). Limits per UTC day:

| Setting | Default | What it limits |
| --- | --- | --- |
| `X_MAX_DAILY_COST_USD` | 2.50 | Estimated spend on all X reads (posts and author profiles) |
| `X_MAX_POST_READS_PER_DAY` | 500 | Post reads of every kind |
| `X_COMPLIANCE_MAX_READS_PER_DAY` | 50 | Deletion re-checks. Held back from the two caps above, so collection cannot crowd them out and they cannot crowd out collection |
| `X_KEYWORD_RULE_BUDGET_SHARE` | 0.5 | Share of the cost cap keyword rules may use; registered accounts keep the rest |
| `MAX_SOURCE_QUERIES_PER_HOUR` | 30 | Search requests per rolling hour (rate-limit and runaway guard; empty responses are not billed) |

The estimate may run high: X describes same-day re-reads as deduplicated, and the app does not assume that.

## Display, storage and deletion

- Posts are shown with the author's name and handle, the unmodified text, and a link to the original post.
- Post text is stored in `item_contents`, separate from event metadata, and expires after `X_CONTENT_RETENTION_DAYS` (default 30).
- **Compliance refresh** (`X_COMPLIANCE_REFRESH_HOURS`, default 24): stored posts are re-checked via post lookup. The first check happens once a post is that old, and later checks happen each time its age doubles (about 1, 2, 4, 8 and 16 days), so a post gets about 5 checks over its 30-day retention instead of about 30. Never-checked posts go first, and checks stay within `X_COMPLIANCE_MAX_READS_PER_DAY`. Only posts that still exist are billed. Posts that are no longer available (deleted, protected, withheld) have their content purged immediately, while event metadata and scores are kept.
- **Trade-off:** with many stored posts, the daily reserve spaces checks further apart, so a deletion can take longer to detect. Raise `X_COMPLIANCE_MAX_READS_PER_DAY` or lower `X_CONTENT_RETENTION_DAYS` if you need faster detection, and check the X Developer Agreement for current deletion obligations.
- Do not resell or republish collected X content without confirming your rights under the X Developer Agreement and Policy.

## Setup

1. Create a project and app at https://console.x.com, buy credits, and copy the app's Bearer token.
2. Set `X_BEARER_TOKEN` in `.env.local` (or your host's secrets) and restart.
3. On the Sources screen, enable the X accounts you want. Optionally enable a keyword rule.
4. Watch System Status → "X API usage" for reads and estimated spend.

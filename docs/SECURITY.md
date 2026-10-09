# Security & privacy

## Authentication and sessions

- Passwords are hashed with **scrypt** (N=2^15, r=8, p=1, 16-byte salt) via Node's crypto module and compared in constant time. The minimum length is 10 characters.
- Sessions are random 256-bit tokens. Only their SHA-256 hash is stored, so a database leak does not expose usable tokens. Cookies are `httpOnly`, `SameSite=Lax`, `Secure` in production over HTTPS, slide when half-expired, and are deleted on logout. Changing your password signs out every other session.
- Unknown emails get the same error message and similar timing as wrong passwords.
- Login, signup, password change, account deletion and notification tests are rate-limited per IP. The limiter is **in-memory** (single instance); move it to a shared store for multi-instance deployments.
- `proxy.ts` only redirects page requests that have no session cookie. Real authorization happens in every API route against the database.

## Authorization and isolation

- Watchlists, alert rules, notes, notifications, feedback and saved/reviewed states are queried with the caller's user ID. Other users' resources return 404.
- Source management, integration tests, job triggers and demo reset require the **owner** role on the server.
- Plans and entitlements come only from the database; no client flag grants access.

## Request handling

- All inputs are validated with Zod (bounded lengths, enums, UUIDs and symbol patterns).
- **CSRF:** state-changing requests must be same-origin (`Sec-Fetch-Site`/`Origin`) and JSON-typed. SameSite=Lax cookies add defense in depth.
- Errors return a code and message plus a request ID; stack traces and internals are logged server-side only.
- **XSS:** all third-party text is rendered as text by React (no `dangerouslySetInnerHTML`). Links are only rendered for absolute http(s) URLs (`safeHttpUrl`), with `rel="noopener noreferrer nofollow"`.
- Production builds send a Content-Security-Policy, plus `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and `Permissions-Policy`.
- The RSS parser rejects documents that declare XML entities (entity-expansion attacks) and limits feed size.

## Secrets

- All credentials are server-side environment variables (`src/config/env.ts`). They are never sent to the browser and never stored in the database. `/api/settings/info` returns booleans only, and a test asserts that no secret value appears in API responses.
- ESLint forbids client code from importing server modules or the env config.
- Logs are structured JSON with key-based and pattern-based redaction (tokens, `Bearer …`, `sk-ant-…`, webhook URLs, Telegram bot tokens).
- `.env*` files are git-ignored except `.env.example`, which contains placeholders only.

## AI safety and prompt injection

- All collected content is treated as untrusted data. It goes only in the user turn, inside `<untrusted_source_content>` delimiters, and look-alike delimiter tags in the content are neutralized.
- The system prompt is fixed and tells the model never to follow instructions found in the content. The model has no tools, so it cannot act, browse, change configuration or read other data.
- Output is schema-constrained (structured outputs), then validated against the source text. Claims must quote the source verbatim or they are dropped, tickers must exist in the dictionary or the text, URLs are stripped, and lengths are capped. Timestamps, URLs, verification status and source identity never come from the model.
- Instruction-like text is flagged by the deterministic filter, shown in the UI, and caps confidence at 35. The model's flag is recorded too.
- Model failures (timeouts, refusals, malformed output, budget limits) leave the event rules-only, with a visible warning. No placeholder analysis or alerts are generated.

## Data minimization

Each user record holds an email, display name, password hash and preferences. No IP addresses are stored with sessions. Third-party content is stored separately and purged on retention expiry or when a provider reports it unavailable.

## Dependency review

Run `npm audit` periodically. This project pins exact major versions of Next.js and React and relies on a small set of well-known dependencies (Drizzle, PGlite, pg, Zod, TanStack Query, fast-xml-parser, nodemailer, the Anthropic SDK).

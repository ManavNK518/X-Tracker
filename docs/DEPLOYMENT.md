# Deployment

Nothing in this repository has been deployed. The steps below describe a supported setup; verify them on your platform.

## Option A: single Node server (simplest)

Suitable for a personal workspace on a VM or container host (e.g. Fly.io, Railway, Render, a small VPS).

1. Provision managed PostgreSQL (Neon, Supabase, RDS, …) and set `DATABASE_URL`. PGlite can also be used on a single machine with a persistent disk (`PGLITE_DATA_DIR` on a mounted volume), but managed Postgres is recommended.
2. Set the environment variables (see `.env.example`). At minimum: `APP_URL` (your https URL) and `NODE_ENV=production`.
3. Build and start:
   ```bash
   npm ci
   npm run build
   npm start
   ```
   Migrations and default seeding run automatically at startup (`DB_AUTO_MIGRATE=true`). Alternatively, run `npm run db:migrate` as a release step and set `DB_AUTO_MIGRATE=false`.
4. Keep `WORKER_MODE=inline` so the background jobs run in the same process. Run exactly **one** instance, since the inline worker is not designed for multiple replicas.
5. Point your platform's health check at `GET /api/health`.

## Option B: web + separate worker

For more traffic, or when the web tier scales horizontally:

- Web service: `npm start` with `WORKER_MODE=off`.
- Worker service: `npm run worker` with `WORKER_MODE=separate`, using the same `DATABASE_URL` and secrets. Run **one** worker replica, because job locking is in-process.
- Live updates still work, because the SSE endpoint reconciles from the database every few seconds.
- Move the login rate limiter to a shared store if you run several web replicas.

## Serverless platforms

Serverless hosts (e.g. Vercel functions) do not keep a long-running in-process worker, and long-lived SSE connections are limited. Use Option B with the worker on a container or VM, and check your platform's streaming limits. PGlite is not suitable on serverless.

## Checklist

- [ ] `APP_URL` uses https (enables `Secure` cookies)
- [ ] Secrets set in the platform's secret manager, not committed
- [ ] Only one worker running
- [ ] X sources enabled deliberately, with `X_MAX_POST_READS_PER_DAY` set to your budget
- [ ] AI budget limits set (`MAX_AI_ANALYSES_PER_DAY`, `MAX_AI_DAILY_COST_USD`)
- [ ] `SEC_USER_AGENT` set if you want sec.gov feeds
- [ ] Notification channels tested from Settings → Notifications
- [ ] Backups enabled on your Postgres provider

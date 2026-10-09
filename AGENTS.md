<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project notes (Signal Terminal)

- npm scripts call tools via `node node_modules/<tool>/…` because the folder path contains `&`, which breaks npm's Windows `.cmd` shims. Keep it that way when adding scripts.
- Client code (`src/components`, `src/lib/client`, pages, layouts) must not import `@/server/*` or `@/config/env`; ESLint enforces this.
- Pipeline stages in `src/server/pipeline/` are pure and unit-tested; DB-bound orchestration lives in `process.ts` / `recompute.ts`. Integration tests use a real in-memory PostgreSQL (PGlite) with the production migrations.
- Never add fabricated data: demo content is fictional, labelled, URL-less, and isolated by `is_demo`.
- After editing `src/server/db/schema.ts`, run `npm run db:generate` and commit the generated migration in `drizzle/`.
- Before finishing: `npm run check`, `npm run build`, and `npm run test:e2e`.

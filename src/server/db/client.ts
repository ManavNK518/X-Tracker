import fs from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getEnv } from "@/config/env";
import { logger } from "@/server/lib/logger";
import * as schema from "./schema";

/**
 * Database access.
 *  - DATABASE_URL set  -> PostgreSQL via node-postgres (production / managed Postgres).
 *  - otherwise         -> PGlite (embedded PostgreSQL compiled to WASM) in PGLITE_DATA_DIR.
 *
 * PGlite is single-process: with PGlite the worker must run inline (WORKER_MODE=inline).
 * Both drivers expose the same Drizzle query-builder API, so the rest of the code is
 * driver-agnostic.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATIONS_DIR = path.resolve(process.cwd(), "drizzle");

interface DbHandle {
  db: Db;
  kind: "pglite" | "postgres";
  close: () => Promise<void>;
}

type GlobalWithDb = typeof globalThis & { __signalDb?: Promise<DbHandle> };
const g = globalThis as GlobalWithDb;

export async function getDbHandle(): Promise<DbHandle> {
  if (!g.__signalDb) {
    g.__signalDb = openDatabase().catch((error) => {
      g.__signalDb = undefined;
      throw error;
    });
  }
  return g.__signalDb;
}

export async function getDb(): Promise<Db> {
  return (await getDbHandle()).db;
}

async function openDatabase(): Promise<DbHandle> {
  const env = getEnv();
  let handle: DbHandle;
  if (env.DATABASE_URL) {
    handle = await openPostgres(env.DATABASE_URL);
  } else {
    if (env.WORKER_MODE === "separate") {
      throw new Error(
        "WORKER_MODE=separate requires DATABASE_URL (PostgreSQL). The embedded PGlite database supports a single process; use WORKER_MODE=inline for local development.",
      );
    }
    // Runtime data directory: excluded from build-time file tracing.
    const dir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.PGLITE_DATA_DIR);
    fs.mkdirSync(dir, { recursive: true });
    handle = await openPglite(dir);
  }
  if (env.DB_AUTO_MIGRATE) {
    await runMigrations(handle);
    const { seedDefaults } = await import("./seed");
    await seedDefaults(handle.db);
  }
  logger.info("database.ready", { kind: handle.kind });
  return handle;
}

async function openPostgres(url: string): Promise<DbHandle> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  pool.on("error", (error) => logger.error("database.pool_error", { error: error.message }));
  const db = drizzle(pool, { schema }) as unknown as Db;
  return { db, kind: "postgres", close: () => pool.end() };
}

/** Opens PGlite at a directory, or in memory when `dataDir` is undefined (tests). */
export async function openPglite(dataDir?: string): Promise<DbHandle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  await client.waitReady;
  const db = drizzle(client, { schema }) as unknown as Db;
  return { db, kind: "pglite", close: () => client.close() };
}

export async function runMigrations(handle: DbHandle): Promise<void> {
  if (handle.kind === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(handle.db as any, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(handle.db as any, { migrationsFolder: MIGRATIONS_DIR });
  }
}

/** Creates a fresh, migrated in-memory database. Used by integration tests. */
export async function createTestDatabase(): Promise<DbHandle> {
  const handle = await openPglite(undefined);
  await runMigrations(handle);
  return handle;
}

export async function closeDb(): Promise<void> {
  const pending = g.__signalDb;
  g.__signalDb = undefined;
  if (pending) {
    const handle = await pending.catch(() => null);
    await handle?.close();
  }
}

export async function pingDb(): Promise<boolean> {
  try {
    const db = await getDb();
    await db.select({ key: schema.appState.key }).from(schema.appState).limit(1);
    return true;
  } catch {
    return false;
  }
}

export { schema };

/**
 * Applies database migrations (and idempotent default seeding).
 * Usage: npm run db:migrate
 * Uses DATABASE_URL when set, otherwise the local PGlite database.
 */
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

async function main() {
  process.env.DB_AUTO_MIGRATE = "true";
  const { getDbHandle, closeDb } = await import("../src/server/db/client");
  const handle = await getDbHandle();
  console.log(`Migrations applied (${handle.kind}).`);
  await closeDb();
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

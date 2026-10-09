/**
 * Standalone worker process (WORKER_MODE=separate, requires DATABASE_URL).
 * Usage: npm run worker
 */
import { loadEnvFiles } from "../../../scripts/load-env";

loadEnvFiles();

async function main() {
  const { getEnv } = await import("@/config/env");
  const env = getEnv();
  if (env.WORKER_MODE !== "separate") {
    console.warn(
      `WORKER_MODE is "${env.WORKER_MODE}". The standalone worker is intended for WORKER_MODE=separate; make sure the web server is not also running an inline worker.`,
    );
  }
  const { startScheduler } = await import("./scheduler");
  const { closeDb } = await import("@/server/db/client");
  const handle = await startScheduler("separate");
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down worker…`);
    await handle.stop();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Worker failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});

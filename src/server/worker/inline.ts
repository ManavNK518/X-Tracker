import { logger } from "@/server/lib/logger";
import { startScheduler } from "./scheduler";

export async function startInlineWorker(): Promise<void> {
  const handle = await startScheduler("inline");
  const shutdown = () => {
    void handle.stop();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  logger.info("worker.inline_ready", { workerId: handle.workerId });
}

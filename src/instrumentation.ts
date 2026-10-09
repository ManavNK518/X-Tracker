/**
 * Next.js server startup hook. In WORKER_MODE=inline (default for local
 * development with the embedded database) the background scheduler runs inside
 * the web server process. It is never started during `next build`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const mode = process.env.WORKER_MODE ?? "inline";
  if (mode !== "inline") return;
  // Defer so server startup is not blocked by database migration / provider setup.
  setTimeout(() => {
    import("./server/worker/inline")
      .then((m) => m.startInlineWorker())
      .catch((error) => console.error("[worker] failed to start inline worker:", error instanceof Error ? error.message : error));
  }, 500);
}

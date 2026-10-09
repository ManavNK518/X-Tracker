import { hostname } from "node:os";
import { eq } from "drizzle-orm";
import { getEnv, type Env } from "@/config/env";
import { getDb, type Db } from "@/server/db/client";
import { pipelineRuns, workerHeartbeats } from "@/server/db/schema";
import { errorMessage, logger } from "@/server/lib/logger";
import { buildPipelineContext } from "@/server/runtime";
import {
  analyzeJob,
  collectJob,
  deliverJob,
  ensureDemo,
  maintenanceJob,
  recoverAfterRestart,
  reverifyJob,
  xComplianceJob,
  xStreamJob,
  type JobContext,
  type JobResult,
} from "./jobs";

/**
 * Lightweight in-process scheduler. Each job runs on its own interval, never
 * overlaps with itself, has a timeout, and records a pipeline_runs row. One
 * failing job (or provider) cannot stop the others.
 */
interface JobDef {
  name: string;
  intervalMs: number;
  timeoutMs: number;
  /** Whether to write a pipeline_runs row for no-op runs. */
  recordSkips?: boolean;
  run: (job: JobContext) => Promise<JobResult>;
}

export interface SchedulerHandle {
  workerId: string;
  stop: () => Promise<void>;
  runNow: (name: string) => Promise<JobResult | null>;
  jobNames: () => string[];
}

type GlobalWithScheduler = typeof globalThis & { __signalScheduler?: SchedulerHandle };
const g = globalThis as GlobalWithScheduler;

export function getRunningScheduler(): SchedulerHandle | null {
  return g.__signalScheduler ?? null;
}

export function defineJobs(env: Env): JobDef[] {
  const jobs: JobDef[] = [
    { name: "collect:rss", intervalMs: env.RSS_POLL_SECONDS * 1000, timeoutMs: 120_000, run: (j) => collectJob(j, "rss") },
    { name: "analyze", intervalMs: 5_000, timeoutMs: 300_000, run: analyzeJob },
    { name: "reverify", intervalMs: 30 * 60_000, timeoutMs: 300_000, run: reverifyJob },
    { name: "deliver", intervalMs: 30_000, timeoutMs: 120_000, run: deliverJob },
    { name: "maintenance", intervalMs: 60 * 60_000, timeoutMs: 300_000, run: maintenanceJob },
  ];
  if (env.X_COLLECTION_MODE === "stream") {
    jobs.push({ name: "collect:x-stream", intervalMs: 60_000, timeoutMs: 24 * 3_600_000, run: xStreamJob });
  } else {
    jobs.push({ name: "collect:x", intervalMs: env.X_POLL_SECONDS * 1000, timeoutMs: 120_000, run: (j) => collectJob(j, "x") });
  }
  jobs.push({ name: "x:compliance", intervalMs: 6 * 3_600_000, timeoutMs: 300_000, run: xComplianceJob });
  if (env.DEMO_MODE) {
    jobs.push({ name: "collect:demo", intervalMs: Math.max(2, Math.min(env.DEMO_INTERVAL_SECONDS || 2, 10)) * 1000, timeoutMs: 60_000, run: (j) => collectJob(j, "demo") });
  }
  return jobs;
}

export async function runJobOnce(db: Db, env: Env, def: JobDef, signal: AbortSignal): Promise<JobResult> {
  const pipeline = buildPipelineContext(db, env);
  const [run] = await db.insert(pipelineRuns).values({ job: def.name, status: "running" }).returning({ id: pipelineRuns.id });
  let result: JobResult;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), def.timeoutMs);
  const combined = AbortSignal.any([signal, timeout.signal]);
  try {
    result = await Promise.race([
      def.run({ pipeline, env, signal: combined }),
      new Promise<JobResult>((_, reject) => combined.addEventListener("abort", () => reject(new Error(`job ${def.name} aborted or timed out`)), { once: true })),
    ]);
  } catch (error) {
    result = { status: "error", stats: {}, error: errorMessage(error) };
  } finally {
    clearTimeout(timer);
  }
  const quietSkip = result.status === "ok" && def.name === "analyze" && (result.stats.processed as number) === 0;
  if (quietSkip || (result.status === "skipped" && !def.recordSkips && def.name === "collect:x" && result.stats.reason === "not configured")) {
    await db.delete(pipelineRuns).where(eq(pipelineRuns.id, run.id));
  } else {
    await db
      .update(pipelineRuns)
      .set({ status: result.status, finishedAt: new Date(), stats: result.stats, error: result.error ?? null })
      .where(eq(pipelineRuns.id, run.id));
  }
  if (result.status === "error") logger.warn("job.failed", { job: def.name, error: result.error });
  return result;
}

export async function startScheduler(mode: "inline" | "separate"): Promise<SchedulerHandle> {
  if (g.__signalScheduler) return g.__signalScheduler;
  const env = getEnv();
  const db = await getDb();
  const workerId = `${hostname()}:${process.pid}:${mode}`;
  const controller = new AbortController();
  const jobs = defineJobs(env);
  const running = new Map<string, Promise<JobResult>>();
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;

  const recovered = await recoverAfterRestart(db);
  if (env.DEMO_MODE) await ensureDemo(db);
  logger.info("worker.started", { workerId, jobs: jobs.map((j) => j.name), recovered });

  const tick = (def: JobDef) => {
    if (stopped || running.has(def.name)) return;
    const p = runJobOnce(db, env, def, controller.signal)
      .catch((error) => ({ status: "error", stats: {}, error: errorMessage(error) }) as JobResult)
      .finally(() => running.delete(def.name));
    running.set(def.name, p);
  };

  const beat = async () => {
    try {
      const now = new Date();
      await db
        .insert(workerHeartbeats)
        .values({ workerId, mode, startedAt: now, lastBeatAt: now, info: { pid: process.pid, running: [...running.keys()] } })
        .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { lastBeatAt: now, info: { pid: process.pid, running: [...running.keys()] } } });
    } catch (error) {
      logger.warn("worker.heartbeat_failed", { error: errorMessage(error) });
    }
  };
  await db.delete(workerHeartbeats).where(eq(workerHeartbeats.workerId, workerId));
  await beat();
  timers.push(setInterval(beat, 30_000));

  // Stagger first runs so startup is not a thundering herd.
  jobs.forEach((def, i) => {
    timers.push(setTimeout(() => tick(def), 1_000 + i * 750));
    timers.push(setInterval(() => tick(def), def.intervalMs));
  });

  const handle: SchedulerHandle = {
    workerId,
    jobNames: () => jobs.map((j) => j.name),
    runNow: async (name: string) => {
      const def = jobs.find((j) => j.name === name);
      if (!def) return null;
      const existing = running.get(name);
      if (existing) return existing;
      tick(def);
      return running.get(name) ?? null;
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      timers.forEach((t) => clearTimeout(t));
      controller.abort();
      const pending = [...running.values()];
      await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, 10_000))]);
      await db.delete(workerHeartbeats).where(eq(workerHeartbeats.workerId, workerId)).catch(() => undefined);
      g.__signalScheduler = undefined;
      logger.info("worker.stopped", { workerId });
    },
  };
  g.__signalScheduler = handle;
  return handle;
}

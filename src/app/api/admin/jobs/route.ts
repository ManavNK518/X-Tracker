import { api, parseBody } from "@/server/api/handler";
import { RunJobBody } from "@/server/api/schemas";
import { badRequest } from "@/server/lib/errors";
import { audit } from "@/server/services/audit";
import { getRunningScheduler } from "@/server/worker/scheduler";

export const GET = api({ auth: "user" }, async ({ env }) => {
  const scheduler = getRunningScheduler();
  return { workerMode: env.WORKER_MODE, inProcess: Boolean(scheduler), jobs: scheduler?.jobNames() ?? [] };
});

/** Runs a scheduled job immediately (inline worker only). */
export const POST = api({ auth: "owner", rateLimit: { name: "run-job", limit: 20, windowMs: 60_000 } }, async ({ req, db, user }) => {
  const { job } = await parseBody(req, RunJobBody);
  const scheduler = getRunningScheduler();
  if (!scheduler) throw badRequest("No in-process worker is running (WORKER_MODE is not inline). Trigger jobs from the worker process instead.");
  if (!scheduler.jobNames().includes(job)) throw badRequest(`Unknown job: ${job}`);
  await audit(db, { userId: user!.id, action: "job.run", entityType: "job", entityId: job });
  const result = await scheduler.runNow(job);
  return { job, result };
});

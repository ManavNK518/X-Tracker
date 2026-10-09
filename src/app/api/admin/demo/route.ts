import { api } from "@/server/api/handler";
import { badRequest } from "@/server/lib/errors";
import { audit } from "@/server/services/audit";
import { resetDemo } from "@/server/worker/jobs";

/** Deletes all sample data and restarts the scripted demo. Never touches live data. */
export const POST = api({ auth: "owner" }, async ({ db, env, user }) => {
  if (!env.DEMO_MODE) throw badRequest("Demo mode is off (DEMO_MODE=false).");
  await resetDemo(db);
  await audit(db, { userId: user!.id, action: "demo.reset", entityType: "demo" });
  return { reset: true };
});

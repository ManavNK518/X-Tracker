import { api, parseBody } from "@/server/api/handler";
import { EventStateBody } from "@/server/api/schemas";
import { setEventState } from "@/server/services/events";

/** Save / mark reviewed (per user). */
export const POST = api<{ id: string }>({ auth: "user" }, async ({ req, db, user, params }) => {
  const body = await parseBody(req, EventStateBody);
  return setEventState(db, user!.id, params.id, body);
});

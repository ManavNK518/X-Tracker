import { api, parseBody } from "@/server/api/handler";
import { ReliabilityObservationBody } from "@/server/api/schemas";
import { addReliabilityObservation, listReliabilityObservations } from "@/server/services/sources";

/** Evidence behind reliability adjustments. Observations are recorded with a note; popularity is never an input. */
export const GET = api<{ id: string }>({ auth: "user" }, async ({ db, params }) => {
  const rows = await listReliabilityObservations(db, params.id);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
});

export const POST = api<{ id: string }>({ auth: "owner" }, async ({ req, db, user, params }) =>
  addReliabilityObservation(db, user!, params.id, await parseBody(req, ReliabilityObservationBody)),
);

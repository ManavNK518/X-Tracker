import { api } from "@/server/api/handler";
import { pingDb } from "@/server/db/client";

/** Public liveness/readiness probe for hosting platforms. Reveals no configuration. */
export const GET = api({ auth: "public" }, async () => {
  const db = await pingDb();
  return Response.json({ ok: db, db }, { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } });
});

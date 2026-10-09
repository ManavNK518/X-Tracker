import { api } from "@/server/api/handler";
import { invalidateSession } from "@/server/auth/session";

export const POST = api({ auth: "public" }, async ({ db, sessionToken, cookies }) => {
  if (sessionToken) await invalidateSession(db, sessionToken);
  cookies.clear();
  return { ok: true };
});

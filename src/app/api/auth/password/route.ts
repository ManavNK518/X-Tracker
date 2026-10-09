import { api, parseBody } from "@/server/api/handler";
import { ChangePasswordBody } from "@/server/api/schemas";
import { changePassword } from "@/server/services/users";

export const POST = api({ auth: "user", rateLimit: { name: "password", limit: 5, windowMs: 15 * 60_000 } }, async ({ req, db, env, user, cookies }) => {
  const body = await parseBody(req, ChangePasswordBody);
  const session = await changePassword(db, env, user!, body);
  cookies.set(session.token, session.expiresAt);
  return { ok: true, otherSessionsSignedOut: true };
});

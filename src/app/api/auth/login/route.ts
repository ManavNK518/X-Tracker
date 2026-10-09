import { api, parseBody } from "@/server/api/handler";
import { LoginBody } from "@/server/api/schemas";
import { login } from "@/server/services/users";

export const POST = api({ auth: "public", rateLimit: { name: "login", limit: 10, windowMs: 15 * 60_000 } }, async ({ req, db, env, cookies }) => {
  const body = await parseBody(req, LoginBody);
  const { user, session } = await login(db, env, body);
  cookies.set(session.token, session.expiresAt);
  return { user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } };
});

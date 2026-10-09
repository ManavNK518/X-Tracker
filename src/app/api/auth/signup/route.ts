import { api, parseBody } from "@/server/api/handler";
import { SignupBody } from "@/server/api/schemas";
import { signup } from "@/server/services/users";

export const POST = api({ auth: "public", rateLimit: { name: "signup", limit: 5, windowMs: 15 * 60_000 } }, async ({ req, db, env, cookies }) => {
  const body = await parseBody(req, SignupBody);
  const { user, session } = await signup(db, env, body);
  cookies.set(session.token, session.expiresAt);
  return { user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } };
});

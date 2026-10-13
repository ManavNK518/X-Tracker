import { api } from "@/server/api/handler";
import { localNoLoginApplies } from "@/server/auth/local-mode";
import { hasAnyUser } from "@/server/services/users";

/**
 * Public: tells the login screen whether the first (owner) account still needs
 * to be created, and whether sign-in is turned off on this computer.
 */
export const GET = api({ auth: "public" }, async ({ req, db, env }) => {
  const hasUsers = await hasAnyUser(db);
  return { hasUsers, signupOpen: !hasUsers || env.ALLOW_SIGNUP, localMode: localNoLoginApplies(req.headers) };
});

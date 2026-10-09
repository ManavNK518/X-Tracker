import { api } from "@/server/api/handler";
import { hasAnyUser } from "@/server/services/users";

/** Public: tells the login screen whether the first (owner) account still needs to be created. */
export const GET = api({ auth: "public" }, async ({ db, env }) => {
  const hasUsers = await hasAnyUser(db);
  return { hasUsers, signupOpen: !hasUsers || env.ALLOW_SIGNUP };
});

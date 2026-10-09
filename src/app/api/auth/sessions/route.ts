import { api } from "@/server/api/handler";
import { signOutEverywhere } from "@/server/services/users";

/** Signs the user out of every session, including this one. */
export const DELETE = api({ auth: "user" }, async ({ db, env, user, cookies }) => {
  const removed = await signOutEverywhere(db, env, user!);
  cookies.clear();
  return { removed };
});

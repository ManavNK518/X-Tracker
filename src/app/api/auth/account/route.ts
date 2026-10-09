import { z } from "zod";
import { api, parseBody } from "@/server/api/handler";
import { deleteAccount } from "@/server/services/users";

const Body = z.object({ password: z.string().min(1).max(200) });

/** Permanently deletes the user's account and all private data (watchlists, notes, notifications). */
export const POST = api({ auth: "user", rateLimit: { name: "delete-account", limit: 3, windowMs: 15 * 60_000 } }, async ({ req, db, user, cookies }) => {
  const { password } = await parseBody(req, Body);
  await deleteAccount(db, user!, password);
  cookies.clear();
  return { deleted: true };
});

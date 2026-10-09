import { api, parseBody } from "@/server/api/handler";
import { PreferencesBody } from "@/server/api/schemas";
import { getMe, updatePreferences } from "@/server/services/users";

export const PATCH = api({ auth: "user" }, async ({ req, db, user }) => {
  const body = await parseBody(req, PreferencesBody);
  await updatePreferences(db, user!, body);
  return getMe(db, { ...user!, displayName: body.displayName ?? user!.displayName });
});

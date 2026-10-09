import { eq } from "drizzle-orm";
import { api, parseQuery } from "@/server/api/handler";
import { FeedQuery } from "@/server/api/schemas";
import { userPreferences } from "@/server/db/schema";
import { listEvents } from "@/server/services/events";

export const GET = api({ auth: "user" }, async ({ req, db, user }) => {
  const query = parseQuery(req, FeedQuery);
  const [prefs] = await db.select({ showDemo: userPreferences.showDemo }).from(userPreferences).where(eq(userPreferences.userId, user!.id));
  return listEvents(db, user!.id, query, { includeDemo: prefs?.showDemo ?? true });
});

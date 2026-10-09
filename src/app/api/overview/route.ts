import { eq } from "drizzle-orm";
import { z } from "zod";
import { api, parseQuery } from "@/server/api/handler";
import { userPreferences } from "@/server/db/schema";
import { getOverview } from "@/server/services/overview";

const Query = z.object({ period: z.enum(["24h", "7d"]).default("24h") });

export const GET = api({ auth: "user" }, async ({ req, db, env, user }) => {
  const { period } = parseQuery(req, Query);
  const [prefs] = await db.select({ showDemo: userPreferences.showDemo }).from(userPreferences).where(eq(userPreferences.userId, user!.id));
  return getOverview(db, env, user!.id, { includeDemo: prefs?.showDemo ?? true, period });
});

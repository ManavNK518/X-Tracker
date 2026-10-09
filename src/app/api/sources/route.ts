import { eq } from "drizzle-orm";
import { api, parseBody } from "@/server/api/handler";
import { SourceBody } from "@/server/api/schemas";
import { userPreferences } from "@/server/db/schema";
import { createSource, listSources } from "@/server/services/sources";

export const GET = api({ auth: "user" }, async ({ db, user, env }) => {
  const [prefs] = await db.select({ showDemo: userPreferences.showDemo }).from(userPreferences).where(eq(userPreferences.userId, user!.id));
  return listSources(db, { includeDemo: env.DEMO_MODE && (prefs?.showDemo ?? true) });
});

export const POST = api({ auth: "owner" }, async ({ req, db, user }) => createSource(db, user!, await parseBody(req, SourceBody)));

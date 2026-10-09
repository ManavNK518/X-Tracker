import { z } from "zod";
import { api, parseQuery } from "@/server/api/handler";
import { trace } from "@/server/services/status";

const Query = z.object({ q: z.string().trim().min(1).max(200) });

/** "Why didn't I get an alert?" — traces a post or event through the pipeline. */
export const GET = api({ auth: "user" }, async ({ req, db, user }) => trace(db, user!, parseQuery(req, Query).q));

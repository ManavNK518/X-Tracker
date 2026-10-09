import { z } from "zod";
import { api, parseQuery } from "@/server/api/handler";
import { usageByDay } from "@/server/services/status";

const Query = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) });

/** Estimated usage and cost by provider and day (estimates from published pricing; not invoices). */
export const GET = api({ auth: "user" }, async ({ req, db }) => usageByDay(db, parseQuery(req, Query).days));

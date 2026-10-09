import { z } from "zod";
import { api, parseQuery } from "@/server/api/handler";
import { computeMetrics } from "@/server/evaluation/metrics";

const Query = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  includeDemo: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
});

export const GET = api({ auth: "user" }, async ({ req, db }) => {
  const q = parseQuery(req, Query);
  return computeMetrics(db, { days: q.days, includeDemo: q.includeDemo });
});

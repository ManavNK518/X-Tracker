import { z } from "zod";
import { api, parseQuery } from "@/server/api/handler";
import { listNotifications } from "@/server/services/notifications";

const Query = z.object({
  unreadOnly: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime({ offset: true }).optional(),
});

export const GET = api({ auth: "user" }, async ({ req, db, user }) => listNotifications(db, user!.id, parseQuery(req, Query)));

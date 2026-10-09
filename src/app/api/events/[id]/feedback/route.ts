import { api, parseBody } from "@/server/api/handler";
import { FeedbackBody } from "@/server/api/schemas";
import { setFeedback } from "@/server/services/events";

/** Alert-quality feedback (useful / irrelevant / duplicate / incorrect / late / missing context). */
export const POST = api<{ id: string }>({ auth: "user" }, async ({ req, db, user, params }) => {
  const body = await parseBody(req, FeedbackBody);
  return { labels: await setFeedback(db, user!.id, params.id, body) };
});

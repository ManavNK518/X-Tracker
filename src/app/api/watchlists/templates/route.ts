import { z } from "zod";
import { api, parseBody } from "@/server/api/handler";
import { WATCHLIST_TEMPLATES, createFromTemplate } from "@/server/services/watchlists";

export const GET = api({ auth: "user" }, async () =>
  WATCHLIST_TEMPLATES.map((t) => ({ id: t.id, name: t.name, assets: t.input.assets.map((a) => a.symbol), keywords: t.input.keywords, categories: t.input.categories })),
);

const Body = z.object({ templateId: z.string().max(40) });

export const POST = api({ auth: "user" }, async ({ req, db, user }) => {
  const { templateId } = await parseBody(req, Body);
  return createFromTemplate(db, user!, templateId);
});

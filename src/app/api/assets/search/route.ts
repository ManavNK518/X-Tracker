import { z } from "zod";
import { activeAssets } from "@/config/assets";
import { api, parseQuery } from "@/server/api/handler";

const Query = z.object({ q: z.string().trim().max(60).default("") });

/** Searches the alias dictionary (used by the watchlist editor). */
export const GET = api({ auth: "user" }, async ({ req, env }) => {
  const q = parseQuery(req, Query).q.toLowerCase();
  const list = activeAssets(env.DEMO_MODE);
  const matches = q
    ? list.filter((a) => a.symbol.toLowerCase().startsWith(q) || a.name.toLowerCase().includes(q) || a.aliases.some((al) => al.includes(q)))
    : list;
  return matches.slice(0, 25).map((a) => ({
    symbol: a.symbol,
    name: a.name,
    assetClass: a.assetClass,
    ambiguousTicker: a.tickerMatch === "cashtag_only",
    demo: Boolean(a.demo),
  }));
});

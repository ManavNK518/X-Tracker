import { api, parseBody } from "@/server/api/handler";
import { WatchlistBody } from "@/server/api/schemas";
import { createWatchlist, listWatchlists } from "@/server/services/watchlists";

export const GET = api({ auth: "user" }, async ({ db, user }) => listWatchlists(db, user!.id));

export const POST = api({ auth: "user" }, async ({ req, db, user }) => createWatchlist(db, user!, await parseBody(req, WatchlistBody)));

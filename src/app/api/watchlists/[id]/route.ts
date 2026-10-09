import { api, parseBody } from "@/server/api/handler";
import { WatchlistBody } from "@/server/api/schemas";
import { deleteWatchlist, updateWatchlist } from "@/server/services/watchlists";

export const PUT = api<{ id: string }>({ auth: "user" }, async ({ req, db, user, params }) =>
  updateWatchlist(db, user!, params.id, await parseBody(req, WatchlistBody)),
);

export const DELETE = api<{ id: string }>({ auth: "user" }, async ({ db, user, params }) => {
  await deleteWatchlist(db, user!, params.id);
  return { deleted: true };
});

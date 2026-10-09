import { api, parseBody } from "@/server/api/handler";
import { NotificationsReadBody } from "@/server/api/schemas";
import { markRead } from "@/server/services/notifications";

export const POST = api({ auth: "user" }, async ({ req, db, user }) => ({ updated: await markRead(db, user!.id, await parseBody(req, NotificationsReadBody)) }));

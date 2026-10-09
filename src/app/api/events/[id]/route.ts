import { api } from "@/server/api/handler";
import { getEventDetail } from "@/server/services/events";

export const GET = api<{ id: string }>({ auth: "user" }, async ({ db, user, params }) => getEventDetail(db, user!.id, params.id));

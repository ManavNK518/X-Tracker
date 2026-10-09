import { api } from "@/server/api/handler";
import { draftFromEvent } from "@/server/services/notes";

/** A research-note draft pre-filled from stored event data (original source links only). */
export const GET = api<{ id: string }>({ auth: "user" }, async ({ db, user, params }) => draftFromEvent(db, user!.id, params.id));

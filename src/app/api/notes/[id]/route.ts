import { api, parseBody } from "@/server/api/handler";
import { NoteBody } from "@/server/api/schemas";
import { deleteNote, getNote, updateNote } from "@/server/services/notes";

export const GET = api<{ id: string }>({ auth: "user" }, async ({ db, user, params }) => getNote(db, user!.id, params.id));

export const PUT = api<{ id: string }>({ auth: "user" }, async ({ req, db, user, params }) =>
  updateNote(db, user!, params.id, await parseBody(req, NoteBody)),
);

export const DELETE = api<{ id: string }>({ auth: "user" }, async ({ db, user, params }) => {
  await deleteNote(db, user!, params.id);
  return { deleted: true };
});

import { z } from "zod";
import { NOTE_STATUSES } from "@/domain/misc";
import { api, parseBody, parseQuery } from "@/server/api/handler";
import { NoteBody } from "@/server/api/schemas";
import { createNote, listNotes } from "@/server/services/notes";

const Query = z.object({ status: z.enum(NOTE_STATUSES).optional(), q: z.string().trim().max(200).optional() });

export const GET = api({ auth: "user" }, async ({ req, db, user }) => listNotes(db, user!.id, parseQuery(req, Query)));

export const POST = api({ auth: "user" }, async ({ req, db, user }) => createNote(db, user!, await parseBody(req, NoteBody)));

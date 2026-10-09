import { api, parseBody } from "@/server/api/handler";
import { SourcePatchBody } from "@/server/api/schemas";
import { deleteSource, updateSource } from "@/server/services/sources";

export const PATCH = api<{ id: string }>({ auth: "owner" }, async ({ req, db, user, params }) =>
  updateSource(db, user!, params.id, await parseBody(req, SourcePatchBody)),
);

export const DELETE = api<{ id: string }>({ auth: "owner" }, async ({ db, user, params }) => {
  await deleteSource(db, user!, params.id);
  return { deleted: true };
});

import { api, parseBody } from "@/server/api/handler";
import { CollectionRuleBody } from "@/server/api/schemas";
import { deleteCollectionRule, updateCollectionRule } from "@/server/services/sources";

export const PUT = api<{ id: string }>({ auth: "owner" }, async ({ req, db, user, params }) =>
  updateCollectionRule(db, user!, params.id, await parseBody(req, CollectionRuleBody)),
);

export const DELETE = api<{ id: string }>({ auth: "owner" }, async ({ db, user, params }) => {
  await deleteCollectionRule(db, user!, params.id);
  return { deleted: true };
});

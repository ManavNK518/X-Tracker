import { api, parseBody } from "@/server/api/handler";
import { AlertRuleBody } from "@/server/api/schemas";
import { deleteAlertRule, updateAlertRule } from "@/server/services/watchlists";

export const PUT = api<{ id: string }>({ auth: "user" }, async ({ req, db, user, params }) =>
  updateAlertRule(db, user!, params.id, await parseBody(req, AlertRuleBody)),
);

export const DELETE = api<{ id: string }>({ auth: "user" }, async ({ db, user, params }) => {
  await deleteAlertRule(db, user!, params.id);
  return { deleted: true };
});

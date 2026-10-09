import { api, parseBody } from "@/server/api/handler";
import { AlertRuleBody } from "@/server/api/schemas";
import { createAlertRule, listAlertRules } from "@/server/services/watchlists";

export const GET = api({ auth: "user" }, async ({ db, user }) => listAlertRules(db, user!.id));

export const POST = api({ auth: "user" }, async ({ req, db, user }) => createAlertRule(db, user!, await parseBody(req, AlertRuleBody)));

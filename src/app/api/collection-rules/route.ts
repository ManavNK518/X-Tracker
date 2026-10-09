import { api, parseBody } from "@/server/api/handler";
import { CollectionRuleBody } from "@/server/api/schemas";
import { createCollectionRule, listCollectionRules } from "@/server/services/sources";

export const GET = api({ auth: "user" }, async ({ db }) => listCollectionRules(db));

export const POST = api({ auth: "owner" }, async ({ req, db, user }) => createCollectionRule(db, user!, await parseBody(req, CollectionRuleBody)));

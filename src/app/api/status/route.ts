import { api } from "@/server/api/handler";
import { getStatus } from "@/server/services/status";

export const GET = api({ auth: "user" }, async ({ db, env, user }) => getStatus(db, env, user!));

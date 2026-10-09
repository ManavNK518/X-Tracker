import { api } from "@/server/api/handler";
import { getConnectionState } from "@/server/services/status";

export const GET = api({ auth: "user" }, async ({ db, env }) => getConnectionState(db, env));

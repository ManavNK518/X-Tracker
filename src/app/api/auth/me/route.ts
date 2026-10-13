import { api } from "@/server/api/handler";
import { localNoLoginApplies } from "@/server/auth/local-mode";
import { getMe } from "@/server/services/users";

export const GET = api({ auth: "user" }, async ({ req, db, user }) => getMe(db, user!, localNoLoginApplies(req.headers)));

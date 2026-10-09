import { api } from "@/server/api/handler";
import { getMe } from "@/server/services/users";

export const GET = api({ auth: "user" }, async ({ db, user }) => getMe(db, user!));

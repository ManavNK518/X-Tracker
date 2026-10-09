import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { sha256Hex } from "@/server/lib/text";

/**
 * Database-backed sessions. The cookie holds a random 256-bit token; only its
 * SHA-256 is stored, so a database leak does not reveal usable session tokens.
 * Sessions slide: when less than half the lifetime remains, expiry is extended.
 */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "member";
  plan: string;
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(db: Db, userId: string, ttlDays: number, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000);
  await db.insert(sessions).values({ id: sha256Hex(token), userId, expiresAt, createdAt: now, lastSeenAt: now });
  return { token, expiresAt };
}

export async function validateSession(
  db: Db,
  token: string,
  ttlDays: number,
  now = new Date(),
): Promise<{ user: AuthUser; expiresAt: Date; renewed: boolean } | null> {
  if (!token || token.length > 128) return null;
  const id = sha256Hex(token);
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)));
  if (!row) return null;
  let expiresAt = row.session.expiresAt;
  let renewed = false;
  const halfLife = (ttlDays * 86_400_000) / 2;
  if (expiresAt.getTime() - now.getTime() < halfLife) {
    expiresAt = new Date(now.getTime() + ttlDays * 86_400_000);
    renewed = true;
    await db.update(sessions).set({ expiresAt, lastSeenAt: now }).where(eq(sessions.id, id));
  } else if (now.getTime() - row.session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
  }
  return {
    user: {
      id: row.user.id,
      email: row.user.email,
      displayName: row.user.displayName,
      role: row.user.role === "owner" ? "owner" : "member",
      plan: row.user.plan,
    },
    expiresAt,
    renewed,
  };
}

export async function invalidateSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sha256Hex(token)));
}

/** Signs a user out everywhere. Callers that keep the current session create a new one afterwards. */
export async function invalidateUserSessions(db: Db, userId: string): Promise<number> {
  const rows = await db.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
  return rows.length;
}

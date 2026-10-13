import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { MeDTO } from "@/domain/dto";
import type { Env } from "@/config/env";
import type { Db } from "@/server/db/client";
import { alertRules, notifications, userPreferences, users } from "@/server/db/schema";
import { entitlementsFor } from "@/server/auth/entitlements";
import { hashPassword, passwordProblems, verifyPassword } from "@/server/auth/password";
import { createSession, invalidateUserSessions, type AuthUser } from "@/server/auth/session";
import { badRequest, conflict, forbidden, unauthorized } from "@/server/lib/errors";
import { isValidTimeZone } from "@/lib/time";
import { audit } from "./audit";

// A real hash of a random password, used to equalise timing for unknown emails.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(`dummy-${Math.random()}`));

export async function signup(db: Db, env: Env, input: { email: string; password: string; displayName: string }) {
  const problem = passwordProblems(input.password);
  if (problem) throw badRequest(problem);
  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  const isFirst = Number(userCount) === 0;
  if (!isFirst && !env.ALLOW_SIGNUP) throw forbidden("Sign-up is closed. Ask the workspace owner, or set ALLOW_SIGNUP=true.");
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (existing) throw conflict("An account with this email already exists");
  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({ email: input.email, passwordHash, displayName: input.displayName, role: isFirst ? "owner" : "member" })
    .returning();
  await initUserDefaults(db, user.id);
  await audit(db, { userId: user.id, action: "user.signup", entityType: "user", entityId: user.id, details: { role: user.role } });
  const session = await createSession(db, user.id, env.SESSION_TTL_DAYS);
  return { user, session };
}

export async function login(db: Db, env: Env, input: { email: string; password: string }) {
  const [user] = await db.select().from(users).where(eq(users.email, input.email));
  if (!user) {
    await verifyPassword(input.password, await getDummyHash());
    throw unauthorized("Invalid email or password");
  }
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw unauthorized("Invalid email or password");
  const session = await createSession(db, user.id, env.SESSION_TTL_DAYS);
  await audit(db, { userId: user.id, action: "user.login", entityType: "user", entityId: user.id });
  return { user, session };
}

export async function hasAnyUser(db: Db): Promise<boolean> {
  const [{ value }] = await db.select({ value: count() }).from(users);
  return Number(value) > 0;
}

async function initUserDefaults(db: Db, userId: string) {
  await db.insert(userPreferences).values({ userId }).onConflictDoNothing();
  // Default alert rule so new users get in-app alerts for high-priority events.
  await db.insert(alertRules).values({
    userId,
    name: "High-priority events",
    minImportance: 60,
    minConfidence: 0,
    channels: ["in_app"],
  });
}

/** Stored for an owner created by local no-login mode: not a valid hash, so it can never be used to sign in. */
const NO_PASSWORD = "!no-password:local-no-login";

/**
 * The account local no-login mode acts as: the workspace owner (the earliest
 * owner account, else the earliest account). On a fresh install it creates an
 * owner with no usable password.
 */
export async function localOwner(db: Db): Promise<AuthUser> {
  const pick = () => db.select().from(users).orderBy(sql`${users.role} = 'owner' desc`, users.createdAt).limit(1);
  let [user] = await pick();
  if (!user) {
    const [created] = await db
      .insert(users)
      .values({ email: "owner@signal-terminal.local", passwordHash: NO_PASSWORD, displayName: "Owner", role: "owner" })
      .onConflictDoNothing()
      .returning();
    if (created) {
      await initUserDefaults(db, created.id);
      await audit(db, { userId: created.id, action: "user.local_owner_created", entityType: "user", entityId: created.id });
    }
    [user] = await pick();
  }
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role === "owner" ? "owner" : "member", plan: user.plan };
}

export async function getMe(db: Db, auth: AuthUser, localMode = false): Promise<MeDTO> {
  await db.insert(userPreferences).values({ userId: auth.id }).onConflictDoNothing();
  const [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userId, auth.id));
  const [{ value: unread }] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, auth.id), isNull(notifications.readAt)));
  return {
    user: { id: auth.id, email: auth.email, displayName: auth.displayName, role: auth.role, plan: auth.plan },
    localMode,
    preferences: {
      timezone: prefs.timezone,
      theme: prefs.theme,
      feedSort: prefs.feedSort,
      feedMinImportance: prefs.feedMinImportance,
      showDemo: prefs.showDemo,
      hideReviewed: prefs.hideReviewed,
      quietHours: prefs.quietHours,
      channels: prefs.channels,
    },
    entitlements: { ...entitlementsFor(auth.plan) },
    unreadNotifications: Number(unread),
  };
}

export async function updatePreferences(
  db: Db,
  auth: AuthUser,
  patch: {
    timezone?: string;
    theme?: string;
    feedSort?: string;
    feedMinImportance?: number;
    showDemo?: boolean;
    hideReviewed?: boolean;
    quietHours?: { enabled: boolean; start: string; end: string; allowCritical: boolean };
    channels?: Partial<Record<string, boolean>>;
    displayName?: string;
  },
) {
  if (patch.timezone !== undefined && !isValidTimeZone(patch.timezone)) throw badRequest("Unknown time zone");
  const { displayName, channels, ...rest } = patch;
  await db.insert(userPreferences).values({ userId: auth.id }).onConflictDoNothing();
  const set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (channels) {
    const [current] = await db.select({ channels: userPreferences.channels }).from(userPreferences).where(eq(userPreferences.userId, auth.id));
    const merged: Record<string, boolean> = { ...(current?.channels ?? {}) };
    for (const [k, v] of Object.entries(channels)) if (typeof v === "boolean") merged[k] = v;
    merged.in_app = true; // in-app notifications are always on
    set.channels = merged;
  }
  await db.update(userPreferences).set(set).where(eq(userPreferences.userId, auth.id));
  if (displayName) await db.update(users).set({ displayName, updatedAt: new Date() }).where(eq(users.id, auth.id));
  await audit(db, { userId: auth.id, action: "preferences.update", entityType: "user", entityId: auth.id, details: { fields: Object.keys(patch) } });
}

export async function changePassword(db: Db, env: Env, auth: AuthUser, input: { currentPassword: string; newPassword: string }) {
  const [user] = await db.select().from(users).where(eq(users.id, auth.id));
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) throw unauthorized("Current password is incorrect");
  const problem = passwordProblems(input.newPassword);
  if (problem) throw badRequest(problem);
  await db.update(users).set({ passwordHash: await hashPassword(input.newPassword), updatedAt: new Date() }).where(eq(users.id, auth.id));
  await invalidateUserSessions(db, auth.id);
  const session = await createSession(db, auth.id, env.SESSION_TTL_DAYS);
  await audit(db, { userId: auth.id, action: "user.password_change", entityType: "user", entityId: auth.id });
  return session;
}

export async function signOutEverywhere(db: Db, env: Env, auth: AuthUser) {
  const removed = await invalidateUserSessions(db, auth.id);
  await audit(db, { userId: auth.id, action: "user.sign_out_all", entityType: "user", entityId: auth.id, details: { sessions: removed } });
  return removed;
}

export async function deleteAccount(db: Db, auth: AuthUser, password: string) {
  const [user] = await db.select().from(users).where(eq(users.id, auth.id));
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw unauthorized("Password is incorrect");
  if (user.role === "owner") {
    const [{ value: others }] = await db.select({ value: count() }).from(users).where(sql`${users.id} <> ${auth.id}`);
    if (Number(others) > 0) throw forbidden("Transfer ownership before deleting the owner account");
  }
  await db.delete(users).where(eq(users.id, auth.id));
  await audit(db, { userId: null, action: "user.delete", entityType: "user", entityId: auth.id });
}

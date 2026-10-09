import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetEnvCache } from "@/config/env";
import { resetRateLimits } from "@/server/lib/rate-limit";
import { setupTestDb } from "../helpers/db";

import * as setupRoute from "@/app/api/auth/setup/route";
import * as signupRoute from "@/app/api/auth/signup/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as meRoute from "@/app/api/auth/me/route";
import * as feedRoute from "@/app/api/feed/route";
import * as watchlistsRoute from "@/app/api/watchlists/route";
import * as notesRoute from "@/app/api/notes/route";
import * as noteRoute from "@/app/api/notes/[id]/route";
import * as sourcesRoute from "@/app/api/sources/route";
import * as healthRoute from "@/app/api/health/route";
import * as settingsInfoRoute from "@/app/api/settings/info/route";
import * as eventRoute from "@/app/api/events/[id]/route";

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(
  handler: Handler,
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string; origin?: string; contentType?: string; params?: Record<string, string> } = {},
) {
  const headers = new Headers({ host: "localhost" });
  if (opts.body !== undefined) headers.set("content-type", opts.contentType ?? "application/json");
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.origin) headers.set("origin", opts.origin);
  const req = new NextRequest(new URL(path, "http://localhost"), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, json: text ? JSON.parse(text) : null, text, cookie: setCookie ? setCookie.split(";")[0] : null };
}

describe("API routes (real handlers, real database)", () => {
  let handle: Awaited<ReturnType<typeof setupTestDb>>;
  let ownerCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    process.env.ALLOW_SIGNUP = "false";
    process.env.DEMO_MODE = "false";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-secret-value-should-never-leak";
    process.env.X_BEARER_TOKEN = "x-secret-bearer-should-never-leak";
    resetEnvCache();
    handle = await setupTestDb({ seed: true });
    (globalThis as { __signalDb?: Promise<unknown> }).__signalDb = Promise.resolve(handle);
  });
  afterAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.X_BEARER_TOKEN;
    resetEnvCache();
    (globalThis as { __signalDb?: Promise<unknown> }).__signalDb = undefined;
    await handle.close();
  });
  beforeEach(() => resetRateLimits());

  it("reports first-run setup state publicly", async () => {
    const r = await call(setupRoute.GET as Handler, "/api/auth/setup");
    expect(r.json.data).toEqual({ hasUsers: false, signupOpen: true });
  });

  it("first signup creates the owner and sets an httpOnly session cookie", async () => {
    const r = await call(signupRoute.POST as Handler, "/api/auth/signup", { method: "POST", body: { email: "Owner@Test.test", password: "a-strong-password-1", displayName: "Owner" } });
    expect(r.status).toBe(200);
    expect(r.json.data.user.role).toBe("owner");
    expect(r.json.data.user.email).toBe("owner@test.test");
    expect(r.cookie).toMatch(/^st_session=/);
    ownerCookie = r.cookie!;
  });

  it("closes sign-up after the first account unless ALLOW_SIGNUP is set", async () => {
    const r = await call(signupRoute.POST as Handler, "/api/auth/signup", { method: "POST", body: { email: "member@test.test", password: "a-strong-password-2", displayName: "Member" } });
    expect(r.status).toBe(403);
    process.env.ALLOW_SIGNUP = "true";
    resetEnvCache();
    const ok = await call(signupRoute.POST as Handler, "/api/auth/signup", { method: "POST", body: { email: "member@test.test", password: "a-strong-password-2", displayName: "Member" } });
    expect(ok.json.data.user.role).toBe("member");
    memberCookie = ok.cookie!;
  });

  it("rejects weak passwords", async () => {
    const r = await call(signupRoute.POST as Handler, "/api/auth/signup", { method: "POST", body: { email: "weak@test.test", password: "short", displayName: "W" } });
    expect(r.status).toBe(400);
  });

  it("requires authentication and returns a consistent error envelope without internals", async () => {
    const r = await call(feedRoute.GET as Handler, "/api/feed");
    expect(r.status).toBe(401);
    expect(r.json.error).toMatchObject({ code: "unauthorized" });
    expect(r.text).not.toMatch(/at \w+ \(|node_modules|stack/i);
  });

  it("returns the feed for an authenticated user with validated query parameters", async () => {
    const ok = await call(feedRoute.GET as Handler, "/api/feed?sort=importance&minImportance=10&limit=5", { cookie: ownerCookie });
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.json.data.items)).toBe(true);
    const bad = await call(feedRoute.GET as Handler, "/api/feed?limit=1000", { cookie: ownerCookie });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("validation_error");
    const badCursor = await call(feedRoute.GET as Handler, "/api/feed?cursor=garbage", { cookie: ownerCookie });
    expect(badCursor.status).toBe(400);
  });

  it("rejects cross-site state-changing requests (CSRF) and non-JSON bodies", async () => {
    const csrf = await call(watchlistsRoute.POST as Handler, "/api/watchlists", { method: "POST", cookie: ownerCookie, origin: "https://evil.example", body: { name: "x" } });
    expect(csrf.status).toBe(403);
    const form = await call(watchlistsRoute.POST as Handler, "/api/watchlists", { method: "POST", cookie: ownerCookie, origin: "http://localhost", body: "name=x", contentType: "application/x-www-form-urlencoded" });
    expect(form.status).toBe(400);
  });

  it("validates watchlist input and persists valid watchlists", async () => {
    const bad = await call(watchlistsRoute.POST as Handler, "/api/watchlists", { method: "POST", cookie: ownerCookie, body: { name: "Bad", assets: [{ symbol: "<script>" }] } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.details[0].path).toMatch(/assets/);
    const ok = await call(watchlistsRoute.POST as Handler, "/api/watchlists", { method: "POST", cookie: ownerCookie, body: { name: "Semis", assets: [{ symbol: "nvda" }, { symbol: "ZZCUSTOM" }], keywords: ["export controls"] } });
    expect(ok.status).toBe(200);
    expect(ok.json.data.assets).toEqual(
      expect.arrayContaining([expect.objectContaining({ symbol: "NVDA", custom: false }), expect.objectContaining({ symbol: "ZZCUSTOM", custom: true })]),
    );
    const list = await call(watchlistsRoute.GET as Handler, "/api/watchlists", { cookie: ownerCookie });
    expect(list.json.data).toHaveLength(1);
  });

  it("isolates private data between users", async () => {
    const note = await call(notesRoute.POST as Handler, "/api/notes", { method: "POST", cookie: ownerCookie, body: { title: "Owner thesis", thesis: "private" } });
    expect(note.status).toBe(200);
    const id = note.json.data.id;
    const asMember = await call(noteRoute.GET as Handler, `/api/notes/${id}`, { cookie: memberCookie, params: { id } });
    expect(asMember.status).toBe(404);
    const memberNotes = await call(notesRoute.GET as Handler, "/api/notes", { cookie: memberCookie });
    expect(memberNotes.json.data).toEqual([]);
    const memberWatchlists = await call(watchlistsRoute.GET as Handler, "/api/watchlists", { cookie: memberCookie });
    expect(memberWatchlists.json.data).toEqual([]);
    const del = await call(noteRoute.DELETE as Handler, `/api/notes/${id}`, { method: "DELETE", cookie: memberCookie, params: { id } });
    expect(del.status).toBe(404);
  });

  it("restricts source management to the owner", async () => {
    const body = { provider: "rss", externalId: "https://feeds.example.org/press.xml", name: "Example", category: "news_org" };
    const asMember = await call(sourcesRoute.POST as Handler, "/api/sources", { method: "POST", cookie: memberCookie, body });
    expect(asMember.status).toBe(403);
    const asOwner = await call(sourcesRoute.POST as Handler, "/api/sources", { method: "POST", cookie: ownerCookie, body });
    expect(asOwner.status).toBe(200);
    const dup = await call(sourcesRoute.POST as Handler, "/api/sources", { method: "POST", cookie: ownerCookie, body });
    expect(dup.status).toBe(409);
    const js = await call(sourcesRoute.POST as Handler, "/api/sources", { method: "POST", cookie: ownerCookie, body: { ...body, externalId: "javascript:alert(1)" } });
    expect(js.status).toBe(400);
  });

  it("rate-limits login attempts and does not reveal whether an email exists", async () => {
    const wrong = await call(loginRoute.POST as Handler, "/api/auth/login", { method: "POST", body: { email: "owner@test.test", password: "nope" } });
    const unknown = await call(loginRoute.POST as Handler, "/api/auth/login", { method: "POST", body: { email: "nobody@test.test", password: "nope" } });
    expect(wrong.status).toBe(401);
    expect(unknown.json.error.message).toBe(wrong.json.error.message);
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await call(loginRoute.POST as Handler, "/api/auth/login", { method: "POST", body: { email: "x@test.test", password: "nope" } })).status;
    expect(last).toBe(429);
  });

  it("never exposes secrets to the client", async () => {
    const info = await call(settingsInfoRoute.GET as Handler, "/api/settings/info", { cookie: ownerCookie });
    const me = await call(meRoute.GET as Handler, "/api/auth/me", { cookie: ownerCookie });
    for (const r of [info, me]) {
      expect(r.text).not.toContain("sk-ant-test-secret");
      expect(r.text).not.toContain("x-secret-bearer");
    }
    expect(info.json.data.integrations.find((i: { id: string }) => i.id === "x").configured).toBe(true);
  });

  it("returns 404 for unknown events and a public health check", async () => {
    const r = await call(eventRoute.GET as Handler, "/api/events/EV-NOPE", { cookie: ownerCookie, params: { id: "EV-NOPE" } });
    expect(r.status).toBe(404);
    const h = await call(healthRoute.GET as Handler, "/api/health");
    expect(h.json).toEqual({ ok: true, db: true });
  });
});

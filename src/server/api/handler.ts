import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { getEnv, type Env } from "@/config/env";
import { PRODUCT } from "@/config/product";
import { getDb, type Db } from "@/server/db/client";
import { localNoLoginApplies } from "@/server/auth/local-mode";
import { validateSession, type AuthUser } from "@/server/auth/session";
import { localOwner } from "@/server/services/users";
import { ApiError, badRequest, forbidden, tooManyRequests, unauthorized } from "@/server/lib/errors";
import { errorMessage, logger } from "@/server/lib/logger";
import { checkRateLimit } from "@/server/lib/rate-limit";

/**
 * Route-handler wrapper providing, in one place:
 *  - authentication (session cookie) and role-based authorization
 *  - CSRF protection for state-changing requests (same-origin check + JSON-only bodies)
 *  - optional rate limiting
 *  - consistent `{ data }` / `{ error: { code, message } }` responses
 *  - no stack traces or internals in responses; errors are logged with a request ID
 */
export type AuthMode = "public" | "user" | "owner";

export interface RouteContext<P> {
  req: NextRequest;
  db: Db;
  env: Env;
  user: AuthUser | null;
  params: P;
  requestId: string;
  sessionToken: string | null;
  /** Cookie mutations applied to the final response. */
  cookies: { set: (token: string, expiresAt: Date) => void; clear: () => void };
}

interface Options {
  auth: AuthMode;
  rateLimit?: { name: string; limit: number; windowMs: number };
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local").slice(0, 64);
}

function sameOrigin(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser client; cannot carry a victim's cookie cross-site
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function sessionCookieOptions(env: Env, expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production" && env.APP_URL.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  };
}

export function api<P = Record<string, string>>(options: Options, handler: (ctx: RouteContext<P>) => Promise<unknown>) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    const requestId = randomUUID();
    const cookieOps: ((res: NextResponse) => void)[] = [];
    try {
      const env = getEnv();
      if (MUTATING.has(req.method)) {
        if (!sameOrigin(req)) throw forbidden("Cross-site request rejected");
        const type = req.headers.get("content-type") ?? "";
        const hasBody = req.headers.get("content-length") !== "0" && req.method !== "DELETE";
        if (hasBody && type && !type.includes("application/json")) throw badRequest("Content-Type must be application/json");
      }
      if (options.rateLimit) {
        const rl = checkRateLimit(`${options.rateLimit.name}:${clientIp(req)}`, options.rateLimit.limit, options.rateLimit.windowMs);
        if (!rl.allowed) throw tooManyRequests();
      }
      const db = await getDb();
      const token = req.cookies.get(PRODUCT.sessionCookieName)?.value ?? null;
      let user: AuthUser | null = null;
      if (token) {
        const session = await validateSession(db, token, env.SESSION_TTL_DAYS);
        if (session) {
          user = session.user;
          if (session.renewed) {
            cookieOps.push((res) => res.cookies.set(PRODUCT.sessionCookieName, token, sessionCookieOptions(env, session.expiresAt)));
          }
        } else {
          cookieOps.push((res) => res.cookies.delete(PRODUCT.sessionCookieName));
        }
      }
      if (!user && options.auth !== "public" && localNoLoginApplies(req.headers)) user = await localOwner(db);
      if (options.auth !== "public" && !user) throw unauthorized();
      if (options.auth === "owner" && user?.role !== "owner") throw forbidden("Only the workspace owner can do this");

      const params = (await context.params) ?? ({} as P);
      const result = await handler({
        req,
        db,
        env,
        user,
        params,
        requestId,
        sessionToken: token,
        cookies: {
          set: (t, expiresAt) => cookieOps.push((res) => res.cookies.set(PRODUCT.sessionCookieName, t, sessionCookieOptions(env, expiresAt))),
          clear: () => cookieOps.push((res) => res.cookies.delete(PRODUCT.sessionCookieName)),
        },
      });
      const res = result instanceof Response ? (result as NextResponse) : NextResponse.json({ data: result ?? null });
      if (res instanceof NextResponse) cookieOps.forEach((op) => op(res));
      res.headers.set("Cache-Control", "no-store");
      res.headers.set("X-Request-Id", requestId);
      return res;
    } catch (error) {
      const res = errorResponse(error, requestId, req);
      cookieOps.forEach((op) => op(res));
      return res;
    }
  };
}

function errorResponse(error: unknown, requestId: string, req: NextRequest): NextResponse {
  let status = 500;
  let body: { code: string; message: string; details?: unknown };
  if (error instanceof ApiError) {
    status = error.status;
    body = { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  } else if (error instanceof ZodError) {
    status = 400;
    body = {
      code: "validation_error",
      message: "Invalid request",
      details: error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  } else {
    logger.error("api.unhandled_error", { requestId, method: req.method, path: req.nextUrl.pathname, error: errorMessage(error) });
    body = { code: "internal_error", message: "Something went wrong. The error has been logged." };
  }
  const res = NextResponse.json({ error: { ...body, requestId } }, { status });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Request-Id", requestId);
  return res;
}

export async function parseBody<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > 256 * 1024) throw badRequest("Request body too large");
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  return schema.parse(raw);
}

export function parseQuery<S extends z.ZodType>(req: NextRequest, schema: S): z.infer<S> {
  const obj: Record<string, string | string[]> = {};
  for (const key of new Set(req.nextUrl.searchParams.keys())) {
    const all = req.nextUrl.searchParams.getAll(key);
    obj[key] = all.length > 1 ? all : all[0];
  }
  return schema.parse(obj);
}

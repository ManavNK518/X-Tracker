import { NextResponse, type NextRequest } from "next/server";
import { PRODUCT } from "@/config/product";

/**
 * Optimistic auth redirect for application pages: if there is no session
 * cookie, send the user to /login. This is only a UX shortcut — every API
 * route validates the session against the database and enforces authorization
 * on the server.
 */
export function proxy(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(PRODUCT.sessionCookieName)?.value);
  if (!hasSession) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.pathname + request.nextUrl.search;
    url.pathname = "/login";
    url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login|robots.txt).*)"],
};

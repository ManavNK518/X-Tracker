/**
 * Local no-login mode (LOCAL_NO_LOGIN=true): a personal workspace on this
 * computer opens without signing in, acting as the workspace owner.
 *
 * It applies only when all of these hold, so other machines and web pages
 * cannot use it:
 *  - the app runs in development (`npm run dev`, which listens on 127.0.0.1 only);
 *  - the request is addressed to localhost (blocks DNS-rebinding pages, whose
 *    requests carry their own host name);
 *  - the forwarded client address, when present, is a loopback address.
 *
 * Kept free of database and Next.js imports so the proxy can use it too.
 */

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function localNoLoginEnabled(raw: { LOCAL_NO_LOGIN?: string; NODE_ENV?: string } = process.env): boolean {
  return TRUE_VALUES.has((raw.LOCAL_NO_LOGIN ?? "").trim().toLowerCase()) && raw.NODE_ENV !== "production";
}

/** Host header without its port, e.g. "localhost:3000" → "localhost", "[::1]:3000" → "[::1]". */
function hostname(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

function isLoopbackAddress(address: string): boolean {
  const a = address.trim().toLowerCase();
  return a === "::1" || a.startsWith("127.") || a.startsWith("::ffff:127.");
}

/** Whether this request may skip sign-in. `headers` is the incoming request's headers. */
export function localNoLoginApplies(headers: Headers, raw?: { LOCAL_NO_LOGIN?: string; NODE_ENV?: string }): boolean {
  if (!localNoLoginEnabled(raw)) return false;
  if (!LOOPBACK_HOSTS.has(hostname(headers.get("host") ?? ""))) return false;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded && !forwarded.split(",").every((a) => isLoopbackAddress(a))) return false;
  return true;
}

/**
 * In-memory sliding-window rate limiter for sensitive endpoints (login,
 * signup, password change). Suitable for a single application instance; a
 * multi-instance deployment should move this to a shared store (e.g. Redis or
 * a Postgres table) — documented in docs/SECURITY.md.
 */
type GlobalWithLimiter = typeof globalThis & { __signalRate?: Map<string, number[]> };
const g = globalThis as GlobalWithLimiter;

function store(): Map<string, number[]> {
  if (!g.__signalRate) g.__signalRate = new Map();
  return g.__signalRate;
}

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
  const s = store();
  const hits = (s.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    s.set(key, hits);
    return { allowed: false, retryAfterMs: windowMs - (now - hits[0]) };
  }
  hits.push(now);
  s.set(key, hits);
  if (s.size > 10_000) {
    for (const [k, v] of s) if (v.every((t) => now - t >= windowMs)) s.delete(k);
  }
  return { allowed: true, retryAfterMs: 0 };
}

export function resetRateLimits(): void {
  store().clear();
}

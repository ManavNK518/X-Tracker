/**
 * Structured JSON logger with secret redaction. Never log raw credentials,
 * cookies or full third-party content; log identifiers and counts instead.
 */
type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY = /(token|secret|password|passwd|authorization|api[_-]?key|cookie|bearer|smtp_pass|webhook)/i;
const SECRET_VALUE = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /https:\/\/(discord(app)?\.com)\/api\/webhooks\/[^\s"']+/g,
  /bot\d{6,}:[A-Za-z0-9_-]{20,}/g,
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") {
    let out = value;
    for (const re of SECRET_VALUE) out = out.replace(re, "[REDACTED]");
    return out.length > 2000 ? `${out.slice(0, 2000)}…[truncated]` : out;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function threshold(): number {
  const level = (process.env.LOG_LEVEL ?? "info") as Level;
  return LEVELS[level] ?? LEVELS.info;
}

function write(level: Level, event: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < threshold()) return;
  if (process.env.NODE_ENV === "test" && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => write("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return String(redact(error.message));
  return String(redact(String(error)));
}

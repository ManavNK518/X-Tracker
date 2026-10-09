import { z } from "zod";

/**
 * Server-side environment configuration. Never import this module from client
 * components: it reads secrets. Values are parsed lazily so that `next build`
 * does not require runtime secrets.
 */

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v.trim() === "") return fallback;
      return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
    });

const int = (fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === "") return fallback;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `expected a number between ${min} and ${max}` });
        return z.NEVER;
      }
      return Math.floor(n);
    });

const num = (fallback: number, min = 0, max = Number.POSITIVE_INFINITY) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === "") return fallback;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: Number.isFinite(max) ? `expected a number between ${min} and ${max}` : `expected a number >= ${min}` });
        return z.NEVER;
      }
      return n;
    });

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Database
  DATABASE_URL: optionalString,
  PGLITE_DATA_DIR: z.string().default(".data/pglite"),
  DB_AUTO_MIGRATE: bool(true),

  // Worker
  WORKER_MODE: z.enum(["inline", "separate", "off"]).default("inline"),

  // Auth
  ALLOW_SIGNUP: bool(false),
  SESSION_TTL_DAYS: int(30, 1, 365),

  // Demo
  DEMO_MODE: bool(false),
  DEMO_INTERVAL_SECONDS: int(20, 0, 3600),

  // Official RSS / Atom sources
  RSS_ENABLED: bool(true),
  RSS_POLL_SECONDS: int(300, 60, 86_400),
  RSS_USER_AGENT: z.string().default("SignalTerminal/0.1 (self-hosted market research tool)"),
  RSS_CONTENT_RETENTION_DAYS: int(365, 1, 3650),
  SEC_USER_AGENT: optionalString,

  // X API v2
  X_BEARER_TOKEN: optionalString,
  X_API_BASE_URL: z.string().default("https://api.x.com/2"),
  /** "search": periodic recent-search polling (default). "stream": filtered stream (1 connection on pay-per-use). */
  X_COLLECTION_MODE: z.enum(["search", "stream"]).default("search"),
  X_USER_READ_COST_USD: num(0.01),
  X_POLL_SECONDS: int(300, 30, 86_400),
  X_MAX_RESULTS_PER_QUERY: int(25, 10, 100),
  X_MAX_POST_READS_PER_DAY: int(500, 0, 3_000_000),
  /** Estimated daily spend cap across all X reads (posts and author profiles, collection and deletion checks). */
  X_MAX_DAILY_COST_USD: num(2.5),
  /** Largest share of X_MAX_DAILY_COST_USD that keyword rules may use; the rest stays available to registered accounts. */
  X_KEYWORD_RULE_BUDGET_SHARE: num(0.5, 0, 1),
  X_POST_READ_COST_USD: num(0.005),
  /** First deletion re-check after N hours (0 = off); later re-checks back off as the post ages. */
  X_COMPLIANCE_REFRESH_HOURS: int(24, 0, 24 * 30),
  /** Post reads reserved per day for deletion re-checks (taken out of X_MAX_POST_READS_PER_DAY). */
  X_COMPLIANCE_MAX_READS_PER_DAY: int(50, 0, 3_000_000),
  X_CONTENT_RETENTION_DAYS: int(30, 1, 3650),

  // AI analysis (optional)
  ANTHROPIC_API_KEY: optionalString,
  AI_ENABLED: bool(true),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  AI_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  AI_TIMEOUT_MS: int(30_000, 1_000, 300_000),
  AI_MAX_RETRIES: int(2, 0, 5),
  AI_SERVER_FALLBACK: bool(true),

  // Cost and volume controls
  MAX_AI_ANALYSES_PER_DAY: int(100, 0, 1_000_000),
  MAX_AI_DAILY_COST_USD: num(1),
  MIN_SCORE_FOR_AI: int(45, 0, 100),
  MAX_POSTS_PER_INTERVAL: int(50, 1, 5_000),
  MAX_SOURCE_QUERIES_PER_HOUR: int(30, 0, 10_000),
  MAX_QUEUE_DEPTH: int(2_000, 10, 1_000_000),
  MAX_NOTIFICATIONS_PER_HOUR: int(20, 1, 10_000),
  ALERT_COOLDOWN_MINUTES: int(30, 0, 24 * 60),
  STALE_AFTER_HOURS: int(24, 1, 24 * 30),

  // Notification channels (server-side secrets only)
  SMTP_HOST: optionalString,
  SMTP_PORT: int(587, 1, 65_535),
  SMTP_SECURE: bool(false),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  ALERT_EMAIL_FROM: optionalString,
  ALERT_EMAIL_TO: optionalString,
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_CHAT_ID: optionalString,
  DISCORD_WEBHOOK_URL: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests: re-read process.env on next getEnv() call. */
export function resetEnvCache(): void {
  cached = null;
}

/** Feature flags derived from env. Contains booleans only — never secrets. */
export function integrationStatus(env: Env = getEnv()) {
  return {
    database: env.DATABASE_URL ? "postgres" : "pglite",
    x: Boolean(env.X_BEARER_TOKEN),
    rss: env.RSS_ENABLED,
    secEdgar: Boolean(env.SEC_USER_AGENT),
    ai: Boolean(env.ANTHROPIC_API_KEY) && env.AI_ENABLED,
    aiModel: env.AI_MODEL,
    email: Boolean(env.SMTP_HOST && env.ALERT_EMAIL_FROM && env.ALERT_EMAIL_TO),
    telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    discord: Boolean(env.DISCORD_WEBHOOK_URL),
    demo: env.DEMO_MODE,
    workerMode: env.WORKER_MODE,
  } as const;
}

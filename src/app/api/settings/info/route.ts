import { integrationStatus } from "@/config/env";
import { CONFIDENCE_WEIGHTS, IMPORTANCE_WEIGHTS, PRIORITY_BANDS, SCORING_VERSION, UNKNOWN_POLICY } from "@/config/scoring";
import { api } from "@/server/api/handler";

/**
 * Non-secret configuration for the Settings screen: which integrations are
 * configured (booleans only), budgets, retention and scoring parameters.
 * Secret values are never returned.
 */
export const GET = api({ auth: "user" }, async ({ env }) => {
  const integ = integrationStatus(env);
  return {
    integrations: [
      {
        id: "rss",
        name: "Official RSS/Atom feeds",
        configured: integ.rss,
        cost: "Free (public government and central-bank feeds).",
        requires: ["RSS_ENABLED=true (default)", "SEC_USER_AGENT for sec.gov feeds (descriptive User-Agent with contact email)"],
        secEdgarConfigured: integ.secEdgar,
      },
      {
        id: "x",
        name: "X API v2",
        configured: integ.x,
        cost: "Paid: pay-per-use credits (about $0.005 per post read and $0.010 per user read at the time of writing). Bounded by X_MAX_POST_READS_PER_DAY.",
        requires: ["X_BEARER_TOKEN (app-only Bearer token from the X Developer Console)", "Enable individual X sources on the Sources screen"],
      },
      {
        id: "ai",
        name: "AI analysis (Anthropic Claude)",
        configured: integ.ai,
        model: integ.aiModel,
        cost: "Paid per token. Bounded by MAX_AI_ANALYSES_PER_DAY and MAX_AI_DAILY_COST_USD. Without a key the rules-based pipeline runs alone.",
        requires: ["ANTHROPIC_API_KEY", "AI_MODEL (default claude-opus-5-5; claude-haiku-5-5 is far cheaper)"],
      },
      { id: "email", name: "Email (SMTP)", configured: integ.email, cost: "Depends on your SMTP provider.", requires: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER / SMTP_PASSWORD", "ALERT_EMAIL_FROM", "ALERT_EMAIL_TO"] },
      { id: "telegram", name: "Telegram bot", configured: integ.telegram, cost: "Free.", requires: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] },
      { id: "discord", name: "Discord webhook", configured: integ.discord, cost: "Free.", requires: ["DISCORD_WEBHOOK_URL"] },
      { id: "market", name: "Market data", configured: false, cost: "Requires an authorized vendor; not connected.", requires: ["Implement src/server/providers/market/types.ts for a licensed provider"] },
    ],
    database: integ.database,
    workerMode: integ.workerMode,
    demoMode: integ.demo,
    budgets: {
      maxAiAnalysesPerDay: env.MAX_AI_ANALYSES_PER_DAY,
      maxAiDailyCostUsd: env.MAX_AI_DAILY_COST_USD,
      minScoreForAi: env.MIN_SCORE_FOR_AI,
      maxPostsPerInterval: env.MAX_POSTS_PER_INTERVAL,
      maxSourceQueriesPerHour: env.MAX_SOURCE_QUERIES_PER_HOUR,
      xMaxPostReadsPerDay: env.X_MAX_POST_READS_PER_DAY,
      maxNotificationsPerHour: env.MAX_NOTIFICATIONS_PER_HOUR,
      alertCooldownMinutes: env.ALERT_COOLDOWN_MINUTES,
    },
    retention: {
      xContentDays: env.X_CONTENT_RETENTION_DAYS,
      rssContentDays: env.RSS_CONTENT_RETENTION_DAYS,
      xComplianceRefreshHours: env.X_COMPLIANCE_REFRESH_HOURS,
    },
    scoring: { version: SCORING_VERSION, importanceWeights: IMPORTANCE_WEIGHTS, confidenceWeights: CONFIDENCE_WEIGHTS, bands: PRIORITY_BANDS, unknownPolicy: UNKNOWN_POLICY },
  };
});

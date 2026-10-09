import { getEnv, type Env } from "@/config/env";
import type { Db } from "@/server/db/client";
import { evaluateAlerts } from "@/server/alerts/engine";
import { pipelineConfigFromEnv, type PipelineContext } from "@/server/pipeline/process";
import { AnthropicAnalysisProvider } from "@/server/providers/ai/anthropic";
import { DisabledAnalysisProvider, type AnalysisProvider } from "@/server/providers/ai/types";
import { DiscordNotifier, EmailNotifier, TelegramNotifier } from "@/server/providers/notify/channels";
import type { Notifier } from "@/server/providers/notify/types";

/**
 * Composition root: builds providers from server-side configuration. Nothing
 * here is importable from client components.
 */
type GlobalRuntime = typeof globalThis & { __signalAi?: AnalysisProvider };
const g = globalThis as GlobalRuntime;

export function getAiProvider(env: Env = getEnv()): AnalysisProvider {
  if (!g.__signalAi) {
    g.__signalAi =
      env.ANTHROPIC_API_KEY && env.AI_ENABLED
        ? new AnthropicAnalysisProvider({
            apiKey: env.ANTHROPIC_API_KEY,
            model: env.AI_MODEL,
            effort: env.AI_EFFORT,
            timeoutMs: env.AI_TIMEOUT_MS,
            maxRetries: env.AI_MAX_RETRIES,
            serverFallback: env.AI_SERVER_FALLBACK,
          })
        : new DisabledAnalysisProvider();
  }
  return g.__signalAi;
}

export function getNotifiers(env: Env = getEnv()): Notifier[] {
  return [
    new EmailNotifier({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.ALERT_EMAIL_FROM,
      to: env.ALERT_EMAIL_TO,
    }),
    new TelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID),
    new DiscordNotifier(env.DISCORD_WEBHOOK_URL),
  ];
}

export function buildPipelineContext(db: Db, env: Env = getEnv()): PipelineContext {
  return {
    db,
    now: () => new Date(),
    ai: getAiProvider(env),
    config: pipelineConfigFromEnv(env),
    onMaterialChange: async (ctx, result) => {
      await evaluateAlerts(ctx, result);
    },
  };
}

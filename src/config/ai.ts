/**
 * AI provider pricing table used for *estimated* cost tracking (USD per
 * million tokens). Source: Anthropic model pricing as published at the time of
 * writing (2026-10). Verify current prices before relying on the estimates;
 * update this table when prices change. Unknown models are costed at the
 * most expensive listed rate so budgets fail safe.
 */
export const AI_PRICING_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
};

const FALLBACK_PRICING = { input: 10, output: 50, cacheRead: 1 };

export function estimateCostUsd(model: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens?: number }): number {
  const p = AI_PRICING_PER_MTOK[model] ?? FALLBACK_PRICING;
  const cacheWrite = (usage.cacheWriteTokens ?? 0) * p.input * 1.25;
  return (usage.inputTokens * p.input + usage.outputTokens * p.output + usage.cacheReadTokens * p.cacheRead + cacheWrite) / 1_000_000;
}

/** Conservative pre-call estimate used for budget gating. */
export function estimateMaxCallCostUsd(model: string, maxOutputTokens: number, approxInputTokens = 1_500): number {
  return estimateCostUsd(model, { inputTokens: approxInputTokens, outputTokens: maxOutputTokens, cacheReadTokens: 0 });
}

/** Models that support the server-side refusal fallback parameter. */
export const SERVER_FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"]);

export const AI_PROMPT_VERSION = "extract-2026-10-08.1";
export const AI_MAX_OUTPUT_TOKENS = 4_000;

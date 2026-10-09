import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MAX_OUTPUT_TOKENS, SERVER_FALLBACK_MODELS, estimateCostUsd } from "@/config/ai";
import { AiExtractionSchema } from "./schema";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt";
import { validateExtraction } from "./validate";
import type { AnalysisProvider, AnalysisRequest, AnalysisResult, AnalysisUsage } from "./types";

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  effort: "low" | "medium" | "high";
  timeoutMs: number;
  maxRetries: number;
  serverFallback: boolean;
  /** Injectable client for tests. */
  client?: Anthropic;
}

/**
 * Claude-backed extraction. Uses structured outputs (JSON schema from Zod) so
 * responses are schema-constrained, then applies source-grounded validation.
 * The system prompt is cached; untrusted content only ever appears in the user
 * turn inside delimiters.
 */
export class AnthropicAnalysisProvider implements AnalysisProvider {
  readonly id = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.model = options.model;
    this.client =
      options.client ??
      new Anthropic({ apiKey: options.apiKey, timeout: options.timeoutMs, maxRetries: Math.min(options.maxRetries, 5) });
  }

  configured() {
    return Boolean(this.options.apiKey);
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const started = Date.now();
    const useFallback = this.options.serverFallback && SERVER_FALLBACK_MODELS.has(this.model);
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: AI_MAX_OUTPUT_TOKENS,
        ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        output_config: { effort: this.options.effort, format: betaZodOutputFormat(AiExtractionSchema) },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildUserMessage(request.text, request.meta) }],
      });
      const servedBy = response.model || this.model;
      const usage = toUsage(servedBy, response.usage);
      const latencyMs = Date.now() - started;

      if (response.stop_reason === "refusal") {
        return { ok: false, model: servedBy, kind: "refusal", error: "Model declined to analyse this content", usage, latencyMs };
      }
      if (response.stop_reason === "max_tokens") {
        return { ok: false, model: servedBy, kind: "invalid_output", error: "Output truncated at max_tokens", usage, latencyMs };
      }

      let raw: unknown = response.parsed_output;
      if (raw === null || raw === undefined) {
        // Repair path: try the raw text block, then validate as usual.
        const textBlock = response.content.find((b) => b.type === "text");
        if (textBlock && textBlock.type === "text") {
          try {
            raw = JSON.parse(textBlock.text);
          } catch {
            raw = null;
          }
        }
      }
      if (raw === null || raw === undefined) {
        return { ok: false, model: servedBy, kind: "invalid_output", error: "No parseable structured output", usage, latencyMs };
      }
      const validated = validateExtraction(raw, request.text, request.includeDemo);
      if (!validated.ok) {
        return { ok: false, model: servedBy, kind: "invalid_output", error: validated.error, usage, latencyMs, warnings: validated.warnings };
      }
      return { ok: true, model: servedBy, extraction: validated.value, warnings: validated.warnings, usage, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - started;
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        return { ok: false, model: this.model, kind: "auth", error: "Anthropic API authentication failed", usage: null, latencyMs };
      }
      if (error instanceof Anthropic.RateLimitError) {
        return { ok: false, model: this.model, kind: "rate_limited", error: "Anthropic API rate limit reached", usage: null, latencyMs };
      }
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        return { ok: false, model: this.model, kind: "timeout", error: `Model request timed out after ${this.options.timeoutMs}ms`, usage: null, latencyMs };
      }
      if (error instanceof Anthropic.BadRequestError) {
        return { ok: false, model: this.model, kind: "api_error", error: `Request rejected: ${error.message.slice(0, 200)}`, usage: null, latencyMs };
      }
      if (error instanceof Anthropic.APIError) {
        return { ok: false, model: this.model, kind: "api_error", error: `Anthropic API error${error.status ? ` ${error.status}` : ""}`, usage: null, latencyMs };
      }
      if (error instanceof SyntaxError) {
        return { ok: false, model: this.model, kind: "invalid_output", error: "Malformed JSON in model output", usage: null, latencyMs };
      }
      return { ok: false, model: this.model, kind: "api_error", error: (error as Error).message?.slice(0, 200) ?? "unknown error", usage: null, latencyMs };
    }
  }
}

function toUsage(
  model: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null },
): AnalysisUsage {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd: estimateCostUsd(model, { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }),
  };
}

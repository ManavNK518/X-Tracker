import type { ValidatedExtraction } from "./schema";
import type { PromptMetadata } from "./prompt";

export interface AnalysisRequest {
  text: string;
  meta: PromptMetadata;
  includeDemo: boolean;
}

export interface AnalysisUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export type AnalysisFailureKind = "not_configured" | "timeout" | "rate_limited" | "refusal" | "invalid_output" | "api_error" | "auth";

export type AnalysisResult =
  | { ok: true; model: string; extraction: ValidatedExtraction; warnings: string[]; usage: AnalysisUsage; latencyMs: number }
  | { ok: false; model: string; kind: AnalysisFailureKind; error: string; usage: AnalysisUsage | null; latencyMs: number; warnings?: string[] };

/** AI provider abstraction. Implementations must never throw for expected failures. */
export interface AnalysisProvider {
  readonly id: string;
  readonly model: string;
  configured(): boolean;
  analyze(request: AnalysisRequest): Promise<AnalysisResult>;
}

export class DisabledAnalysisProvider implements AnalysisProvider {
  readonly id = "none";
  readonly model = "none";
  configured() {
    return false;
  }
  async analyze(): Promise<AnalysisResult> {
    return { ok: false, model: "none", kind: "not_configured", error: "AI analysis is not configured", usage: null, latencyMs: 0 };
  }
}

import { z } from "zod";
import { EVENT_CATEGORIES } from "@/domain/categories";

/**
 * Structured extraction schema. The model may only populate these fields; it
 * cannot set URLs, timestamps, prices, verification status or source identity
 * — those come exclusively from provider metadata and deterministic rules.
 */
export const AiExtractionSchema = z.object({
  is_market_relevant: z.boolean(),
  categories: z.array(z.enum(EVENT_CATEGORIES)),
  title: z.string(),
  factual_summary: z.string(),
  event_time_as_stated: z.string().nullable(),
  entities: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["company", "person", "organization", "government", "asset", "place", "other"]),
      ticker: z.string().nullable(),
    }),
  ),
  claims: z.array(
    z.object({
      claim: z.string(),
      evidence_quote: z.string(),
      status: z.enum(["stated_by_source", "attributed_to_others", "speculative"]),
    }),
  ),
  claims_requiring_verification: z.array(z.string()),
  potentially_affected_assets: z.array(z.object({ symbol: z.string(), rationale: z.string() })),
  transmission_mechanism: z.string().nullable(),
  bullish_interpretation: z.string().nullable(),
  bearish_interpretation: z.string().nullable(),
  key_uncertainties: z.array(z.string()),
  suggested_follow_up: z.array(z.string()),
  contains_instructions_to_ai: z.boolean(),
});

export type AiExtraction = z.infer<typeof AiExtractionSchema>;

/** Validated, sanitised extraction stored on events. */
export interface ValidatedExtraction {
  isMarketRelevant: boolean;
  categories: (typeof EVENT_CATEGORIES)[number][];
  title: string;
  factualSummary: string;
  eventTimeAsStated: string | null;
  claims: { claim: string; evidenceQuote: string; status: string }[];
  claimsRequiringVerification: string[];
  assets: { symbol: string; rationale: string }[];
  transmissionMechanism: string | null;
  bullishInterpretation: string | null;
  bearishInterpretation: string | null;
  keyUncertainties: string[];
  suggestedFollowUp: string[];
  containsInstructionsToAi: boolean;
}

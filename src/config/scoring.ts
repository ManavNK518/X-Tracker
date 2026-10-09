import type { EventCategory } from "@/domain/categories";
import { DEFAULT_PRIORITY_BANDS, type PriorityBand } from "@/domain/priority";
import type { SourceCategory } from "@/domain/sources";

/**
 * Transparent, configurable scoring configuration.
 * See docs/SCORING.md for the rationale behind each value.
 * Changing these values changes production scoring: bump SCORING_VERSION so the
 * score audit trail records which configuration produced each score.
 */
export const SCORING_VERSION = "2026-10-08.1";

export const IMPORTANCE_WEIGHTS = {
  market_significance: 0.25,
  source_quality: 0.2,
  novelty: 0.2,
  tracked_relevance: 0.15,
  verification: 0.15,
  time_sensitivity: 0.05,
} as const;

export type ImportanceComponentId = keyof typeof IMPORTANCE_WEIGHTS;

export const IMPORTANCE_COMPONENT_LABELS: Record<ImportanceComponentId, string> = {
  market_significance: "Potential market significance",
  source_quality: "Source quality",
  novelty: "Novelty",
  tracked_relevance: "Relevance to tracked assets",
  verification: "Verification & corroboration",
  time_sensitivity: "Time sensitivity",
};

export const CONFIDENCE_WEIGHTS = {
  source_authenticity: 0.2,
  directness: 0.2,
  independent_corroboration: 0.2,
  consistency: 0.1,
  entity_match: 0.1,
  time_relevance: 0.1,
  contradictions: 0.1,
} as const;

export type ConfidenceComponentId = keyof typeof CONFIDENCE_WEIGHTS;

export const CONFIDENCE_COMPONENT_LABELS: Record<ConfidenceComponentId, string> = {
  source_authenticity: "Source authenticity",
  directness: "Directness of evidence",
  independent_corroboration: "Independent corroboration",
  consistency: "Consistency across sources",
  entity_match: "Entity-matching confidence",
  time_relevance: "Time relevance",
  contradictions: "Absence of contradictions",
};

/**
 * Policy for components that cannot be assessed.
 *  - "conservative": unknown components contribute 0 points. The total is a
 *    lower bound and coverage is shown next to it. (default)
 *  - "neutral": unknown components contribute `neutralValue` points.
 *  - "renormalize": the total is computed over assessed components only.
 */
export type UnknownComponentPolicy = "conservative" | "neutral" | "renormalize";

export const UNKNOWN_POLICY: { policy: UnknownComponentPolicy; neutralValue: number } = {
  policy: "conservative",
  neutralValue: 50,
};

export const PRIORITY_BANDS: PriorityBand[] = DEFAULT_PRIORITY_BANDS;

/** Base potential market significance by category (0–100). */
export const CATEGORY_SIGNIFICANCE: Record<EventCategory, number> = {
  monetary_policy: 85,
  economic_data: 70,
  earnings: 65,
  guidance: 70,
  corporate_transaction: 70,
  regulatory: 60,
  legal: 55,
  product_launch: 40,
  supply_chain: 55,
  industry: 40,
  commodity: 55,
  digital_asset: 50,
  geopolitics: 55,
  leadership: 50,
  analyst_commentary: 30,
  rumor: 45,
  market_commentary: 12,
  other_material: 35,
};

/**
 * Baseline source quality by category before evidence-based reliability
 * adjustment. Popularity, follower counts and verification badges are
 * deliberately not inputs.
 */
export const SOURCE_CATEGORY_QUALITY: Record<SourceCategory, number | null> = {
  central_bank: 95,
  regulator: 92,
  government_agency: 90,
  statistical_agency: 95,
  exchange: 88,
  company: 85,
  executive: 75,
  news_org: 70,
  journalist: 62,
  industry_specialist: 55,
  researcher: 55,
  market_commentator: 30,
  unknown: null,
};

/** Minimum number of resolved observations before reliability adjusts quality. */
export const RELIABILITY_MIN_OBSERVATIONS = 5;
/** Maximum +/- adjustment from reliability evidence. */
export const RELIABILITY_MAX_ADJUSTMENT = 15;

/** Similarity thresholds used by novelty detection / clustering. */
export const NOVELTY_THRESHOLDS = {
  repeat: 0.72,
  related: 0.35,
  weakRelated: 0.2,
  correctionOrContradiction: 0.18,
  activeWindowHours: 48,
  resurfaceWindowDays: 30,
  resurfacedAgeHours: 24,
} as const;

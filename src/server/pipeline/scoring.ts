import {
  CATEGORY_SIGNIFICANCE,
  CONFIDENCE_COMPONENT_LABELS,
  CONFIDENCE_WEIGHTS,
  IMPORTANCE_COMPONENT_LABELS,
  IMPORTANCE_WEIGHTS,
  PRIORITY_BANDS,
  RELIABILITY_MAX_ADJUSTMENT,
  RELIABILITY_MIN_OBSERVATIONS,
  SOURCE_CATEGORY_QUALITY,
  UNKNOWN_POLICY,
  type UnknownComponentPolicy,
} from "@/config/scoring";
import { CLAIM_NATURE_CATEGORIES, type EventCategory } from "@/domain/categories";
import { bandFor } from "@/domain/priority";
import type { SourceCategory } from "@/domain/sources";
import type { VerificationState } from "@/domain/verification";

/**
 * Transparent scoring. Importance (research priority) and confidence
 * (strength of evidence) are computed separately from explicit components.
 * Components that cannot be assessed are `null` and handled by the documented
 * unknown-component policy; they are never silently scored as perfect.
 */
export interface ScoreComponent {
  id: string;
  label: string;
  weight: number;
  /** 0–100, or null when the component cannot be assessed. */
  score: number | null;
  /** Points contributed to the total (weight × score, after policy). */
  contribution: number;
  explanation: string;
  evidence: string[];
}

export interface ScoreResult {
  total: number;
  /** Share of total weight that could be assessed (0–1). */
  coverage: number;
  policy: UnknownComponentPolicy;
  components: ScoreComponent[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function combineComponents(
  components: Omit<ScoreComponent, "contribution">[],
  policy: UnknownComponentPolicy = UNKNOWN_POLICY.policy,
  neutralValue = UNKNOWN_POLICY.neutralValue,
): ScoreResult {
  const assessedWeight = components.filter((c) => c.score !== null).reduce((s, c) => s + c.weight, 0);
  const totalWeight = components.reduce((s, c) => s + c.weight, 0) || 1;
  const withContribution: ScoreComponent[] = components.map((c) => {
    let contribution: number;
    if (c.score !== null) {
      contribution = policy === "renormalize" && assessedWeight > 0 ? (c.weight / assessedWeight) * c.score : c.weight * c.score;
    } else {
      contribution = policy === "neutral" ? c.weight * neutralValue : 0;
    }
    return { ...c, contribution: Number(contribution.toFixed(2)) };
  });
  const raw = withContribution.reduce((s, c) => s + c.contribution, 0) / (policy === "renormalize" ? 1 : totalWeight);
  return {
    total: assessedWeight === 0 && policy === "renormalize" ? 0 : clamp(raw),
    coverage: Number((assessedWeight / totalWeight).toFixed(3)),
    policy,
    components: withContribution,
  };
}

// ---------------------------------------------------------------------------
// Importance
// ---------------------------------------------------------------------------

export interface SourceForScoring {
  category: SourceCategory;
  name: string;
  isPrimary: boolean;
  authoritativeForEvent: boolean;
  reliability: { observations: number; confirmedRate: number } | null;
}

export interface ImportanceInput {
  categories: { category: EventCategory; score: number }[];
  opinionOnly: boolean;
  magnitudeTerms: string[];
  /** Highest-quality evidence source for the event; null if no registered source. */
  bestSource: SourceForScoring | null;
  novelty: "new" | "update" | "correction" | "resurfaced" | "unknown";
  tracked: { universeSize: number; direct: string[]; indirect: string[]; categoryMatch: boolean };
  verification: VerificationState;
  publishedAt: Date | null;
  now: Date;
}

const MAGNITUDE = /\b(unexpected(ly)?|surprise|surprising|record|emergency|unscheduled|halt(s|ed)?|bankrupt(cy)?|default(s|ed)?|plunge[sd]?|soar(s|ed)?|largest|first[- ]ever|biggest|collapse[sd]?|suspend(s|ed)?)\b/gi;

export function detectMagnitudeTerms(text: string): string[] {
  return [...new Set((text.match(MAGNITUDE) ?? []).map((t) => t.toLowerCase()))];
}

export function sourceQualityScore(source: SourceForScoring | null): { score: number | null; evidence: string[] } {
  if (!source) return { score: null, evidence: ["no registered source among the evidence; quality cannot be assessed"] };
  const evidence: string[] = [];
  let base = SOURCE_CATEGORY_QUALITY[source.category];
  if (base === null) {
    return { score: null, evidence: [`${source.name}: unregistered account — no evidence-based quality assessment`] };
  }
  evidence.push(`${source.name}: ${source.category.replace(/_/g, " ")} baseline ${base}`);
  if (source.isPrimary && source.authoritativeForEvent) {
    base = Math.max(base, 95);
    evidence.push("authoritative primary source for this category");
  }
  if (source.reliability && source.reliability.observations >= RELIABILITY_MIN_OBSERVATIONS) {
    const adj = Math.round((source.reliability.confirmedRate - 0.5) * 2 * RELIABILITY_MAX_ADJUSTMENT);
    base += adj;
    evidence.push(
      `reliability adjustment ${adj >= 0 ? "+" : ""}${adj} from ${source.reliability.observations} resolved observations (${Math.round(source.reliability.confirmedRate * 100)}% confirmed)`,
    );
  } else if (source.reliability) {
    evidence.push(`reliability provisional: ${source.reliability.observations} resolved observation(s), below the ${RELIABILITY_MIN_OBSERVATIONS} needed for adjustment`);
  } else {
    evidence.push("reliability provisional: no resolved observations yet");
  }
  return { score: clamp(base), evidence };
}

export function computeImportance(input: ImportanceInput): ScoreResult {
  const W = IMPORTANCE_WEIGHTS;
  const L = IMPORTANCE_COMPONENT_LABELS;

  // Potential market significance
  const subject = input.categories.filter((c) => !CLAIM_NATURE_CATEGORIES.has(c.category));
  const pool = subject.length > 0 ? subject : input.categories;
  let significance: number | null = null;
  const sigEvidence: string[] = [];
  if (pool.length > 0) {
    const top = pool.reduce((a, b) => (CATEGORY_SIGNIFICANCE[b.category] > CATEGORY_SIGNIFICANCE[a.category] ? b : a));
    significance = CATEGORY_SIGNIFICANCE[top.category];
    sigEvidence.push(`category “${top.category.replace(/_/g, " ")}” base ${significance}`);
    if (input.magnitudeTerms.length > 0) {
      significance += 10;
      sigEvidence.push(`magnitude language: ${input.magnitudeTerms.slice(0, 4).join(", ")} (+10)`);
    }
    if (input.opinionOnly) {
      significance = significance * 0.3;
      sigEvidence.push("opinion/commentary without a new factual event (×0.3)");
    }
    if (input.categories.some((c) => c.category === "rumor")) {
      sigEvidence.push("rumor: significance reflects potential impact if true, not likelihood");
    }
  }

  const sq = sourceQualityScore(input.bestSource);

  const noveltyMap = { new: 90, update: 60, correction: 70, resurfaced: 15, unknown: null } as const;
  const novelty = noveltyMap[input.novelty];
  const noveltyText = {
    new: "no matching active event — new information",
    update: "follow-up to an existing event",
    correction: "correction to earlier information",
    resurfaced: "old information resurfacing",
    unknown: "novelty could not be assessed",
  }[input.novelty];

  let relevance: number | null;
  const relEvidence: string[] = [];
  if (input.tracked.universeSize === 0) {
    relevance = null;
    relEvidence.push("no watchlists configured — relevance to tracked assets cannot be assessed");
  } else if (input.tracked.direct.length > 0) {
    relevance = 90;
    relEvidence.push(`tracked assets named directly: ${input.tracked.direct.join(", ")}`);
  } else if (input.tracked.indirect.length > 0) {
    relevance = 55;
    relEvidence.push(`tracked assets via mapping: ${input.tracked.indirect.join(", ")}`);
  } else if (input.tracked.categoryMatch) {
    relevance = 35;
    relEvidence.push("category is tracked by a watchlist");
  } else {
    relevance = 10;
    relEvidence.push("no tracked assets or categories involved");
  }

  const verificationMap: Record<VerificationState, number | null> = {
    confirmed: 100,
    primary_source_located: 80,
    independently_corroborated: 75,
    corrected: 55,
    unverified: 25,
    disputed: 20,
    stale: 15,
    unable_to_verify: null,
  };

  let timeScore: number | null = null;
  let timeText = "publication time unavailable";
  if (input.publishedAt) {
    const minutes = (input.now.getTime() - input.publishedAt.getTime()) / 60_000;
    timeScore = minutes <= 15 ? 100 : minutes <= 60 ? 85 : minutes <= 360 ? 55 : minutes <= 1440 ? 30 : 10;
    timeText = `${Math.max(0, Math.round(minutes))} minutes since publication`;
  }

  return combineComponents([
    {
      id: "market_significance",
      label: L.market_significance,
      weight: W.market_significance,
      score: significance === null ? null : clamp(significance),
      explanation: significance === null ? "no category assigned" : "category-based potential significance with explicit modifiers",
      evidence: sigEvidence,
    },
    { id: "source_quality", label: L.source_quality, weight: W.source_quality, score: sq.score, explanation: "evidence-based source quality (not popularity)", evidence: sq.evidence },
    { id: "novelty", label: L.novelty, weight: W.novelty, score: novelty, explanation: noveltyText, evidence: [noveltyText] },
    { id: "tracked_relevance", label: L.tracked_relevance, weight: W.tracked_relevance, score: relevance, explanation: "overlap with watchlist assets and categories", evidence: relEvidence },
    {
      id: "verification",
      label: L.verification,
      weight: W.verification,
      score: verificationMap[input.verification],
      explanation: `verification status: ${input.verification.replace(/_/g, " ")}`,
      evidence: [input.verification === "unable_to_verify" ? "verification could not be completed" : `status ${input.verification}`],
    },
    { id: "time_sensitivity", label: L.time_sensitivity, weight: W.time_sensitivity, score: timeScore, explanation: timeText, evidence: [timeText] },
  ]);
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export interface ConfidenceInput {
  origin: { registered: boolean; isPrimary: boolean; name: string } | null;
  directness: "first_hand" | "attributed" | "plain" | "hedged" | "opinion";
  authoritativeConfirmed: boolean;
  primaryLocated: boolean;
  independentCount: number;
  evidenceItemCount: number;
  unresolvedContradictions: number;
  entityConfidences: number[];
  resurfaced: boolean;
  publishedAt: Date | null;
  instructionLikeText: boolean;
  /** Strongest unresolved contradiction: from the authoritative/issuing party, or another source. */
  contradictionSeverity?: "authoritative" | "other" | null;
  /** The originating or an authoritative source corrected the original claim. */
  corrected?: boolean;
}

/** Confidence is capped when the origin text contains instructions aimed at automated systems. */
export const INSTRUCTION_TEXT_CONFIDENCE_CAP = 35;
/** Multipliers applied when evidence contradicts or corrects the claim. */
export const CONTRADICTION_MULTIPLIER = { authoritative: 0.5, other: 0.8, corrected: 0.8 } as const;

export function computeConfidence(input: ConfidenceInput): ScoreResult {
  const W = CONFIDENCE_WEIGHTS;
  const L = CONFIDENCE_COMPONENT_LABELS;

  const authenticity = input.origin
    ? input.origin.registered
      ? input.origin.isPrimary
        ? 90
        : 65
      : 30
    : null;
  const authEvidence = input.origin
    ? [
        input.origin.registered
          ? `${input.origin.name} is a registered ${input.origin.isPrimary ? "primary " : ""}source configured by the operator`
          : `${input.origin.name} is not a registered source; identity not established`,
      ]
    : ["origin unknown"];

  const directnessMap = { first_hand: 90, attributed: 60, plain: 55, hedged: 25, opinion: 15 } as const;
  const directnessText = {
    first_hand: "first-hand statement from the publishing source",
    attributed: "reporting attributed to a named outlet/account",
    plain: "factual report without explicit sourcing",
    hedged: "hedged or anonymous sourcing (reportedly, sources say)",
    opinion: "opinion/commentary rather than reporting",
  }[input.directness];

  let corroboration: number;
  let corrText: string;
  if (input.authoritativeConfirmed) {
    corroboration = 95;
    corrText = "authoritative primary source matches the claim";
  } else if (input.primaryLocated) {
    corroboration = 80;
    corrText = "related primary source located";
  } else if (input.independentCount >= 3) {
    corroboration = 85;
    corrText = `${input.independentCount} independent reputable sources`;
  } else if (input.independentCount === 2) {
    corroboration = 65;
    corrText = "2 independent reputable sources";
  } else {
    corroboration = 20;
    corrText = "no independent corroboration";
  }

  const consistency =
    input.unresolvedContradictions > 0 ? 25 : input.evidenceItemCount >= 2 ? 85 : null;
  const consistencyText =
    consistency === null
      ? "only one evidence item — consistency across sources cannot be assessed"
      : input.unresolvedContradictions > 0
        ? "sources disagree"
        : "evidence items are consistent";

  const entityScore =
    input.entityConfidences.length === 0
      ? null
      : clamp((input.entityConfidences.reduce((a, b) => a + b, 0) / input.entityConfidences.length) * 100);

  const timeScore = input.publishedAt === null ? null : input.resurfaced ? 25 : 90;

  // Absence of contradictions is only informative once more than one source has spoken.
  const contradictionScore =
    input.unresolvedContradictions === 1 ? 30 : input.unresolvedContradictions >= 2 ? 10 : input.evidenceItemCount >= 2 ? 90 : null;

  const result = combineComponents([
    { id: "source_authenticity", label: L.source_authenticity, weight: W.source_authenticity, score: authenticity, explanation: "is the originating account who it appears to be?", evidence: authEvidence },
    { id: "directness", label: L.directness, weight: W.directness, score: directnessMap[input.directness], explanation: directnessText, evidence: [directnessText] },
    { id: "independent_corroboration", label: L.independent_corroboration, weight: W.independent_corroboration, score: corroboration, explanation: corrText, evidence: [corrText] },
    { id: "consistency", label: L.consistency, weight: W.consistency, score: consistency, explanation: consistencyText, evidence: [consistencyText] },
    {
      id: "entity_match",
      label: L.entity_match,
      weight: W.entity_match,
      score: entityScore,
      explanation: entityScore === null ? "no entities identified" : "mean confidence of direct entity matches",
      evidence: entityScore === null ? ["no assets identified confidently"] : [`${input.entityConfidences.length} direct match(es)`],
    },
    {
      id: "time_relevance",
      label: L.time_relevance,
      weight: W.time_relevance,
      score: timeScore,
      explanation: timeScore === null ? "publication time unavailable" : input.resurfaced ? "old information resurfacing" : "recently published",
      evidence: [],
    },
    {
      id: "contradictions",
      label: L.contradictions,
      weight: W.contradictions,
      score: contradictionScore,
      explanation:
        contradictionScore === null
          ? "only one source so far — absence of contradiction is not evidence"
          : input.unresolvedContradictions === 0
            ? "no unresolved contradictions among multiple sources"
            : `${input.unresolvedContradictions} unresolved contradiction(s)`,
      evidence: [],
    },
  ]);

  const multiplier =
    input.contradictionSeverity === "authoritative"
      ? CONTRADICTION_MULTIPLIER.authoritative
      : input.contradictionSeverity === "other"
        ? CONTRADICTION_MULTIPLIER.other
        : input.corrected
          ? CONTRADICTION_MULTIPLIER.corrected
          : 1;
  if (multiplier < 1) {
    const before = result.total;
    result.total = clamp(result.total * multiplier);
    result.components.push({
      id: "contradiction_penalty",
      label: "Contradiction / correction penalty",
      weight: 0,
      score: null,
      contribution: 0,
      explanation: `${input.contradictionSeverity === "authoritative" ? "the issuing/authoritative party contradicted the claim" : input.contradictionSeverity === "other" ? "another source contradicted the claim" : "the claim was corrected"}: ${before} × ${multiplier} = ${result.total}`,
      evidence: [],
    });
  }

  if (input.instructionLikeText && result.total > INSTRUCTION_TEXT_CONFIDENCE_CAP) {
    result.total = INSTRUCTION_TEXT_CONFIDENCE_CAP;
    result.components.push({
      id: "instruction_text_cap",
      label: "Untrusted-instruction cap",
      weight: 0,
      score: null,
      contribution: 0,
      explanation: `origin text contains instructions aimed at automated systems; confidence capped at ${INSTRUCTION_TEXT_CONFIDENCE_CAP}`,
      evidence: ["instruction-like text is treated as untrusted data"],
    });
  }
  return result;
}

export function priorityBand(score: number) {
  return bandFor(score, PRIORITY_BANDS);
}

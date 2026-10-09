import { CATEGORY_RESEARCH_PROMPTS, GENERIC_RESEARCH_PROMPTS } from "@/config/transmission";
import { categoryLabel, CLAIM_NATURE_CATEGORIES, type EventCategory } from "@/domain/categories";
import { VERIFICATION_META, type VerificationState } from "@/domain/verification";
import type { ValidatedExtraction } from "@/server/providers/ai/schema";
import { excerpt } from "@/server/lib/text";
import type { MappedAsset } from "./assets";
import type { ScoreResult } from "./scoring";
import type { VerificationResult } from "./verification";

/**
 * Stage 6 — explainability. Separates:
 *  - statements: what sources said (verbatim excerpts, linked to their source)
 *  - verified:   what the verification criteria establish
 *  - interpretations: hypotheses (rules-based or AI), always labelled
 *  - unverified: what remains uncertain
 */
export interface SourceStatement {
  itemId: string;
  sourceName: string;
  role: string;
  excerpt: string;
  url: string | null;
  publishedAt: string | null;
}

export interface Explanation {
  whyDetected: string[];
  whyScore: string[];
  whyConfidence: string[];
  whyAssets: string[];
  statements: SourceStatement[];
  verified: string[];
  unverified: string[];
  warnings: string[];
  verificationCriteria: string;
}

export interface EventAnalysis {
  transmission: string[];
  importanceDrivers: string[];
  importanceReducers: string[];
  evidenceToSeek: string[];
  keyUncertainties: string[];
  claimsToVerify: string[];
  bullish: string | null;
  bearish: string | null;
  ai: {
    provided: boolean;
    model: string | null;
    summary: string | null;
    claims: { claim: string; evidenceQuote: string; status: string }[];
    warnings: string[];
    status: string;
  };
}

export function buildExplanation(input: {
  categories: { category: EventCategory; score: number; evidence: string[] }[];
  originSourceName: string;
  originRegistered: boolean;
  importance: ScoreResult;
  confidence: ScoreResult;
  verification: VerificationResult;
  verificationStatus: VerificationState;
  assets: MappedAsset[];
  statements: SourceStatement[];
  warnings: string[];
  ignoredAmbiguous: string[];
}): Explanation {
  const whyDetected = input.categories.slice(0, 4).map(
    (c) => `${categoryLabel(c.category)} (rule score ${c.score.toFixed(2)}): ${c.evidence.slice(0, 3).join("; ")}`,
  );
  whyDetected.push(
    input.originRegistered ? `Collected from registered source “${input.originSourceName}”.` : `Collected from unregistered account “${input.originSourceName}” via a collection rule.`,
  );

  const top = [...input.importance.components].filter((c) => c.score !== null).sort((a, b) => b.contribution - a.contribution);
  const unknown = input.importance.components.filter((c) => c.score === null && c.weight > 0);
  const whyScore = top.slice(0, 4).map((c) => `${c.label}: ${c.score}/100 × ${Math.round(c.weight * 100)}% = ${c.contribution.toFixed(1)} pts — ${c.explanation}`);
  whyScore.push(`Evidence coverage ${Math.round(input.importance.coverage * 100)}% of weighted components (policy: ${input.importance.policy}).`);
  if (unknown.length) whyScore.push(`Not assessable: ${unknown.map((c) => c.label).join(", ")} — contributes 0 under the conservative policy.`);

  const whyConfidence = input.confidence.components
    .filter((c) => c.weight > 0 || c.id === "instruction_text_cap")
    .map((c) => `${c.label}: ${c.score === null ? "unknown" : `${c.score}/100`} — ${c.explanation}`);

  const whyAssets = input.assets.length
    ? input.assets.slice(0, 8).map((a) => `${a.symbol} (${a.relation}, mapping confidence ${Math.round(a.confidence * 100)}%): ${a.rationale}`)
    : ["No asset could be identified confidently — affected assets are unknown."];
  for (const amb of input.ignoredAmbiguous) whyAssets.push(`Ignored ambiguous ticker: ${amb}`);

  const verified: string[] = [];
  if (input.verification.authoritativeConfirmed) verified.push("An authoritative primary source published this information.");
  else if (input.verification.primaryLocated) verified.push("A related primary source was located (not yet matched to the specific claim).");
  if (input.verification.independentCount >= 2) verified.push(`${input.verification.independentCount} independent reputable sources report it.`);
  if (verified.length === 0) verified.push("Nothing has been verified beyond the fact that the source(s) published these statements.");

  const unverified: string[] = [];
  if (input.categories.some((c) => c.category === "rumor")) {
    unverified.push("The claim relies on hedged or anonymous sourcing. There is no confirmation from the parties involved.");
  }
  if (!input.verification.authoritativeConfirmed) {
    unverified.push(`Status “${VERIFICATION_META[input.verificationStatus].label}”: ${input.verification.reasons.join(" ") || VERIFICATION_META[input.verificationStatus].criteria}`);
  }
  const v = input.verification;
  if (v.sourceCount > v.independentGroups) {
    unverified.push(
      `${v.sourceCount} items reference the event but they come from ${v.independentGroups} independent source group${v.independentGroups === 1 ? "" : "s"}` +
        (v.independentCount < v.independentGroups ? ` (${v.independentCount} of them reputable)` : "") +
        " — repetition is not confirmation.",
    );
  }

  return {
    whyDetected,
    whyScore,
    whyConfidence,
    whyAssets,
    statements: input.statements,
    verified,
    unverified,
    warnings: input.warnings,
    verificationCriteria: VERIFICATION_META[input.verificationStatus].criteria,
  };
}

export function buildAnalysis(input: {
  categories: EventCategory[];
  assets: MappedAsset[];
  verificationStatus: VerificationState;
  ai: ValidatedExtraction | null;
  aiModel: string | null;
  aiStatus: string;
  aiWarnings: string[];
}): EventAnalysis {
  const subject = input.categories.filter((c) => !CLAIM_NATURE_CATEGORIES.has(c));
  const prompts = [...subject, ...input.categories.filter((c) => CLAIM_NATURE_CATEGORIES.has(c))]
    .map((c) => CATEGORY_RESEARCH_PROMPTS[c])
    .filter(Boolean);
  const uniq = (xs: string[]) => [...new Set(xs)].slice(0, 6);
  const drivers = uniq(prompts.flatMap((p) => p!.importanceDrivers));
  const reducers = uniq(prompts.flatMap((p) => p!.importanceReducers));
  const evidence = uniq(prompts.flatMap((p) => p!.evidenceToSeek));

  const transmission = uniq(input.assets.filter((a) => a.relation === "macro" || a.relation === "sector").map((a) => a.rationale));
  if (input.ai?.transmissionMechanism) transmission.unshift(`AI hypothesis: ${input.ai.transmissionMechanism}`);

  const uncertainties: string[] = [];
  if (input.verificationStatus !== "confirmed") uncertainties.push("Whether the underlying claim is accurate and complete.");
  uncertainties.push("Whether the information was already reflected in market prices.");
  uncertainties.push("The direction and size of any market reaction, which this tool does not predict.");
  for (const u of input.ai?.keyUncertainties ?? []) uncertainties.push(`AI: ${u}`);

  const claimsToVerify = uniq([
    ...(input.categories.includes("rumor") ? ["Confirmation or denial from the named parties."] : []),
    ...(input.ai?.claimsRequiringVerification ?? []).map((c) => `AI: ${c}`),
  ]);

  return {
    transmission: transmission.slice(0, 6),
    importanceDrivers: drivers.length ? drivers : GENERIC_RESEARCH_PROMPTS.importanceDrivers,
    importanceReducers: reducers.length ? reducers : GENERIC_RESEARCH_PROMPTS.importanceReducers,
    evidenceToSeek: uniq([...(evidence.length ? evidence : GENERIC_RESEARCH_PROMPTS.evidenceToSeek), ...(input.ai?.suggestedFollowUp ?? []).map((s) => `AI: ${s}`)]),
    keyUncertainties: uniq(uncertainties),
    claimsToVerify,
    bullish: input.ai?.bullishInterpretation ?? null,
    bearish: input.ai?.bearishInterpretation ?? null,
    ai: {
      provided: Boolean(input.ai),
      model: input.aiModel,
      summary: input.ai?.factualSummary ?? null,
      claims: input.ai?.claims ?? [],
      warnings: input.aiWarnings,
      status: input.aiStatus,
    },
  };
}

export function ruleTitle(text: string, title: string | null, isRumor: boolean): string {
  const base = title?.trim() || firstSentence(text);
  const clean = excerpt(base.replace(/\s+/g, " "), 150);
  return isRumor && !/^unverified/i.test(clean) ? `Unverified claim: ${clean}` : clean;
}

export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = /^(.{20,200}?[.!?])(\s|$)/.exec(flat);
  return m ? m[1] : flat.slice(0, 160);
}

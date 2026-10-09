import {
  CATEGORY_PATTERNS,
  CLASSIFICATION_THRESHOLD,
  CORRECTION_PATTERNS,
  DENIAL_PATTERNS,
  DIRECTNESS_PATTERNS,
} from "@/config/classification-rules";
import { CLAIM_NATURE_CATEGORIES, EVENT_CATEGORIES, type EventCategory } from "@/domain/categories";

/**
 * Stage 2 — deterministic event classification (multi-label) with evidence.
 * Optional AI analysis may later refine categories; this baseline is always
 * computed and stored so the result is reproducible and explainable.
 */
export interface CategoryScore {
  category: EventCategory;
  score: number;
  evidence: string[];
}

export interface TextSignals {
  hedged: boolean;
  opinion: boolean;
  firstHand: boolean;
  correction: boolean;
  denial: boolean;
}

export interface Classification {
  categories: CategoryScore[];
  primary: EventCategory | null;
  signals: TextSignals;
}

export function detectSignals(text: string): TextSignals {
  return {
    hedged: DIRECTNESS_PATTERNS.hedged.some((re) => re.test(text)),
    opinion: DIRECTNESS_PATTERNS.opinion.some((re) => re.test(text)),
    firstHand: DIRECTNESS_PATTERNS.firstHand.some((re) => re.test(text)),
    correction: CORRECTION_PATTERNS.some((re) => re.test(text)),
    denial: DENIAL_PATTERNS.some((re) => re.test(text)),
  };
}

export function classifyText(
  text: string,
  options: { sourceAuthorityDomains?: EventCategory[]; isPrimarySource?: boolean } = {},
): Classification {
  const scores: CategoryScore[] = [];
  for (const category of EVENT_CATEGORIES) {
    let score = 0;
    const evidence: string[] = [];
    for (const rule of CATEGORY_PATTERNS[category]) {
      const m = rule.pattern.exec(text);
      if (m) {
        score += rule.weight;
        evidence.push(`${rule.label}: “${m[0]}”`);
      }
    }
    if (score >= CLASSIFICATION_THRESHOLD) {
      scores.push({ category, score: Math.min(1, Number(score.toFixed(3))), evidence });
    }
  }

  const signals = detectSignals(text);

  // A primary source speaking in its own authority domain: boost that domain
  // slightly (it is the issuer), but never invent a category with no evidence.
  if (options.isPrimarySource && options.sourceAuthorityDomains?.length) {
    for (const s of scores) {
      if (options.sourceAuthorityDomains.includes(s.category)) {
        s.score = Math.min(1, Number((s.score + 0.15).toFixed(3)));
        s.evidence.push("published by a source that is authoritative for this category");
      }
    }
  }

  // Pure opinion with no factual-event category is market commentary.
  if (signals.opinion && !scores.some((s) => !CLAIM_NATURE_CATEGORIES.has(s.category))) {
    if (!scores.some((s) => s.category === "market_commentary")) {
      scores.push({ category: "market_commentary", score: 0.5, evidence: ["opinion marker without a new factual event"] });
    }
  }

  // Primary sources that do not match any pattern are still material by default.
  if (scores.length === 0 && options.isPrimarySource) {
    scores.push({ category: "other_material", score: 0.4, evidence: ["published by a registered primary source"] });
  }

  scores.sort((a, b) => b.score - a.score);
  const subject = scores.find((s) => !CLAIM_NATURE_CATEGORIES.has(s.category));
  const primary = subject?.category ?? scores[0]?.category ?? null;
  return { categories: scores, primary, signals };
}

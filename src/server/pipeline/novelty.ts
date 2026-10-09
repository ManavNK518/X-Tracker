import { NOVELTY_THRESHOLDS } from "@/config/scoring";
import { CLAIM_NATURE_CATEGORIES, type EventCategory } from "@/domain/categories";
import type { ItemRole } from "@/domain/misc";
import type { SourceCategory } from "@/domain/sources";
import { textSimilarity } from "@/server/lib/text";
import type { TextSignals } from "./classify";

/**
 * Stage 4 — novelty detection and clustering.
 *
 * Decides whether an item is new information, a repeat of a known event, a
 * corroboration, a follow-up, a correction or a contradiction. Repeats never
 * count as independent confirmation.
 */
export interface CandidateEvent {
  id: string;
  signature: string;
  entityKeys: string[];
  categories: EventCategory[];
  lastActivityAt: Date;
  firstSeenAt: Date;
  contentHashes: Set<string>;
  independenceKeys: Set<string>;
  isDemo: boolean;
}

export interface NoveltyItem {
  text: string;
  contentHash: string;
  entityKeys: string[];
  categories: EventCategory[];
  publishedAt: Date | null;
  collectedAt: Date;
  signals: TextSignals;
  isDemo: boolean;
}

export type RelationHint = "new" | "exact_duplicate" | "same_claim" | "related" | "correction" | "contradiction";

export interface NoveltyDecision {
  hint: RelationHint;
  eventId: string | null;
  similarity: number;
  sharedEntities: string[];
  /** Old information resurfacing (published long before collection). */
  resurfaced: boolean;
  reason: string;
}

function shared(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return a.filter((x) => set.has(x));
}

function subjectCategories(categories: EventCategory[]): EventCategory[] {
  return categories.filter((c) => !CLAIM_NATURE_CATEGORIES.has(c));
}

export function decideNovelty(item: NoveltyItem, candidates: CandidateEvent[]): NoveltyDecision {
  const resurfaced =
    item.publishedAt !== null &&
    item.collectedAt.getTime() - item.publishedAt.getTime() > NOVELTY_THRESHOLDS.resurfacedAgeHours * 3_600_000;

  let best: { c: CandidateEvent; sim: number; ents: string[]; score: number } | null = null;
  for (const c of candidates) {
    if (c.isDemo !== item.isDemo) continue; // demo and live data never mix
    if (c.contentHashes.has(item.contentHash)) {
      return {
        hint: "exact_duplicate",
        eventId: c.id,
        similarity: 1,
        sharedEntities: shared(item.entityKeys, c.entityKeys),
        resurfaced,
        reason: "identical normalized text already attached to this event",
      };
    }
    const sim = textSimilarity(item.text, c.signature);
    const ents = shared(item.entityKeys, c.entityKeys);
    const catOverlap = shared(subjectCategories(item.categories), subjectCategories(c.categories)).length > 0;
    // Ranking favours entity overlap so unrelated posts with similar wording do not merge.
    const score = sim + Math.min(0.3, ents.length * 0.1) + (catOverlap ? 0.05 : 0);
    if (!best || score > best.score) best = { c, sim, ents, score };
  }

  if (!best) return { hint: "new", eventId: null, similarity: 0, sharedEntities: [], resurfaced, reason: "no active events to compare" };
  const { c, sim, ents } = best;
  const itemSubject = subjectCategories(item.categories);
  const catOverlap = shared(itemSubject, subjectCategories(c.categories)).length > 0;
  // Items that only carry claim-nature categories (e.g. "rumor") or none at all
  // are compared on their full category set.
  const catOverlapAny = catOverlap || (itemSubject.length === 0 && shared(item.categories, c.categories).length > 0);
  const T = NOVELTY_THRESHOLDS;
  const decision = (hint: RelationHint, reason: string): NoveltyDecision => ({ hint, eventId: c.id, similarity: sim, sharedEntities: ents, resurfaced, reason });

  // Corrections and denials rarely reuse the original wording; rely on shared entities.
  const refersToSame = (ents.length >= 2 && sim >= T.correctionOrContradiction * 0.55) || (ents.length >= 1 && sim >= T.correctionOrContradiction);
  if (item.signals.correction && refersToSame) return decision("correction", "correction language referring to the same entities");
  if (item.signals.denial && refersToSame) return decision("contradiction", "denial/refutation of a claim about the same entities");

  if (sim >= T.repeat && (ents.length > 0 || catOverlapAny || sim >= 0.9)) {
    return decision("same_claim", `text similarity ${sim.toFixed(2)} ≥ ${T.repeat}`);
  }
  if (sim >= T.related && ents.length > 0) return decision("same_claim", `similar text (${sim.toFixed(2)}) about shared entities`);
  if (sim >= T.weakRelated + 0.05 && ents.length >= 2 && catOverlapAny) {
    return decision("same_claim", `moderately similar text (${sim.toFixed(2)}) with ${ents.length} shared entities`);
  }
  if (sim >= T.weakRelated && ents.length >= 2 && catOverlap) return decision("related", "follow-up about the same entities and category");
  if (item.signals.opinion && !item.signals.firstHand && ents.length >= 1 && sim >= 0.08) {
    return decision("related", "opinion/commentary about an existing event");
  }
  return { hint: "new", eventId: null, similarity: sim, sharedEntities: ents, resurfaced, reason: "no sufficiently similar active event" };
}

/** Source categories whose independent reporting counts as corroboration. */
const CORROBORATING_CATEGORIES: ReadonlySet<SourceCategory> = new Set([
  "news_org",
  "journalist",
  "industry_specialist",
  "researcher",
  "regulator",
  "central_bank",
  "government_agency",
  "statistical_agency",
  "exchange",
  "company",
  "executive",
]);

export interface RoleInput {
  hint: RelationHint;
  sourceCategory: SourceCategory;
  isPrimary: boolean;
  isAuthoritativeForEvent: boolean;
  independenceKey: string;
  eventIndependenceKeys: Set<string>;
  /** Item categories are opinion/commentary only. */
  commentaryOnly: boolean;
  /** Item expresses opinion rather than reporting facts. */
  isOpinion: boolean;
  isRepostOrQuote: boolean;
}

/** Assigns the evidentiary role of an item attached to an existing event. */
export function assignRole(input: RoleInput): ItemRole {
  switch (input.hint) {
    case "correction":
      return "correction";
    case "contradiction":
      return "contradiction";
    case "exact_duplicate":
      return "repeat";
    case "related":
      if (input.isOpinion || input.commentaryOnly) return "commentary";
      if (input.isAuthoritativeForEvent) return "primary_source";
      if (input.isRepostOrQuote || input.eventIndependenceKeys.has(input.independenceKey)) return "repeat";
      return "update";
    case "same_claim": {
      if (input.isAuthoritativeForEvent) return "primary_source";
      if (input.isRepostOrQuote) return "repeat";
      if (input.isOpinion || input.commentaryOnly) return "commentary";
      if (input.eventIndependenceKeys.has(input.independenceKey)) return "repeat";
      if (!CORROBORATING_CATEGORIES.has(input.sourceCategory)) return "repeat";
      return "corroboration";
    }
    default:
      return "origin";
  }
}

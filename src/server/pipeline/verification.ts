import { CLAIM_NATURE_CATEGORIES, type EventCategory } from "@/domain/categories";
import { EVIDENCE_ROLES, type ItemRole } from "@/domain/misc";
import type { SourceCategory } from "@/domain/sources";
import type { LifecycleState, VerificationState } from "@/domain/verification";

/**
 * Verification state machine. States are derived from explicit evidence
 * criteria, evaluated in priority order. Repetition by many accounts never
 * produces "confirmed", and "no contradiction found" never means verified.
 * See docs/VERIFICATION.md.
 */
export interface EvidenceItem {
  role: ItemRole;
  independenceKey: string;
  sourceCategory: SourceCategory;
  isPrimary: boolean;
  authorityDomains: EventCategory[];
  /** Similarity of this item's text to the event's origin claim (null for the origin itself). */
  similarityToOrigin: number | null;
  /** The item comes from the same source or organisation as the origin item. */
  sameSourceAsOrigin: boolean;
}

export interface ContradictionEvidence {
  fromAuthoritativePrimary: boolean;
  sourceQuality: number | null;
}

export interface VerificationInput {
  eventCategories: EventCategory[];
  items: EvidenceItem[];
  unresolvedContradictions: ContradictionEvidence[];
  originSourceQuality: number | null;
  lastActivityAt: Date;
  now: Date;
  staleAfterHours: number;
  /** A verification attempt could not be completed (needed sources unavailable). */
  lastAttemptFailed: boolean;
  resurfaced: boolean;
}

export interface VerificationResult {
  status: VerificationState;
  criteriaMet: string[];
  reasons: string[];
  primaryLocated: boolean;
  authoritativeConfirmed: boolean;
  /** Distinct independence groups among reputable evidence items (used for corroboration). */
  independentCount: number;
  /** Distinct independence groups among all evidence items, reputable or not. */
  independentGroups: number;
  /** All attached items (including repeats). */
  sourceCount: number;
}

const REPUTABLE: ReadonlySet<SourceCategory> = new Set([
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

/** Minimum similarity for a primary-source item to count as matching the claim. */
export const PRIMARY_MATCH_THRESHOLD = 0.35;

export function isAuthoritativeFor(item: { isPrimary: boolean; authorityDomains: EventCategory[] }, categories: EventCategory[]): boolean {
  if (!item.isPrimary) return false;
  const subject = categories.filter((c) => !CLAIM_NATURE_CATEGORIES.has(c));
  return subject.some((c) => item.authorityDomains.includes(c));
}

export function deriveVerification(input: VerificationInput): VerificationResult {
  const reasons: string[] = [];
  const criteriaMet: string[] = [];
  const evidence = input.items.filter((i) => EVIDENCE_ROLES.has(i.role));
  const reputableKeys = new Set(evidence.filter((i) => REPUTABLE.has(i.sourceCategory)).map((i) => i.independenceKey));
  const independentCount = reputableKeys.size;
  const independentGroups = Math.max(1, new Set(evidence.map((i) => i.independenceKey)).size);
  const sourceCount = input.items.length;

  const authoritativeMatches = input.items.filter(
    (i) =>
      (i.role === "origin" || i.role === "primary_source") &&
      isAuthoritativeFor(i, input.eventCategories) &&
      (i.role === "origin" || (i.similarityToOrigin ?? 0) >= PRIMARY_MATCH_THRESHOLD),
  );
  const primaryRelated = input.items.filter(
    (i) => i.isPrimary && (i.role === "primary_source" || i.role === "update" || i.role === "origin" || i.role === "corroboration"),
  );
  const authoritativeConfirmed = authoritativeMatches.length > 0;
  const primaryLocated = authoritativeConfirmed || primaryRelated.length > 0;

  const base = { primaryLocated, authoritativeConfirmed, independentCount, independentGroups, sourceCount };

  // 1) Corrected — a correction from the originating source/organisation or an authoritative source.
  const corrections = input.items.filter(
    (i) => i.role === "correction" && (i.sameSourceAsOrigin || isAuthoritativeFor(i, input.eventCategories)),
  );
  if (corrections.length > 0) {
    criteriaMet.push("correction published by the originating source or an authoritative source");
    return { status: "corrected", criteriaMet, reasons: ["A correction to the original claim was published."], ...base };
  }

  // 2) Disputed — authoritative denial, or a contradiction from a comparable/higher-quality source.
  const strongContradictions = input.unresolvedContradictions.filter(
    (c) =>
      c.fromAuthoritativePrimary ||
      (c.sourceQuality !== null && (input.originSourceQuality === null || c.sourceQuality >= input.originSourceQuality - 10)),
  );
  if (strongContradictions.length > 0) {
    criteriaMet.push(
      strongContradictions.some((c) => c.fromAuthoritativePrimary)
        ? "the issuing/authoritative party contradicted the claim"
        : "unresolved contradiction from a source of comparable or higher quality",
    );
    return { status: "disputed", criteriaMet, reasons: ["Conflicting information exists; see contradictions."], ...base };
  }
  if (input.unresolvedContradictions.length > 0) {
    reasons.push("A contradiction exists from a lower-quality source; it does not meet the dispute threshold.");
  }

  // 3) Confirmed — authoritative primary source published matching information.
  if (authoritativeConfirmed) {
    criteriaMet.push("authoritative primary source for this category published matching information");
    return { status: "confirmed", criteriaMet, reasons, ...base };
  }

  // 4) Primary source located (related but not matched strongly to the claim).
  if (primaryLocated) {
    criteriaMet.push("an official/primary source related to the event was linked");
    reasons.push("The primary source has not been matched strongly enough to the specific claim to count as confirmation.");
    return { status: "primary_source_located", criteriaMet, reasons, ...base };
  }

  // 5) Independently corroborated — at least two reputable, independent sources.
  if (independentCount >= 2) {
    criteriaMet.push(`${independentCount} independent reputable sources (reposts and same-origin reports excluded)`);
    return { status: "independently_corroborated", criteriaMet, reasons, ...base };
  }

  // 6) Stale — resurfaced old information, or no new evidence within the window.
  const idleHours = (input.now.getTime() - input.lastActivityAt.getTime()) / 3_600_000;
  if (input.resurfaced || idleHours > input.staleAfterHours) {
    criteriaMet.push(input.resurfaced ? "old information resurfacing" : `no new evidence for more than ${input.staleAfterHours}h`);
    return { status: "stale", criteriaMet, reasons: [...reasons, "Never confirmed or independently corroborated."], ...base };
  }

  // 7) Unable to verify — the verification attempt could not be completed.
  if (input.lastAttemptFailed) {
    criteriaMet.push("verification attempt could not be completed");
    return { status: "unable_to_verify", criteriaMet, reasons: [...reasons, "Sources required for verification were unavailable."], ...base };
  }

  reasons.push(
    sourceCount > 1 && independentGroups <= 1
      ? `${sourceCount} items reference this claim but all trace back to one origin (reposts, quotes or attributions).`
      : "No confirmation from a primary source or independent corroboration yet.",
  );
  return { status: "unverified", criteriaMet, reasons, ...base };
}

export function deriveLifecycle(input: {
  verification: VerificationState;
  itemCount: number;
  firstSeenAt: Date;
  now: Date;
}): LifecycleState {
  switch (input.verification) {
    case "confirmed":
    case "independently_corroborated":
      return "confirmed";
    case "disputed":
      return "disputed";
    case "stale":
      return "stale";
    default: {
      const ageHours = (input.now.getTime() - input.firstSeenAt.getTime()) / 3_600_000;
      return input.itemCount <= 1 && ageHours < 2 ? "new" : "developing";
    }
  }
}

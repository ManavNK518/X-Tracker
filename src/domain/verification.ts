/**
 * Verification states. Each state has explicit criteria (see
 * src/server/pipeline/verification.ts and docs/VERIFICATION.md). A state is
 * only assigned when its criteria are met.
 */
export const VERIFICATION_STATES = [
  "unverified",
  "primary_source_located",
  "independently_corroborated",
  "disputed",
  "corrected",
  "confirmed",
  "stale",
  "unable_to_verify",
] as const;

export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const VERIFICATION_META: Record<
  VerificationState,
  { label: string; tone: "neutral" | "positive" | "warning" | "negative" | "info"; criteria: string }
> = {
  unverified: {
    label: "Unverified",
    tone: "neutral",
    criteria:
      "No primary source, authoritative confirmation or independent corroboration has been linked. Absence of contradiction is not verification.",
  },
  primary_source_located: {
    label: "Primary source located",
    tone: "info",
    criteria:
      "An official/primary source related to the event's entities and category was linked, but it has not been matched strongly enough to the specific claim to count as confirmation.",
  },
  independently_corroborated: {
    label: "Independently corroborated",
    tone: "info",
    criteria:
      "At least two reputable sources with different independence groups report it, excluding reposts, quotes and attributions to the same underlying report.",
  },
  disputed: {
    label: "Disputed",
    tone: "negative",
    criteria:
      "An unresolved contradiction exists from a source of comparable or higher quality, or the primary/issuing party denied the claim.",
  },
  corrected: {
    label: "Corrected",
    tone: "warning",
    criteria: "The originating source or an authoritative source published a correction to the original claim.",
  },
  confirmed: {
    label: "Confirmed by authoritative evidence",
    tone: "positive",
    criteria:
      "An authoritative primary source for this category (the issuer itself, e.g. the central bank or the company) published the information, and it matches the event's claim.",
  },
  stale: {
    label: "Stale",
    tone: "neutral",
    criteria:
      "No new evidence within the staleness window and the event was never confirmed or corroborated, or it is old information resurfacing.",
  },
  unable_to_verify: {
    label: "Unable to verify",
    tone: "warning",
    criteria:
      "A verification attempt could not be completed (for example, the sources needed for verification were unavailable).",
  },
};

export const LIFECYCLE_STATES = ["new", "developing", "confirmed", "disputed", "stale"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const LIFECYCLE_LABELS: Record<LifecycleState, string> = {
  new: "New",
  developing: "Developing",
  confirmed: "Confirmed",
  disputed: "Disputed",
  stale: "Stale",
};

export function isVerificationState(value: unknown): value is VerificationState {
  return typeof value === "string" && (VERIFICATION_STATES as readonly string[]).includes(value);
}

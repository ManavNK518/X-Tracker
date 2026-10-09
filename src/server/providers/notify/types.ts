import { PRODUCT } from "@/config/product";
import { categoryLabel } from "@/domain/categories";
import { VERIFICATION_META, isVerificationState } from "@/domain/verification";

/** Alert payload stored with each notification and rendered by every channel. */
export interface AlertPayload {
  eventId: string;
  eventRef: string;
  kind: string;
  title: string;
  category: string;
  importance: number;
  confidence: number;
  band: string;
  verification: string;
  assets: string[];
  sourceName: string;
  sourceUrl: string | null;
  eventTime: string | null;
  summary: string;
  whyItMatters: string;
  keyUncertainty: string;
  investigationUrl: string;
  isDemo: boolean;
  changes: string[];
}

export interface Notifier {
  readonly channel: "email" | "telegram" | "discord";
  configured(): boolean;
  /** Throws on failure. Must not log secrets. */
  send(payload: AlertPayload): Promise<void>;
}

const KIND_LABEL: Record<string, string> = {
  new: "NEW",
  update: "UPDATE",
  escalation: "ESCALATION",
  correction: "CORRECTION / DISPUTE",
};

export function formatAlertText(p: AlertPayload): { subject: string; text: string } {
  const verification = isVerificationState(p.verification) ? VERIFICATION_META[p.verification].label : p.verification;
  const header = `${p.isDemo ? "[SAMPLE DATA] " : ""}${categoryLabel(p.category).toUpperCase()} — ${KIND_LABEL[p.kind] ?? p.kind.toUpperCase()}`;
  const lines = [
    header,
    p.title,
    "",
    `Importance: ${p.importance}/100 (research priority, not a probability)`,
    `Evidence confidence: ${p.confidence}/100`,
    `Verification: ${verification}`,
    `Summary: ${p.summary}`,
    `Potential relevance: ${p.whyItMatters}`,
    `Uncertainty: ${p.keyUncertainty}`,
    `Assets: ${p.assets.length ? p.assets.join(", ") : "unknown"}`,
    `Source: ${p.sourceName}${p.sourceUrl ? ` — ${p.sourceUrl}` : " — (no original link available)"}`,
    p.eventTime ? `Published: ${p.eventTime} UTC` : "Published: unknown",
    p.changes.length ? `What changed: ${p.changes.join("; ")}` : "",
    `Investigate: ${p.investigationUrl}`,
    "",
    PRODUCT.disclaimer,
  ].filter((l) => l !== "");
  return { subject: `${p.isDemo ? "[SAMPLE] " : ""}[${p.importance}] ${p.title}`.slice(0, 200), text: lines.join("\n") };
}

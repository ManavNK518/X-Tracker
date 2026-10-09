"use client";

import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { categoryLabel } from "@/domain/categories";
import { ASSET_RELATION_LABELS, type AssetRelation } from "@/domain/misc";
import { DEFAULT_PRIORITY_BANDS, bandFor } from "@/domain/priority";
import { SOURCE_CATEGORY_LABELS, isSourceCategory } from "@/domain/sources";
import { LIFECYCLE_LABELS, VERIFICATION_META, isVerificationState, type LifecycleState } from "@/domain/verification";
import { cn } from "@/lib/client/cn";

type Tone = "neutral" | "positive" | "warning" | "negative" | "info" | "accent";

const toneClass: Record<Tone, string> = {
  neutral: "border-line text-fg-2 bg-elevated",
  positive: "border-positive/35 text-positive bg-positive-soft",
  warning: "border-warning/35 text-warning bg-warning-soft",
  negative: "border-negative/35 text-negative bg-negative-soft",
  info: "border-info/35 text-info bg-info-soft",
  accent: "border-accent-line text-accent bg-accent-soft",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-px text-2xs font-medium whitespace-nowrap", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function bandTone(score: number): { text: string; bar: string; band: string } {
  const band = bandFor(score, DEFAULT_PRIORITY_BANDS);
  switch (band.id) {
    case "critical":
      return { text: "text-accent", bar: "bg-accent", band: band.label };
    case "high":
      return { text: "text-warning", bar: "bg-warning", band: band.label };
    case "moderate":
      return { text: "text-fg", bar: "bg-fg-2", band: band.label };
    default:
      return { text: "text-fg-3", bar: "bg-fg-3", band: band.label };
  }
}

/** Importance = research priority. Never presented as a probability. */
export function ImportanceScore({ value, coverage, size = "md", short }: { value: number; coverage?: number; size?: "sm" | "md" | "lg"; short?: boolean }) {
  const t = bandTone(value);
  return (
    <div
      className="flex flex-col items-start leading-none"
      title={`Importance ${value}/100 — ${t.band}. A research-priority score, not a probability of price movement.${coverage !== undefined ? ` Evidence coverage ${Math.round(coverage * 100)}%.` : ""}`}
    >
      <span className={cn("font-mono font-semibold tabular", t.text, size === "lg" ? "text-3xl" : size === "md" ? "text-lg" : "text-sm")}>{value}</span>
      <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-fg-3">{short ? "Imp" : "Importance"}</span>
    </div>
  );
}

export function ConfidenceScore({ value, size = "md", short }: { value: number; size?: "sm" | "md" | "lg"; short?: boolean }) {
  const tone = value >= 70 ? "text-positive" : value >= 40 ? "text-fg-2" : "text-negative";
  return (
    <div className="flex flex-col items-start leading-none" title={`Evidence confidence ${value}/100 — strength of the evidence supporting the interpretation (separate from importance).`}>
      <span className={cn("font-mono font-semibold tabular", tone, size === "lg" ? "text-3xl" : size === "md" ? "text-lg" : "text-sm")}>{value}</span>
      <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-fg-3">{short ? "Conf" : "Confidence"}</span>
    </div>
  );
}

export function ScoreBar({ value, coverage, tone = "accent" }: { value: number; coverage?: number; tone?: "accent" | "positive" | "neutral" }) {
  const color = tone === "accent" ? "bg-accent" : tone === "positive" ? "bg-positive" : "bg-fg-2";
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-elevated" aria-hidden>
      {coverage !== undefined && <div className="absolute inset-y-0 left-0 bg-line" style={{ width: `${Math.round(coverage * 100)}%` }} />}
      <div className={cn("absolute inset-y-0 left-0 rounded-full", color)} style={{ width: `${value}%` }} />
    </div>
  );
}

export function VerificationBadge({ status, className }: { status: string; className?: string }) {
  if (!isVerificationState(status)) return <Badge className={className}>{status}</Badge>;
  const meta = VERIFICATION_META[status];
  return (
    <Badge tone={meta.tone === "neutral" ? "neutral" : meta.tone} className={className} title={meta.criteria}>
      {meta.label}
    </Badge>
  );
}

export function LifecycleBadge({ state }: { state: string }) {
  const label = LIFECYCLE_LABELS[state as LifecycleState] ?? state;
  const tone: Tone = state === "new" ? "accent" : state === "confirmed" ? "positive" : state === "disputed" ? "negative" : "neutral";
  return (
    <Badge tone={tone} className="uppercase tracking-wide">
      {label}
    </Badge>
  );
}

/** Every sample item carries this badge. Demo data must never look like live information. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge tone="warning" className={cn("uppercase tracking-wider", className)} title="Fictional sample data generated by demo mode — not real market information.">
      <FlaskConical className="size-3" aria-hidden />
      Sample data
    </Badge>
  );
}

export function CategoryTag({ category, muted }: { category: string; muted?: boolean }) {
  return <span className={cn("text-2xs font-medium", muted ? "text-fg-3" : "text-fg-2")}>{categoryLabel(category)}</span>;
}

export function TickerChip({ symbol, relation, title }: { symbol: string; relation?: string; title?: string }) {
  const direct = !relation || relation === "direct";
  return (
    <span
      title={title ?? (relation ? ASSET_RELATION_LABELS[relation as AssetRelation] ?? relation : undefined)}
      className={cn(
        "inline-flex items-center rounded px-1 py-px font-mono text-2xs font-medium",
        direct ? "bg-elevated text-fg border border-line" : "text-fg-3 border border-dashed border-line",
      )}
    >
      {symbol}
    </span>
  );
}

export function SourceTypeLabel({ category }: { category: string }) {
  return <span className="text-2xs text-fg-3">{isSourceCategory(category) ? SOURCE_CATEGORY_LABELS[category] : category}</span>;
}

export function StatusDot({ status, pulse }: { status: "ok" | "warn" | "error" | "off" | "info"; pulse?: boolean }) {
  const color = { ok: "bg-positive", warn: "bg-warning", error: "bg-negative", off: "bg-fg-3", info: "bg-info" }[status];
  return <span className={cn("inline-block size-1.5 rounded-full", color, pulse && "pulse-dot")} aria-hidden />;
}

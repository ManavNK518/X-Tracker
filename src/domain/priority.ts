/**
 * Priority bands map an importance score (0–100) to a research-priority label.
 * Thresholds are configurable (src/config/scoring.ts). A score is a research
 * prioritisation, never a probability of price movement or profit.
 */
export type PriorityBandId = "critical" | "high" | "moderate" | "low" | "minimal";

export interface PriorityBand {
  id: PriorityBandId;
  label: string;
  /** Inclusive lower bound. */
  min: number;
}

export const DEFAULT_PRIORITY_BANDS: PriorityBand[] = [
  { id: "critical", label: "Critical research priority", min: 80 },
  { id: "high", label: "High priority", min: 60 },
  { id: "moderate", label: "Moderate priority", min: 40 },
  { id: "low", label: "Low priority", min: 20 },
  { id: "minimal", label: "Minimal priority", min: 0 },
];

export function bandFor(score: number, bands: PriorityBand[] = DEFAULT_PRIORITY_BANDS): PriorityBand {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  for (const band of sorted) {
    if (score >= band.min) return band;
  }
  return sorted[sorted.length - 1];
}

export const BAND_ORDER: PriorityBandId[] = ["minimal", "low", "moderate", "high", "critical"];

export function bandRank(id: PriorityBandId): number {
  return BAND_ORDER.indexOf(id);
}

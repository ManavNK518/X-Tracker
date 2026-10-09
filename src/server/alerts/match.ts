import { parseHhMm, minutesOfDay, zonedParts, zonedTimeToUtc, isValidTimeZone } from "@/lib/time";

/**
 * Pure alert-matching logic (unit tested). Rules and watchlists are evaluated
 * against an event snapshot; every decision carries human-readable reasons so
 * "why didn't I get an alert?" can always be answered.
 */
export interface AlertEventView {
  id: string;
  importance: number;
  confidence: number;
  band: string;
  verificationStatus: string;
  categories: string[];
  assetSymbols: string[];
  originSourceCategory: string;
  evidenceSourceIds: string[];
  timeSensitivity: number | null;
  isDemo: boolean;
  /** Lower-cased searchable text (title, summary, origin text). */
  text: string;
}

export interface RuleView {
  id: string;
  name: string;
  kind: "rule" | "watchlist";
  minImportance: number;
  minConfidence: number;
  categories: string[];
  assetSymbols: string[];
  sourceCategories: string[];
  verificationStates: string[];
  requireTimeSensitive: boolean;
  includeDemo: boolean;
  channels: string[];
  cooldownMinutes: number | null;
  keywords: string[];
  sourceIds: string[];
}

export interface MatchResult {
  matched: boolean;
  reasons: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function keywordMatches(text: string, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (k.length < 2) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(k)}(?![\\p{L}\\p{N}])`, "u").test(text);
}

export function matchRule(event: AlertEventView, rule: RuleView): MatchResult {
  const fails: string[] = [];
  const passes: string[] = [];

  if (event.isDemo && !rule.includeDemo) fails.push("sample (demo) events are excluded by this rule");
  if (event.importance < rule.minImportance) fails.push(`importance ${event.importance} < ${rule.minImportance}`);
  else passes.push(`importance ${event.importance} ≥ ${rule.minImportance}`);
  if (event.confidence < rule.minConfidence) fails.push(`confidence ${event.confidence} < ${rule.minConfidence}`);
  if (rule.categories.length && !rule.categories.some((c) => event.categories.includes(c))) {
    fails.push(`category not in [${rule.categories.join(", ")}]`);
  }
  if (rule.sourceCategories.length && !rule.sourceCategories.includes(event.originSourceCategory)) {
    fails.push(`source type ${event.originSourceCategory} not in [${rule.sourceCategories.join(", ")}]`);
  }
  if (rule.verificationStates.length && !rule.verificationStates.includes(event.verificationStatus)) {
    fails.push(`verification ${event.verificationStatus} not in [${rule.verificationStates.join(", ")}]`);
  }
  if (rule.requireTimeSensitive && (event.timeSensitivity ?? 0) < 55) {
    fails.push("not time-sensitive (published more than ~6h ago or time unknown)");
  }

  if (rule.kind === "watchlist") {
    // A watchlist is relevant if any of its selectors matches.
    const eventSymbols = new Set(event.assetSymbols.map((s) => s.toUpperCase()));
    const assetHit = rule.assetSymbols.find((s) => eventSymbols.has(s.toUpperCase()));
    const keywordHit = rule.keywords.find((k) => keywordMatches(event.text, k));
    const sourceHit = rule.sourceIds.find((id) => event.evidenceSourceIds.includes(id));
    const hasSelectors = rule.assetSymbols.length + rule.keywords.length + rule.sourceIds.length > 0;
    if (hasSelectors && !assetHit && !keywordHit && !sourceHit) {
      fails.push("no watchlist asset, keyword or source matched");
    } else {
      if (assetHit) passes.push(`asset ${assetHit}`);
      if (keywordHit) passes.push(`keyword “${keywordHit}”`);
      if (sourceHit) passes.push("selected source");
    }
  } else if (rule.assetSymbols.length) {
    const eventSymbols = new Set(event.assetSymbols.map((s) => s.toUpperCase()));
    const hit = rule.assetSymbols.find((s) => eventSymbols.has(s.toUpperCase()));
    if (!hit) fails.push(`no asset in [${rule.assetSymbols.join(", ")}]`);
    else passes.push(`asset ${hit}`);
  }

  return fails.length ? { matched: false, reasons: fails } : { matched: true, reasons: passes };
}

export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
  allowCritical: boolean;
}

/** Returns whether `now` falls in quiet hours (in the user's time zone) and when they end. */
export function quietHoursStatus(now: Date, timeZone: string, qh: QuietHours): { active: boolean; endsAt: Date | null } {
  if (!qh.enabled) return { active: false, endsAt: null };
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const start = parseHhMm(qh.start);
  const end = parseHhMm(qh.end);
  if (start === null || end === null || start === end) return { active: false, endsAt: null };
  const m = minutesOfDay(now, tz);
  const overnight = start > end;
  const active = overnight ? m >= start || m < end : m >= start && m < end;
  if (!active) return { active: false, endsAt: null };
  const p = zonedParts(now, tz);
  // End is today if we're before it, otherwise tomorrow (overnight window).
  let endDate = zonedTimeToUtc(p.year, p.month, p.day, Math.floor(end / 60), end % 60, tz);
  if (endDate.getTime() <= now.getTime()) {
    const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    endDate = zonedTimeToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), Math.floor(end / 60), end % 60, tz);
  }
  return { active: true, endsAt: endDate };
}

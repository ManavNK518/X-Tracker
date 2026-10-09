export const SOURCE_CATEGORIES = [
  "company",
  "executive",
  "central_bank",
  "regulator",
  "government_agency",
  "statistical_agency",
  "exchange",
  "news_org",
  "journalist",
  "industry_specialist",
  "researcher",
  "market_commentator",
  "unknown",
] as const;

export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export const SOURCE_CATEGORY_LABELS: Record<SourceCategory, string> = {
  company: "Company account",
  executive: "Executive account",
  central_bank: "Central bank",
  regulator: "Regulator",
  government_agency: "Government agency",
  statistical_agency: "Statistical agency",
  exchange: "Exchange",
  news_org: "Financial news organization",
  journalist: "Journalist",
  industry_specialist: "Industry specialist",
  researcher: "Researcher",
  market_commentator: "Market commentator",
  unknown: "Unregistered / unknown",
};

export const PROVIDERS = ["x", "rss", "demo"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  x: "X API v2",
  rss: "Official RSS/Atom",
  demo: "Demo (sample data)",
};

export const SOURCE_STATUSES = [
  "ok",
  "error",
  "disabled",
  "awaiting_credentials",
  "never_run",
  "rate_limited",
] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export function isSourceCategory(value: unknown): value is SourceCategory {
  return typeof value === "string" && (SOURCE_CATEGORIES as readonly string[]).includes(value);
}

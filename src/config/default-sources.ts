import type { EventCategory } from "@/domain/categories";
import type { ProviderId, SourceCategory } from "@/domain/sources";

/**
 * Initial source registry, seeded on first start. Everything here can be
 * edited from the Sources screen; nothing in the pipeline depends on these
 * particular entries.
 *
 * RSS feed URLs were checked for availability on 2026-10-08. Feeds marked
 * `requires: "SEC_USER_AGENT"` stay disabled until a descriptive User-Agent
 * with contact details is configured, per the SEC's fair-access policy.
 *
 * X accounts are seeded *disabled*: X API reads are billed per post
 * (pay-per-use), so collection is opt-in after X_BEARER_TOKEN is configured.
 */
export interface DefaultSource {
  provider: ProviderId;
  externalId: string;
  handle: string | null;
  name: string;
  category: SourceCategory;
  isPrimary: boolean;
  /** Claim categories this source is authoritative for (e.g. a central bank for monetary policy). */
  authorityDomains: EventCategory[];
  organization: string;
  topics: string[];
  enabled: boolean;
  config?: Record<string, unknown>;
  requires?: "SEC_USER_AGENT" | "X_BEARER_TOKEN";
  notes?: string;
}

export const DEFAULT_SOURCES: DefaultSource[] = [
  // ---- Official RSS / Atom feeds (free, public) ----
  {
    provider: "rss",
    externalId: "https://www.federalreserve.gov/feeds/press_all.xml",
    handle: null,
    name: "Federal Reserve Board — press releases",
    category: "central_bank",
    isPrimary: true,
    authorityDomains: ["monetary_policy", "regulatory"],
    organization: "Federal Reserve",
    topics: ["monetary policy", "bank regulation"],
    enabled: true,
  },
  {
    provider: "rss",
    externalId: "https://www.federalreserve.gov/feeds/speeches.xml",
    handle: null,
    name: "Federal Reserve Board — speeches",
    category: "central_bank",
    isPrimary: true,
    authorityDomains: ["monetary_policy"],
    organization: "Federal Reserve",
    topics: ["monetary policy", "speeches"],
    enabled: true,
  },
  {
    provider: "rss",
    externalId: "https://apps.bea.gov/rss/rss.xml",
    handle: null,
    name: "U.S. Bureau of Economic Analysis — releases",
    category: "statistical_agency",
    isPrimary: true,
    authorityDomains: ["economic_data"],
    organization: "BEA",
    topics: ["GDP", "PCE", "personal income", "trade"],
    enabled: true,
  },
  {
    provider: "rss",
    externalId: "https://www.ecb.europa.eu/rss/press.html",
    handle: null,
    name: "European Central Bank — press",
    category: "central_bank",
    isPrimary: true,
    authorityDomains: ["monetary_policy"],
    organization: "ECB",
    topics: ["monetary policy", "euro area"],
    enabled: true,
  },
  {
    provider: "rss",
    externalId: "https://www.bankofengland.co.uk/rss/news",
    handle: null,
    name: "Bank of England — news",
    category: "central_bank",
    isPrimary: true,
    authorityDomains: ["monetary_policy"],
    organization: "Bank of England",
    topics: ["monetary policy", "UK"],
    enabled: true,
  },
  {
    provider: "rss",
    externalId: "https://www.bankofcanada.ca/content_type/press-releases/feed/",
    handle: null,
    name: "Bank of Canada — press releases",
    category: "central_bank",
    isPrimary: true,
    authorityDomains: ["monetary_policy"],
    organization: "Bank of Canada",
    topics: ["monetary policy", "Canada"],
    enabled: true,
  },
  {
    provider: "rss",
    externalId: "https://www.cftc.gov/RSS/RSSGP/rssgp.xml",
    handle: null,
    name: "CFTC — general press releases",
    category: "regulator",
    isPrimary: true,
    authorityDomains: ["regulatory", "legal"],
    organization: "CFTC",
    topics: ["derivatives", "digital assets", "enforcement"],
    // Verified 2026-10-08: the site sits behind bot management that
    // intermittently refuses automated requests (HTTP 403). Bot protection is
    // never worked around, so this feed is opt-in and failures are reported.
    enabled: false,
    notes: "Intermittently refuses automated requests (HTTP 403 from bot protection). Enable if it works from your network; failures are reported, never bypassed.",
  },
  {
    provider: "rss",
    externalId: "https://www.eia.gov/rss/press_rss.xml",
    handle: null,
    name: "U.S. Energy Information Administration — press",
    category: "government_agency",
    isPrimary: true,
    authorityDomains: ["commodity"],
    organization: "EIA",
    topics: ["oil", "natural gas", "energy"],
    enabled: true,
  },
  {
    provider: "rss",
    externalId: "https://www.sec.gov/news/pressreleases.rss",
    handle: null,
    name: "SEC — press releases",
    category: "regulator",
    isPrimary: true,
    authorityDomains: ["regulatory", "legal"],
    organization: "SEC",
    topics: ["securities regulation", "enforcement"],
    enabled: true,
    requires: "SEC_USER_AGENT",
  },
  {
    provider: "rss",
    externalId:
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&start=0&count=40&output=atom",
    handle: null,
    name: "SEC EDGAR — current 8-K filings",
    category: "company",
    isPrimary: true,
    authorityDomains: ["earnings", "guidance", "corporate_transaction", "leadership", "other_material"],
    organization: "SEC EDGAR (issuer filings)",
    topics: ["company filings"],
    enabled: false,
    requires: "SEC_USER_AGENT",
    notes:
      "High volume across all issuers. Enable when you want filing-level primary-source coverage; consider narrowing with watchlist filters.",
  },

  // ---- X accounts (opt-in, billed per post read) ----
  ...xAccount("federalreserve", "Federal Reserve (X)", "central_bank", true, ["monetary_policy", "regulatory"], "Federal Reserve"),
  ...xAccount("USTreasury", "U.S. Treasury (X)", "government_agency", true, ["regulatory", "economic_data"], "U.S. Treasury"),
  ...xAccount("SECGov", "SEC (X)", "regulator", true, ["regulatory", "legal"], "SEC"),
  ...xAccount("BLS_gov", "Bureau of Labor Statistics (X)", "statistical_agency", true, ["economic_data"], "BLS"),
  ...xAccount("BEA_News", "Bureau of Economic Analysis (X)", "statistical_agency", true, ["economic_data"], "BEA"),
  ...xAccount("ecb", "European Central Bank (X)", "central_bank", true, ["monetary_policy"], "ECB"),
  ...xAccount("bankofengland", "Bank of England (X)", "central_bank", true, ["monetary_policy"], "Bank of England"),
  ...xAccount("CFTC", "CFTC (X)", "regulator", true, ["regulatory", "legal"], "CFTC"),
  ...xAccount("EIAgov", "EIA (X)", "government_agency", true, ["commodity"], "EIA"),
  ...xAccount("nvidia", "NVIDIA (X)", "company", true, ["earnings", "guidance", "product_launch", "corporate_transaction"], "NVIDIA"),
  ...xAccount("Reuters", "Reuters (X)", "news_org", false, [], "Reuters"),
  ...xAccount("business", "Bloomberg (X)", "news_org", false, [], "Bloomberg"),
  ...xAccount("WSJ", "The Wall Street Journal (X)", "news_org", false, [], "Dow Jones"),
  ...xAccount("CNBC", "CNBC (X)", "news_org", false, [], "CNBC"),
];

function xAccount(
  handle: string,
  name: string,
  category: SourceCategory,
  isPrimary: boolean,
  authorityDomains: EventCategory[],
  organization: string,
): DefaultSource[] {
  return [
    {
      provider: "x",
      externalId: handle.toLowerCase(),
      handle,
      name,
      category,
      isPrimary,
      authorityDomains,
      organization,
      topics: [],
      enabled: false,
      requires: "X_BEARER_TOKEN",
      notes: "Opt-in: X API reads are billed per post returned.",
    },
  ];
}

/**
 * Default X keyword collection rules (disabled until explicitly enabled).
 * Queries use X API v2 recent-search operators.
 */
export const DEFAULT_COLLECTION_RULES = [
  {
    provider: "x" as const,
    name: "Macro releases & Fed (keywords)",
    query: '(FOMC OR "rate decision" OR "nonfarm payrolls" OR "CPI report" OR "jobs report") -is:retweet -is:reply lang:en',
    enabled: false,
    maxResults: 25,
    intervalSeconds: 900,
  },
  {
    provider: "x" as const,
    name: "Semiconductor supply chain (keywords)",
    query: '(TSMC OR "chip shortage" OR "export controls" OR HBM) (outage OR halt OR shortage OR ban OR restrictions) -is:retweet lang:en',
    enabled: false,
    maxResults: 25,
    intervalSeconds: 1800,
  },
];

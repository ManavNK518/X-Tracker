/**
 * Data-transfer types shared by the API and the UI. Type-only; no runtime code
 * and no server imports, so client components can import them safely.
 */

export interface ScoreComponentDTO {
  id: string;
  label: string;
  weight: number;
  score: number | null;
  contribution: number;
  explanation: string;
  evidence: string[];
}

export interface FeedEventDTO {
  id: string;
  ref: string;
  title: string;
  summary: string;
  primaryCategory: string;
  categories: string[];
  lifecycle: string;
  verificationStatus: string;
  importance: number;
  importanceCoverage: number;
  confidence: number;
  confidenceCoverage: number;
  band: string;
  firstSeenAt: string;
  firstPublishedAt: string | null;
  lastActivityAt: string;
  sourceCount: number;
  independentSourceCount: number;
  isDemo: boolean;
  aiStatus: string;
  whyRelevant: string | null;
  flags: string[];
  origin: {
    provider: string;
    sourceName: string;
    handle: string | null;
    sourceCategory: string;
    registered: boolean;
    url: string | null;
    publishedAt: string | null;
    collectedAt: string;
    excerpt: string | null;
    contentStatus: string;
  } | null;
  assets: { symbol: string; name: string; relation: string; confidence: number }[];
  user: { saved: boolean; reviewedAt: string | null };
}

export interface FeedPageDTO {
  items: FeedEventDTO[];
  nextCursor: string | null;
}

export interface EventItemDTO {
  itemId: string;
  role: string;
  independenceKey: string;
  similarity: number | null;
  note: string | null;
  addedAt: string;
  provider: string;
  url: string | null;
  authorHandle: string | null;
  authorName: string | null;
  publishedAt: string | null;
  collectedAt: string;
  text: string | null;
  title: string | null;
  contentStatus: string;
  isDemo: boolean;
  source: { id: string; name: string; category: string; isPrimary: boolean; organization: string | null } | null;
  analysis: { outcome: string; flags: string[]; aiStatus: string } | null;
}

export interface EventDetailDTO extends FeedEventDTO {
  eventTime: string | null;
  materialVersion: number;
  lastVerifiedAt: string | null;
  importanceComponents: ScoreComponentDTO[];
  confidenceComponents: ScoreComponentDTO[];
  explanation: {
    whyDetected: string[];
    whyScore: string[];
    whyConfidence: string[];
    whyAssets: string[];
    statements: { itemId: string; sourceName: string; role: string; excerpt: string; url: string | null; publishedAt: string | null }[];
    verified: string[];
    unverified: string[];
    warnings: string[];
    verificationCriteria: string;
  };
  analysis: {
    transmission: string[];
    importanceDrivers: string[];
    importanceReducers: string[];
    evidenceToSeek: string[];
    keyUncertainties: string[];
    claimsToVerify: string[];
    bullish: string | null;
    bearish: string | null;
    ai: { provided: boolean; model: string | null; summary: string | null; claims: { claim: string; evidenceQuote: string; status: string }[]; warnings: string[]; status: string };
  };
  items: EventItemDTO[];
  assetDetails: { symbol: string; name: string; assetClass: string | null; relation: string; confidence: number; rationale: string; matchedText: string | null; method: string }[];
  classifications: { category: string; score: number; method: string; evidence: string[] }[];
  scoreHistory: { id: string; importance: number; confidence: number; importanceCoverage: number; confidenceCoverage: number; verificationStatus: string; band: string; reason: string; scoringVersion: string; createdAt: string }[];
  verificationAttempts: { id: string; attemptedAt: string; method: string; status: string; resultStatus: string; details: Record<string, unknown>; error: string | null }[];
  contradictions: { id: string; itemId: string | null; description: string; resolved: boolean; createdAt: string }[];
  feedback: string[];
  notes: { id: string; title: string; status: string; updatedAt: string }[];
  alertDecisions: { decision: string; reasons: string[]; materialVersion: number; createdAt: string }[];
}

export interface WatchlistDTO {
  id: string;
  name: string;
  description: string | null;
  minImportance: number;
  minConfidence: number;
  categories: string[];
  sourceIds: string[];
  keywords: string[];
  notify: boolean;
  channels: string[];
  assets: { symbol: string; name: string; assetClass: string | null; aliases: string[]; custom: boolean }[];
  createdAt: string;
  updatedAt: string;
}

export interface AlertRuleDTO {
  id: string;
  name: string;
  enabled: boolean;
  watchlistId: string | null;
  minImportance: number;
  minConfidence: number;
  categories: string[];
  assetSymbols: string[];
  sourceCategories: string[];
  verificationStates: string[];
  requireTimeSensitive: boolean;
  channels: string[];
  cooldownMinutes: number | null;
  includeDemo: boolean;
}

export interface SourceDTO {
  id: string;
  provider: string;
  externalId: string;
  handle: string | null;
  name: string;
  category: string;
  isPrimary: boolean;
  authorityDomains: string[];
  organization: string | null;
  topics: string[];
  enabled: boolean;
  isDemo: boolean;
  status: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
  notes: string | null;
  requires: string | null;
  itemCount: number;
  reliability: { observations: number; confirmed: number; refuted: number; corrected: number; provisional: boolean };
}

export interface NoteDTO {
  id: string;
  eventId: string | null;
  eventRef: string | null;
  title: string;
  summary: string;
  sources: { label: string; url: string | null; itemId?: string | null }[];
  thesis: string;
  assets: string[];
  transmission: string;
  bullish: string;
  bearish: string;
  alternatives: string;
  risks: string;
  evidenceNeeded: string;
  invalidation: string;
  followUpDate: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDTO {
  id: string;
  eventId: string;
  kind: string;
  title: string;
  payload: Record<string, unknown>;
  isDemo: boolean;
  readAt: string | null;
  createdAt: string;
  deliveries: { channel: string; status: string; attempts: number; lastError: string | null; deliveredAt: string | null }[];
}

export interface MeDTO {
  user: { id: string; email: string; displayName: string; role: string; plan: string };
  preferences: {
    timezone: string;
    theme: string;
    feedSort: string;
    feedMinImportance: number;
    showDemo: boolean;
    hideReviewed: boolean;
    quietHours: { enabled: boolean; start: string; end: string; allowCritical: boolean };
    channels: Record<string, boolean>;
  };
  entitlements: Record<string, number | boolean>;
  unreadNotifications: number;
}

export interface ConnectionStateDTO {
  mode: "live" | "demo" | "live+demo" | "awaiting_configuration" | "disconnected";
  providers: { provider: string; label: string; status: string; lastSuccessAt: string | null; lastError: string | null; configured: boolean; origin: string }[];
  workerAlive: boolean;
  workerLastBeatAt: string | null;
  demoMode: boolean;
}

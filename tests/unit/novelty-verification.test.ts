import { describe, expect, it } from "vitest";
import { assignRole, decideNovelty, type CandidateEvent, type NoveltyItem } from "@/server/pipeline/novelty";
import { attributionOf, independenceKey } from "@/server/pipeline/independence";
import { deriveLifecycle, deriveVerification, type EvidenceItem, type VerificationInput } from "@/server/pipeline/verification";
import { contentHash, textSimilarity } from "@/server/lib/text";

const now = new Date("2026-10-08T15:00:00Z");
const noSignals = { hedged: false, opinion: false, firstHand: false, correction: false, denial: false };

function candidate(overrides: Partial<CandidateEvent> = {}): CandidateEvent {
  return {
    id: "ev1",
    signature: "orbix systems is in advanced talks to acquire halcyon semiconductor sources say",
    entityKeys: ["asset:ORBX", "asset:HLCN", "org:halcyon semiconductor"],
    categories: ["corporate_transaction", "rumor"],
    lastActivityAt: now,
    firstSeenAt: now,
    contentHashes: new Set(),
    independenceKeys: new Set(["acct:origin"]),
    isDemo: false,
    ...overrides,
  };
}

function item(text: string, overrides: Partial<NoveltyItem> = {}): NoveltyItem {
  return {
    text,
    contentHash: contentHash(text),
    entityKeys: ["asset:ORBX", "asset:HLCN"],
    categories: ["corporate_transaction"],
    publishedAt: now,
    collectedAt: now,
    signals: noSignals,
    isDemo: false,
    ...overrides,
  };
}

describe("text similarity", () => {
  it("is high for rewordings and low for unrelated text", () => {
    const a = "Orbix Systems is in advanced talks to acquire Halcyon Semiconductor, sources say";
    expect(textSimilarity(a, "Sources say Orbix Systems in advanced talks to acquire Halcyon Semiconductor")).toBeGreaterThan(0.6);
    expect(textSimilarity(a, "Oil prices fell after OPEC raised output")).toBeLessThan(0.1);
  });
  it("normalizes content hashes (case, URLs, punctuation)", () => {
    expect(contentHash("Hello, WORLD https://t.co/x")).toBe(contentHash("hello world"));
  });
});

describe("novelty detection", () => {
  it("detects exact duplicates", () => {
    const text = "Orbix to acquire Halcyon";
    const d = decideNovelty(item(text), [candidate({ contentHashes: new Set([contentHash(text)]) })]);
    expect(d.hint).toBe("exact_duplicate");
  });
  it("clusters reworded repetitions into the same event", () => {
    const d = decideNovelty(item("Orbix Systems reportedly in advanced talks to acquire Halcyon Semiconductor, according to sources"), [candidate()]);
    expect(d.hint).toBe("same_claim");
    expect(d.eventId).toBe("ev1");
  });
  it("detects contradictions and corrections about the same entities", () => {
    expect(decideNovelty(item("Halcyon is not in discussions regarding a sale to Orbix", { signals: { ...noSignals, denial: true } }), [candidate()]).hint).toBe("contradiction");
    expect(decideNovelty(item("Correction: the Orbix Halcyon report misstated the deal value", { signals: { ...noSignals, correction: true } }), [candidate()]).hint).toBe("correction");
  });
  it("treats unrelated news as a new event", () => {
    expect(decideNovelty(item("EIA reports a large crude inventory draw", { entityKeys: ["asset:WTI"], categories: ["commodity"] }), [candidate()]).hint).toBe("new");
  });
  it("never mixes demo and live data", () => {
    expect(decideNovelty(item("Orbix Systems in advanced talks to acquire Halcyon Semiconductor"), [candidate({ isDemo: true })]).hint).toBe("new");
  });
  it("flags old information resurfacing", () => {
    const d = decideNovelty(item("Something", { publishedAt: new Date(now.getTime() - 3 * 86_400_000) }), []);
    expect(d.resurfaced).toBe(true);
  });
});

describe("evidence roles", () => {
  const base = {
    hint: "same_claim" as const,
    sourceCategory: "news_org" as const,
    isPrimary: false,
    isAuthoritativeForEvent: false,
    independenceKey: "org:wire",
    eventIndependenceKeys: new Set(["acct:origin"]),
    commentaryOnly: false,
    isOpinion: false,
    isRepostOrQuote: false,
  };
  it("counts a reputable, independent report as corroboration", () => expect(assignRole(base)).toBe("corroboration"));
  it("does not count reposts, same-origin items or unregistered accounts", () => {
    expect(assignRole({ ...base, isRepostOrQuote: true })).toBe("repeat");
    expect(assignRole({ ...base, independenceKey: "acct:origin" })).toBe("repeat");
    expect(assignRole({ ...base, sourceCategory: "unknown" })).toBe("repeat");
  });
  it("marks opinion as commentary, not evidence", () => expect(assignRole({ ...base, isOpinion: true })).toBe("commentary"));
  it("marks the authoritative issuer as primary source", () => expect(assignRole({ ...base, isPrimary: true, isAuthoritativeForEvent: true })).toBe("primary_source"));
});

describe("independence", () => {
  const lookups = { referencedKey: (_p: string, id: string) => (id === "100" ? "acct:origin" : null), handleOrganization: (h: string) => (h === "reuters" ? "Reuters" : null) };
  it("reposts inherit the referenced origin", () => {
    expect(independenceKey({ provider: "x", authorHandle: "echo", sourceOrganization: null, text: "RT", referenced: [{ type: "retweeted", id: "100" }] }, lookups)).toBe("acct:origin");
  });
  it("attributions map to the attributed origin", () => {
    expect(attributionOf("Big news, according to Reuters")).toEqual({ kind: "org", name: "reuters" });
    expect(independenceKey({ provider: "x", authorHandle: "a", sourceOrganization: null, text: "via @Reuters", referenced: [] }, lookups)).toBe("org:reuters");
    expect(independenceKey({ provider: "x", authorHandle: "a", sourceOrganization: null, text: "Per WSJ, deal near", referenced: [] }, lookups)).toBe("org:dow jones");
  });
  it("accounts of the same organisation share a key", () => {
    const k1 = independenceKey({ provider: "x", authorHandle: "ledger", sourceOrganization: "Ledger Daily", text: "x", referenced: [] }, lookups);
    const k2 = independenceKey({ provider: "x", authorHandle: "reporter", sourceOrganization: "Ledger Daily", text: "y", referenced: [] }, lookups);
    expect(k1).toBe(k2);
  });
  it("ordinary 'via' phrases are not attributions", () => {
    expect(attributionOf("Shipped via satellite link")).toBeNull();
  });
});

describe("verification state machine", () => {
  const ev = (o: Partial<EvidenceItem>): EvidenceItem => ({
    role: "origin",
    independenceKey: "acct:origin",
    sourceCategory: "market_commentator",
    isPrimary: false,
    authorityDomains: [],
    similarityToOrigin: null,
    sameSourceAsOrigin: true,
    ...o,
  });
  const input = (o: Partial<VerificationInput>): VerificationInput => ({
    eventCategories: ["corporate_transaction", "rumor"],
    items: [ev({})],
    unresolvedContradictions: [],
    originSourceQuality: 30,
    lastActivityAt: now,
    now,
    staleAfterHours: 24,
    lastAttemptFailed: false,
    resurfaced: false,
    ...o,
  });

  it("a single unverified claim stays unverified", () => {
    expect(deriveVerification(input({})).status).toBe("unverified");
  });

  it("100 repeats of one rumor are never confirmation", () => {
    const repeats = Array.from({ length: 100 }, (_, i) => ev({ role: "repeat", independenceKey: `acct:echo${i}`, sourceCategory: "unknown", sameSourceAsOrigin: false }));
    const r = deriveVerification(input({ items: [ev({}), ...repeats] }));
    expect(r.status).toBe("unverified");
    expect(r.independentCount).toBe(0);
    expect(r.independentGroups).toBe(1);
    expect(r.sourceCount).toBe(101);
  });

  it("two independent reputable sources → independently corroborated", () => {
    const r = deriveVerification(
      input({ items: [ev({ sourceCategory: "news_org", independenceKey: "org:a" }), ev({ role: "corroboration", sourceCategory: "news_org", independenceKey: "org:b", sameSourceAsOrigin: false })] }),
    );
    expect(r.status).toBe("independently_corroborated");
  });

  it("an authoritative issuer matching the claim → confirmed", () => {
    const r = deriveVerification(
      input({
        items: [ev({}), ev({ role: "primary_source", isPrimary: true, authorityDomains: ["corporate_transaction"], sourceCategory: "company", similarityToOrigin: 0.6, sameSourceAsOrigin: false })],
      }),
    );
    expect(r.status).toBe("confirmed");
  });

  it("a weakly matched primary source → primary source located (not confirmed)", () => {
    const r = deriveVerification(
      input({ items: [ev({}), ev({ role: "update", isPrimary: true, authorityDomains: ["earnings"], sourceCategory: "company", similarityToOrigin: 0.1, sameSourceAsOrigin: false })] }),
    );
    expect(r.status).toBe("primary_source_located");
  });

  it("an authoritative denial → disputed", () => {
    const r = deriveVerification(input({ unresolvedContradictions: [{ fromAuthoritativePrimary: true, sourceQuality: 85 }] }));
    expect(r.status).toBe("disputed");
  });

  it("a low-quality contradiction does not meet the dispute threshold", () => {
    const r = deriveVerification(input({ originSourceQuality: 90, unresolvedContradictions: [{ fromAuthoritativePrimary: false, sourceQuality: 30 }] }));
    expect(r.status).toBe("unverified");
    expect(r.reasons.join(" ")).toMatch(/lower-quality/);
  });

  it("a correction from the originating source → corrected (takes precedence)", () => {
    const r = deriveVerification(
      input({ items: [ev({}), ev({ role: "correction", sameSourceAsOrigin: true })], unresolvedContradictions: [{ fromAuthoritativePrimary: true, sourceQuality: 85 }] }),
    );
    expect(r.status).toBe("corrected");
  });

  it("goes stale after the window without evidence", () => {
    expect(deriveVerification(input({ lastActivityAt: new Date(now.getTime() - 30 * 3_600_000) })).status).toBe("stale");
    expect(deriveVerification(input({ resurfaced: true })).status).toBe("stale");
  });

  it("reports unable_to_verify when authoritative sources are failing", () => {
    expect(deriveVerification(input({ lastAttemptFailed: true })).status).toBe("unable_to_verify");
  });

  it("derives lifecycle from verification", () => {
    expect(deriveLifecycle({ verification: "confirmed", itemCount: 1, firstSeenAt: now, now })).toBe("confirmed");
    expect(deriveLifecycle({ verification: "unverified", itemCount: 1, firstSeenAt: now, now })).toBe("new");
    expect(deriveLifecycle({ verification: "unverified", itemCount: 3, firstSeenAt: now, now })).toBe("developing");
    expect(deriveLifecycle({ verification: "disputed", itemCount: 3, firstSeenAt: now, now })).toBe("disputed");
  });
});

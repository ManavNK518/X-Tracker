import { describe, expect, it } from "vitest";
import {
  combineComponents,
  computeConfidence,
  computeImportance,
  detectMagnitudeTerms,
  INSTRUCTION_TEXT_CONFIDENCE_CAP,
  priorityBand,
  sourceQualityScore,
  type ConfidenceInput,
  type ImportanceInput,
} from "@/server/pipeline/scoring";
import { IMPORTANCE_WEIGHTS, CONFIDENCE_WEIGHTS } from "@/config/scoring";
import { bandFor } from "@/domain/priority";

const now = new Date("2026-10-08T15:00:00Z");

function importanceInput(overrides: Partial<ImportanceInput> = {}): ImportanceInput {
  return {
    categories: [{ category: "monetary_policy", score: 0.8 }],
    opinionOnly: false,
    magnitudeTerms: [],
    bestSource: { category: "central_bank", name: "Fed", isPrimary: true, authoritativeForEvent: true, reliability: null },
    novelty: "new",
    tracked: { universeSize: 5, direct: ["UST2Y"], indirect: [], categoryMatch: true },
    verification: "confirmed",
    publishedAt: new Date(now.getTime() - 5 * 60_000),
    now,
    ...overrides,
  };
}

function confidenceInput(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    origin: { registered: true, isPrimary: false, name: "Wire" },
    directness: "plain",
    authoritativeConfirmed: false,
    primaryLocated: false,
    independentCount: 1,
    evidenceItemCount: 1,
    unresolvedContradictions: 0,
    entityConfidences: [0.9],
    resurfaced: false,
    publishedAt: now,
    instructionLikeText: false,
    ...overrides,
  };
}

describe("weights", () => {
  it("importance and confidence weights each sum to 1", () => {
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(IMPORTANCE_WEIGHTS)).toBeCloseTo(1, 10);
    expect(sum(CONFIDENCE_WEIGHTS)).toBeCloseTo(1, 10);
  });
});

describe("combineComponents", () => {
  const comps = [
    { id: "a", label: "A", weight: 0.5, score: 80, explanation: "", evidence: [] },
    { id: "b", label: "B", weight: 0.5, score: null, explanation: "", evidence: [] },
  ];
  it("conservative policy scores unknown components as zero and reports coverage", () => {
    const r = combineComponents(comps, "conservative");
    expect(r.total).toBe(40);
    expect(r.coverage).toBe(0.5);
    expect(r.components[1].contribution).toBe(0);
  });
  it("neutral policy uses the neutral value", () => {
    expect(combineComponents(comps, "neutral", 50).total).toBe(65);
  });
  it("renormalize policy uses assessed components only", () => {
    expect(combineComponents(comps, "renormalize").total).toBe(80);
  });
  it("never assigns a perfect score to an unknown component", () => {
    const allUnknown = comps.map((c) => ({ ...c, score: null }));
    expect(combineComponents(allUnknown, "conservative").total).toBe(0);
    expect(combineComponents(allUnknown, "renormalize").total).toBe(0);
  });
});

describe("computeImportance", () => {
  it("computes the weighted total consistently from components", () => {
    const r = computeImportance(importanceInput());
    const manual = r.components.reduce((s, c) => s + c.contribution, 0);
    expect(r.total).toBe(Math.round(manual));
    expect(r.coverage).toBe(1);
    expect(r.components.map((c) => c.id)).toEqual(Object.keys(IMPORTANCE_WEIGHTS));
  });

  it("marks components unknown instead of guessing", () => {
    const r = computeImportance(
      importanceInput({
        bestSource: null,
        tracked: { universeSize: 0, direct: [], indirect: [], categoryMatch: false },
        publishedAt: null,
        verification: "unable_to_verify",
      }),
    );
    const unknown = r.components.filter((c) => c.score === null).map((c) => c.id);
    expect(unknown).toEqual(expect.arrayContaining(["source_quality", "tracked_relevance", "time_sensitivity", "verification"]));
    expect(r.coverage).toBeCloseTo(0.25 + 0.2, 5);
  });

  it("dampens opinion-only commentary", () => {
    const fact = computeImportance(importanceInput({ verification: "unverified" }));
    const opinion = computeImportance(importanceInput({ verification: "unverified", opinionOnly: true }));
    expect(opinion.total).toBeLessThan(fact.total);
  });

  it("a high-impact rumor keeps significance but scores low on verification", () => {
    const r = computeImportance(
      importanceInput({
        categories: [
          { category: "corporate_transaction", score: 0.6 },
          { category: "rumor", score: 0.5 },
        ],
        bestSource: { category: "market_commentator", name: "X", isPrimary: false, authoritativeForEvent: false, reliability: null },
        verification: "unverified",
      }),
    );
    expect(r.components.find((c) => c.id === "market_significance")!.score).toBe(70);
    expect(r.components.find((c) => c.id === "verification")!.score).toBe(25);
  });

  it("time sensitivity decays with age", () => {
    const fresh = computeImportance(importanceInput());
    const old = computeImportance(importanceInput({ publishedAt: new Date(now.getTime() - 3 * 86_400_000) }));
    expect(fresh.components.find((c) => c.id === "time_sensitivity")!.score).toBeGreaterThan(old.components.find((c) => c.id === "time_sensitivity")!.score!);
  });
});

describe("source quality", () => {
  it("does not assess unregistered accounts", () => {
    expect(sourceQualityScore({ category: "unknown", name: "anon", isPrimary: false, authoritativeForEvent: false, reliability: null }).score).toBeNull();
  });
  it("keeps reliability provisional below the observation threshold", () => {
    const base = sourceQualityScore({ category: "news_org", name: "Wire", isPrimary: false, authoritativeForEvent: false, reliability: { observations: 2, confirmedRate: 1 } });
    expect(base.score).toBe(70);
    expect(base.evidence.join(" ")).toMatch(/provisional/);
  });
  it("adjusts with enough evidence, bounded", () => {
    const good = sourceQualityScore({ category: "news_org", name: "Wire", isPrimary: false, authoritativeForEvent: false, reliability: { observations: 10, confirmedRate: 1 } });
    const bad = sourceQualityScore({ category: "news_org", name: "Wire", isPrimary: false, authoritativeForEvent: false, reliability: { observations: 10, confirmedRate: 0 } });
    expect(good.score).toBe(85);
    expect(bad.score).toBe(55);
  });
});

describe("computeConfidence", () => {
  it("is separate from importance: a high-impact rumor can have low confidence", () => {
    const c = computeConfidence(confidenceInput({ directness: "hedged", origin: { registered: false, isPrimary: false, name: "anon" } }));
    expect(c.total).toBeLessThan(40);
  });

  it("does not treat absence of contradiction as evidence when only one source exists", () => {
    const c = computeConfidence(confidenceInput());
    expect(c.components.find((x) => x.id === "contradictions")!.score).toBeNull();
    expect(c.components.find((x) => x.id === "consistency")!.score).toBeNull();
  });

  it("authoritative confirmation yields high confidence", () => {
    const c = computeConfidence(
      confidenceInput({ origin: { registered: true, isPrimary: true, name: "Fed" }, directness: "first_hand", authoritativeConfirmed: true, primaryLocated: true, evidenceItemCount: 2 }),
    );
    expect(c.total).toBeGreaterThanOrEqual(85);
  });

  it("an authoritative contradiction halves confidence and is explained", () => {
    const base = computeConfidence(confidenceInput({ evidenceItemCount: 1 }));
    const disputed = computeConfidence(confidenceInput({ unresolvedContradictions: 1, contradictionSeverity: "authoritative" }));
    expect(disputed.total).toBeLessThan(base.total);
    expect(disputed.components.some((c) => c.id === "contradiction_penalty")).toBe(true);
  });

  it("caps confidence when the text contains instructions aimed at AI systems", () => {
    const c = computeConfidence(
      confidenceInput({ origin: { registered: true, isPrimary: true, name: "X" }, directness: "first_hand", authoritativeConfirmed: true, instructionLikeText: true }),
    );
    expect(c.total).toBeLessThanOrEqual(INSTRUCTION_TEXT_CONFIDENCE_CAP);
  });
});

describe("bands", () => {
  it("maps scores to configurable priority bands", () => {
    expect(priorityBand(85).id).toBe("critical");
    expect(priorityBand(80).id).toBe("critical");
    expect(priorityBand(79).id).toBe("high");
    expect(priorityBand(40).id).toBe("moderate");
    expect(priorityBand(19).id).toBe("minimal");
    expect(bandFor(50, [{ id: "high", label: "H", min: 50 }, { id: "low", label: "L", min: 0 }]).id).toBe("high");
  });
  it("detects magnitude language", () => {
    expect(detectMagnitudeTerms("An unexpected, unscheduled emergency cut")).toEqual(expect.arrayContaining(["unexpected", "unscheduled", "emergency"]));
  });
});

import { EVENT_CATEGORIES } from "@/domain/categories";
import { getAsset } from "@/config/assets";
import { stripUrls } from "@/server/lib/text";
import { AiExtractionSchema, type ValidatedExtraction } from "./schema";

/**
 * Post-validation of model output against the *source text*. Even schema-valid
 * output is checked so the model cannot introduce unsupported data:
 *  - claims must quote the source verbatim (whitespace/case-insensitive match)
 *  - tickers must exist in the alias dictionary or appear literally in the text
 *  - URLs are stripped from generated text
 *  - lengths are capped
 * Minor problems are repaired (invalid array entries dropped, strings trimmed)
 * and reported as warnings; missing core fields cause rejection.
 */
export type ValidationOutcome =
  | { ok: true; value: ValidatedExtraction; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const cap = (s: string | null | undefined, n: number) => {
  if (s === null || s === undefined) return null;
  const clean = stripUrls(String(s)).replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
};

export function validateExtraction(raw: unknown, sourceText: string, includeDemo: boolean): ValidationOutcome {
  const warnings: string[] = [];
  const strict = AiExtractionSchema.safeParse(raw);
  let data: Record<string, unknown>;
  if (strict.success) {
    data = strict.data as unknown as Record<string, unknown>;
  } else {
    if (!raw || typeof raw !== "object") return { ok: false, error: "model output is not an object", warnings };
    data = raw as Record<string, unknown>;
    warnings.push(`schema repair needed: ${strict.error.issues.slice(0, 3).map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
  }

  const title = cap(typeof data.title === "string" ? data.title : null, 160);
  const summary = cap(typeof data.factual_summary === "string" ? data.factual_summary : null, 600);
  if (!title || !summary) return { ok: false, error: "missing title or factual_summary", warnings };

  const categoriesRaw = Array.isArray(data.categories) ? data.categories : [];
  const categories = categoriesRaw.filter((c): c is (typeof EVENT_CATEGORIES)[number] =>
    (EVENT_CATEGORIES as readonly string[]).includes(String(c)),
  );
  if (categories.length !== categoriesRaw.length) warnings.push("dropped unknown categories");
  if (categories.length === 0 && data.is_market_relevant !== false) {
    return { ok: false, error: "no valid categories", warnings };
  }

  const normalizedSource = squash(sourceText);
  const claims: ValidatedExtraction["claims"] = [];
  for (const c of Array.isArray(data.claims) ? data.claims : []) {
    const claim = c as Record<string, unknown>;
    const quote = typeof claim.evidence_quote === "string" ? claim.evidence_quote : "";
    const text = cap(typeof claim.claim === "string" ? claim.claim : null, 300);
    if (!text || quote.trim().length < 4) {
      warnings.push("dropped claim without usable evidence quote");
      continue;
    }
    if (!normalizedSource.includes(squash(quote))) {
      warnings.push(`dropped claim whose quote is not in the source: “${quote.slice(0, 60)}”`);
      continue;
    }
    const status = ["stated_by_source", "attributed_to_others", "speculative"].includes(String(claim.status))
      ? String(claim.status)
      : "speculative";
    claims.push({ claim: text, evidenceQuote: quote.trim().slice(0, 400), status });
  }

  const assets: ValidatedExtraction["assets"] = [];
  const upperSource = sourceText.toUpperCase();
  for (const a of Array.isArray(data.potentially_affected_assets) ? data.potentially_affected_assets : []) {
    const asset = a as Record<string, unknown>;
    const symbol = typeof asset.symbol === "string" ? asset.symbol.trim().toUpperCase().replace(/^\$/, "") : "";
    if (!symbol || symbol.length > 15) continue;
    const def = getAsset(symbol);
    const known = def && (includeDemo || !def.demo);
    const literal = new RegExp(`(^|[^A-Z0-9])\\$?${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9]|$)`).test(upperSource);
    if (!known && !literal) {
      warnings.push(`dropped asset not in dictionary or text: ${symbol}`);
      continue;
    }
    assets.push({ symbol, rationale: cap(typeof asset.rationale === "string" ? asset.rationale : "", 300) ?? "" });
  }

  const list = (v: unknown, n: number, max = 6) =>
    (Array.isArray(v) ? v : [])
      .map((x) => cap(typeof x === "string" ? x : null, n))
      .filter((x): x is string => Boolean(x))
      .slice(0, max);

  return {
    ok: true,
    warnings,
    value: {
      isMarketRelevant: data.is_market_relevant !== false,
      categories,
      title,
      factualSummary: summary,
      eventTimeAsStated: cap(typeof data.event_time_as_stated === "string" ? data.event_time_as_stated : null, 80),
      claims: claims.slice(0, 8),
      claimsRequiringVerification: list(data.claims_requiring_verification, 240),
      assets: assets.slice(0, 10),
      transmissionMechanism: cap(typeof data.transmission_mechanism === "string" ? data.transmission_mechanism : null, 500),
      bullishInterpretation: cap(typeof data.bullish_interpretation === "string" ? data.bullish_interpretation : null, 400),
      bearishInterpretation: cap(typeof data.bearish_interpretation === "string" ? data.bearish_interpretation : null, 400),
      keyUncertainties: list(data.key_uncertainties, 240),
      suggestedFollowUp: list(data.suggested_follow_up, 240),
      containsInstructionsToAi: data.contains_instructions_to_ai === true,
    },
  };
}

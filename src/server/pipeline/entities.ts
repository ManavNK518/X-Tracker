import type { AssetClass, AssetDef } from "@/config/assets";

/**
 * Entity resolution against the alias dictionary.
 *
 * Disambiguation rules:
 *  - Cashtags ($NVDA) match with high confidence.
 *  - Bare upper-case tickers match only for symbols not marked `cashtag_only`
 *    (tickers such as ON, F, T, MS collide with ordinary words).
 *  - Company aliases match on word boundaries. Single-word aliases for
 *    equities must appear capitalised ("Apple", not "apple pie").
 *  - When nothing matches confidently, no asset is returned ("unknown").
 */
export interface EntityMatch {
  symbol: string;
  name: string;
  assetClass: AssetClass | null;
  confidence: number;
  matchedText: string;
  method: "cashtag" | "ticker" | "alias" | "custom";
}

export interface EntityResult {
  assets: EntityMatch[];
  /** Ambiguous tickers that were seen but not matched (shown for transparency). */
  ignoredAmbiguous: { symbol: string; matchedText: string; reason: string }[];
  /** Keys used for clustering: asset symbols plus proper-noun organisation phrases. */
  entityKeys: string[];
}

export interface CustomAsset {
  symbol: string;
  name: string;
  aliases: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const URL_RE = /https?:\/\/\S+/g;

interface CompiledAsset {
  def: AssetDef;
  aliasRes: { re: RegExp; alias: string; requireCapital: boolean; multiWord: boolean }[];
}

const compiledCache = new WeakMap<AssetDef[], CompiledAsset[]>();

function compile(assets: AssetDef[]): CompiledAsset[] {
  const cached = compiledCache.get(assets);
  if (cached) return cached;
  const compiled = assets.map((def) => ({
    def,
    aliasRes: def.aliases.map((alias) => {
      const multiWord = /[\s\-&.]/.test(alias.trim());
      return {
        re: new RegExp(`(?<![\\p{L}\\p{N}$])${escapeRe(alias)}(?![\\p{L}\\p{N}])`, "iu"),
        alias,
        requireCapital: !multiWord && (def.assetClass === "equity" || def.assetClass === "etf"),
        multiWord,
      };
    }),
  }));
  compiledCache.set(assets, compiled);
  return compiled;
}

const STOP_PHRASES = new Set(["the", "a", "an", "this", "that", "our", "we", "in", "on", "at", "for", "per", "from", "demo", "correction", "update", "breaking"]);

/** Extracts capitalised multi-word phrases ("Kestrel Foundry", "Northbridge Central Bank"). */
export function properNounPhrases(text: string): string[] {
  const out = new Set<string>();
  const re = /\b([A-Z][a-z]+(?:[ -](?:[A-Z][a-z]+|of|and|&)){1,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const words = m[1].split(/[ -]/).filter((w) => !["of", "and", "&"].includes(w));
    while (words.length && STOP_PHRASES.has(words[0].toLowerCase())) words.shift();
    if (words.length >= 2) out.add(words.join(" ").toLowerCase());
  }
  return [...out];
}

export function extractEntities(rawText: string, assets: AssetDef[], customAssets: CustomAsset[] = []): EntityResult {
  const text = rawText.replace(URL_RE, " ");
  const found = new Map<string, EntityMatch>();
  const ignoredAmbiguous: EntityResult["ignoredAmbiguous"] = [];
  const bySymbol = new Map(assets.map((a) => [a.symbol.toUpperCase(), a]));
  const add = (m: EntityMatch) => {
    const prev = found.get(m.symbol);
    if (!prev || prev.confidence < m.confidence) found.set(m.symbol, m);
  };

  // 1) Cashtags. A cashtag must start with a letter, so "$2.41" is not a ticker.
  const cashtagRe = /\$([A-Za-z][A-Za-z0-9]{0,9}(?:\.[A-Za-z]{1,5})?)(?![A-Za-z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = cashtagRe.exec(text))) {
    const sym = m[1].toUpperCase();
    const def = bySymbol.get(sym);
    if (def) add({ symbol: def.symbol, name: def.name, assetClass: def.assetClass, confidence: 0.95, matchedText: m[0], method: "cashtag" });
  }

  // 2) Bare upper-case tickers (case-sensitive).
  const tickerRe = /(?<![$\p{L}\p{N}])([A-Z]{2,6}(?:\.[A-Z]{1,5})?)(?![\p{L}\p{N}])/gu;
  while ((m = tickerRe.exec(text))) {
    const sym = m[1];
    const def = bySymbol.get(sym);
    if (!def || found.has(def.symbol)) continue;
    const mode = def.tickerMatch ?? "cashtag_or_upper";
    if (mode === "cashtag_or_upper") {
      add({ symbol: def.symbol, name: def.name, assetClass: def.assetClass, confidence: sym.length <= 2 ? 0.6 : 0.7, matchedText: sym, method: "ticker" });
    } else if (mode === "cashtag_only") {
      ignoredAmbiguous.push({ symbol: def.symbol, matchedText: sym, reason: "ticker overlaps an ordinary word/abbreviation; requires a cashtag or company name" });
    }
  }

  // 3) Company / instrument aliases.
  for (const { def, aliasRes } of compile(assets)) {
    for (const a of aliasRes) {
      const hit = a.re.exec(text);
      if (!hit) continue;
      if (a.requireCapital && !/^\p{Lu}/u.test(hit[0])) continue;
      add({
        symbol: def.symbol,
        name: def.name,
        assetClass: def.assetClass,
        confidence: a.multiWord ? 0.85 : 0.75,
        matchedText: hit[0],
        method: "alias",
      });
      break;
    }
  }

  // 4) User-defined watchlist assets (not in the dictionary): lower confidence.
  for (const custom of customAssets) {
    const sym = custom.symbol.toUpperCase();
    if (found.has(sym) || bySymbol.has(sym)) continue;
    const cashtag = new RegExp(`\\$${escapeRe(sym)}(?![A-Za-z0-9])`, "i").exec(text);
    const aliasHit = custom.aliases
      .filter((al) => al.trim().length >= 3)
      .map((al) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(al)}(?![\\p{L}\\p{N}])`, "iu").exec(text))
      .find(Boolean);
    if (cashtag || aliasHit) {
      add({ symbol: sym, name: custom.name, assetClass: null, confidence: cashtag ? 0.8 : 0.6, matchedText: (cashtag ?? aliasHit)![0], method: "custom" });
    }
  }

  // Ambiguous tickers are only "ignored" if they were not matched another way.
  const ignored = ignoredAmbiguous.filter((i) => !found.has(i.symbol));
  const assetsOut = [...found.values()].sort((a, b) => b.confidence - a.confidence);
  const entityKeys = [...new Set([...assetsOut.map((a) => `asset:${a.symbol}`), ...properNounPhrases(text).map((p) => `org:${p}`)])];
  return { assets: assetsOut, ignoredAmbiguous: ignored, entityKeys };
}

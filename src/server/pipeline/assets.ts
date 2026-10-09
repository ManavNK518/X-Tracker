import { getAsset, type AssetDef } from "@/config/assets";
import { CATEGORY_TRANSMISSION } from "@/config/transmission";
import type { EventCategory } from "@/domain/categories";
import type { AssetRelation } from "@/domain/misc";
import type { EntityMatch } from "./entities";

/**
 * Stage 5 — asset mapping. Produces *possible* relationships with an explicit
 * relation type, confidence and rationale. Mapping never asserts a direction
 * or magnitude of price reaction. If nothing can be identified confidently the
 * list is empty and the UI reports "unknown".
 */
export interface MappedAsset {
  symbol: string;
  name: string;
  assetClass: string | null;
  relation: AssetRelation;
  confidence: number;
  rationale: string;
  matchedText: string | null;
  method: "rules" | "mapping" | "ai";
}

/** Categories where effects plausibly propagate to related companies. */
const PROPAGATING: ReadonlySet<EventCategory> = new Set([
  "earnings",
  "guidance",
  "supply_chain",
  "corporate_transaction",
  "regulatory",
  "product_launch",
  "industry",
]);

const RELATION_TEXT: Record<AssetRelation, string> = {
  direct: "named directly",
  peer: "peer/competitor",
  supplier: "supplier",
  customer: "customer",
  macro: "macro transmission",
  sector: "sector exposure",
};

export function mapAssets(input: {
  entities: EntityMatch[];
  categories: EventCategory[];
  text: string;
  includeDemo: boolean;
  maxRelated?: number;
}): MappedAsset[] {
  const out = new Map<string, MappedAsset>();
  const add = (a: MappedAsset) => {
    const prev = out.get(a.symbol);
    if (!prev || prev.confidence < a.confidence) out.set(a.symbol, a);
  };
  const usable = (def: AssetDef | undefined): def is AssetDef => Boolean(def && (input.includeDemo || !def.demo));

  for (const e of input.entities) {
    add({
      symbol: e.symbol,
      name: e.name,
      assetClass: e.assetClass,
      relation: "direct",
      confidence: e.confidence,
      rationale: `Named in the source text (${e.method === "cashtag" ? "cashtag" : e.method === "ticker" ? "ticker" : "name"} “${e.matchedText}”).`,
      matchedText: e.matchedText,
      method: "rules",
    });
  }

  if (input.categories.some((c) => PROPAGATING.has(c))) {
    let added = 0;
    const maxRelated = input.maxRelated ?? 6;
    for (const e of input.entities) {
      const def = getAsset(e.symbol);
      for (const rel of def?.related ?? []) {
        if (added >= maxRelated) break;
        if (out.has(rel.symbol)) continue;
        const relDef = getAsset(rel.symbol);
        if (!usable(relDef)) continue;
        add({
          symbol: relDef.symbol,
          name: relDef.name,
          assetClass: relDef.assetClass,
          relation: rel.relation,
          confidence: Number((Math.min(0.4, e.confidence * 0.4)).toFixed(2)),
          rationale: `Listed as a ${RELATION_TEXT[rel.relation]} of ${e.name} in the relationship map. Possible exposure only; not assessed from the event.`,
          matchedText: null,
          method: "mapping",
        });
        added++;
      }
    }
  }

  for (const category of input.categories) {
    for (const rule of CATEGORY_TRANSMISSION[category] ?? []) {
      if (rule.when && rule.when.length > 0 && !rule.when.some((re) => re.test(input.text))) continue;
      for (const a of rule.assets) {
        const def = getAsset(a.symbol);
        if (!usable(def) || out.has(def.symbol)) continue;
        add({
          symbol: def.symbol,
          name: def.name,
          assetClass: def.assetClass,
          relation: def.assetClass === "etf" ? "sector" : "macro",
          confidence: a.confidence,
          rationale: rule.mechanism,
          matchedText: null,
          method: "mapping",
        });
      }
    }
  }

  return [...out.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 15);
}

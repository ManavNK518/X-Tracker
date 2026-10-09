import type { EventCategory } from "@/domain/categories";

/**
 * Configurable macro / category transmission map. These are *possible*
 * channels through which a category of event could matter. They are shown as
 * hypotheses with low mapping confidence, never as predicted price reactions.
 */
export interface TransmissionRule {
  /** Only applies if one of these patterns matches the text (case-insensitive). Empty = always. */
  when?: RegExp[];
  assets: { symbol: string; confidence: number }[];
  mechanism: string;
}

export const CATEGORY_TRANSMISSION: Partial<Record<EventCategory, TransmissionRule[]>> = {
  monetary_policy: [
    {
      when: [/\b(fed|fomc|federal reserve|powell)\b/i],
      assets: [
        { symbol: "FEDFUNDS", confidence: 0.6 },
        { symbol: "UST2Y", confidence: 0.55 },
        { symbol: "UST10Y", confidence: 0.45 },
        { symbol: "DXY", confidence: 0.4 },
        { symbol: "SPX", confidence: 0.35 },
        { symbol: "NDX", confidence: 0.3 },
        { symbol: "BTC", confidence: 0.2 },
      ],
      mechanism:
        "Central-bank communication can reprice expected policy rates, which may transmit to front-end Treasury yields, the dollar, equity discount rates and other risk assets.",
    },
    {
      when: [/\b(ecb|european central bank|lagarde)\b/i],
      assets: [{ symbol: "EURUSD", confidence: 0.5 }],
      mechanism: "ECB policy expectations may affect euro-area rates and EUR/USD.",
    },
    {
      when: [/\b(bank of england|boe\b|bailey)\b/i],
      assets: [{ symbol: "GBPUSD", confidence: 0.5 }],
      mechanism: "Bank of England policy expectations may affect gilt yields and sterling.",
    },
    {
      when: [/\b(bank of japan|boj\b|ueda)\b/i],
      assets: [{ symbol: "USDJPY", confidence: 0.5 }],
      mechanism: "Bank of Japan policy expectations may affect JGB yields and the yen.",
    },
    {
      when: [/\bnorthbridge central bank\b/i],
      assets: [
        { symbol: "DLD10Y.DEMO", confidence: 0.5 },
        { symbol: "DLDX.DEMO", confidence: 0.4 },
      ],
      mechanism: "(Demo) Fictional central-bank guidance may reprice fictional Demoland yields and currency.",
    },
  ],
  economic_data: [
    {
      when: [/\b(cpi|inflation|pce|ppi|payrolls|jobs report|unemployment|gdp|retail sales|jobless claims)\b/i],
      assets: [
        { symbol: "UST2Y", confidence: 0.45 },
        { symbol: "UST10Y", confidence: 0.4 },
        { symbol: "FEDFUNDS", confidence: 0.4 },
        { symbol: "DXY", confidence: 0.3 },
        { symbol: "SPX", confidence: 0.3 },
      ],
      mechanism:
        "Major US data releases can shift growth and inflation expectations and therefore expected policy rates, Treasury yields, the dollar and equity indices.",
    },
  ],
  commodity: [
    {
      when: [/\b(oil|crude|opec|barrels?|wti|brent)\b/i],
      assets: [
        { symbol: "WTI", confidence: 0.55 },
        { symbol: "BRENT", confidence: 0.5 },
        { symbol: "XLE", confidence: 0.3 },
      ],
      mechanism: "Oil supply/demand news may affect crude benchmarks and energy-sector equities.",
    },
    {
      when: [/\b(natural gas|lng|henry hub)\b/i],
      assets: [{ symbol: "NATGAS", confidence: 0.55 }],
      mechanism: "Gas supply/demand news may affect natural gas prices.",
    },
    {
      when: [/\b(gold|bullion)\b/i],
      assets: [{ symbol: "GOLD", confidence: 0.5 }],
      mechanism: "Gold supply/demand or safe-haven flows may affect gold prices.",
    },
    {
      when: [/\bcopper\b/i],
      assets: [{ symbol: "COPPER", confidence: 0.5 }],
      mechanism: "Copper supply/demand news may affect copper prices and related producers.",
    },
    {
      when: [/\b(wheat|grain)\b/i],
      assets: [{ symbol: "WHEAT", confidence: 0.5 }],
      mechanism: "Grain supply news may affect wheat futures.",
    },
  ],
  digital_asset: [
    {
      when: [/\b(crypto|bitcoin|btc|stablecoin|digital assets?)\b/i],
      assets: [
        { symbol: "BTC", confidence: 0.4 },
        { symbol: "ETH", confidence: 0.3 },
        { symbol: "COIN", confidence: 0.25 },
      ],
      mechanism: "Broad digital-asset developments may affect major tokens and listed crypto-exposed companies.",
    },
  ],
  geopolitics: [
    {
      when: [/\b(middle east|strait of hormuz|opec|oil|pipeline|refinery)\b/i],
      assets: [
        { symbol: "WTI", confidence: 0.35 },
        { symbol: "BRENT", confidence: 0.35 },
        { symbol: "GOLD", confidence: 0.25 },
      ],
      mechanism: "Geopolitical risk in energy-producing regions may affect oil supply expectations and safe-haven demand.",
    },
    {
      when: [],
      assets: [
        { symbol: "GOLD", confidence: 0.2 },
        { symbol: "VIX", confidence: 0.2 },
      ],
      mechanism: "Geopolitical shocks can affect risk appetite and safe-haven demand; the size and direction are highly uncertain.",
    },
  ],
  supply_chain: [
    {
      when: [/\b(chip|semiconductor|wafer|fab|foundry|hbm|memory)\b/i],
      assets: [{ symbol: "SOXX", confidence: 0.3 }],
      mechanism: "Semiconductor supply disruptions may affect chip producers, their suppliers and downstream customers.",
    },
  ],
  regulatory: [
    {
      when: [/\b(export controls?|chip exports?)\b/i],
      assets: [{ symbol: "SOXX", confidence: 0.35 }],
      mechanism: "Export-control changes may affect revenue exposure of semiconductor companies to restricted markets.",
    },
    {
      when: [/\b(crypto|stablecoin|digital asset|bitcoin)\b/i],
      assets: [{ symbol: "BTC", confidence: 0.3 }, { symbol: "COIN", confidence: 0.3 }],
      mechanism: "Digital-asset regulation may affect market structure, exchange operations and token demand.",
    },
  ],
};

/**
 * Deterministic research prompts by category: what could make an event
 * important, and what would make it less important than it first appears.
 */
export const CATEGORY_RESEARCH_PROMPTS: Partial<
  Record<EventCategory, { importanceDrivers: string[]; importanceReducers: string[]; evidenceToSeek: string[] }>
> = {
  monetary_policy: {
    importanceDrivers: [
      "A change in the policy rate, balance-sheet plan or forward guidance that differs from prior communication.",
      "Language changes in the statement relative to the previous meeting.",
    ],
    importanceReducers: [
      "The decision matches prior guidance and widely published expectations.",
      "The statement is a scheduled reiteration with no change in language.",
    ],
    evidenceToSeek: ["The full official statement on the central bank's website", "The prior statement for a wording comparison", "Officials' subsequent remarks"],
  },
  economic_data: {
    importanceDrivers: ["A material deviation from the prior release or from published consensus.", "Revisions to prior periods."],
    importanceReducers: ["The figure is in line with consensus.", "The release is a minor or secondary series."],
    evidenceToSeek: ["The official release tables from the statistical agency", "Revisions to prior months", "Methodology notes"],
  },
  earnings: {
    importanceDrivers: ["Results or margins that differ materially from prior guidance.", "Changes in segment trends that affect the investment narrative."],
    importanceReducers: ["Results were pre-announced.", "One-off items explain the difference."],
    evidenceToSeek: ["The company's earnings release or 8-K/6-K filing", "The earnings call transcript", "Guidance changes"],
  },
  guidance: {
    importanceDrivers: ["A revision to full-year guidance, especially outside the prior range.", "Withdrawal of guidance."],
    importanceReducers: ["The revision is within the previously stated range.", "The change reflects currency or accounting effects only."],
    evidenceToSeek: ["The official company release or filing", "Prior guidance for comparison"],
  },
  corporate_transaction: {
    importanceDrivers: ["A definitive agreement with stated terms.", "Deal size that is large relative to the companies involved."],
    importanceReducers: ["Talks are preliminary or unconfirmed.", "Regulatory approval is uncertain or the deal is small."],
    evidenceToSeek: ["Official announcements from both parties", "SEC filings (8-K, S-4, SC TO)", "Regulatory filing requirements"],
  },
  regulatory: {
    importanceDrivers: ["A final rule or enforcement action with direct revenue or cost effects.", "Effective dates that are near-term."],
    importanceReducers: ["The proposal is early-stage or open for comment.", "Exposure of the named companies is small."],
    evidenceToSeek: ["The regulator's official release and rule text", "Company disclosures about exposure"],
  },
  legal: {
    importanceDrivers: ["A final ruling with damages, injunctions or remedies.", "Precedent affecting an industry."],
    importanceReducers: ["The ruling is appealable and stayed.", "Amounts are immaterial relative to company size."],
    evidenceToSeek: ["Court documents / docket", "Company statements"],
  },
  supply_chain: {
    importanceDrivers: ["Disruption of a concentrated, hard-to-replace supply node.", "Long expected duration."],
    importanceReducers: ["Inventory buffers or alternative capacity exist.", "Disruption is short or partial."],
    evidenceToSeek: ["Company or operator statements", "Independent reporting on duration and scope"],
  },
  commodity: {
    importanceDrivers: ["A supply change that is large relative to global balances."],
    importanceReducers: ["Spare capacity or inventories can offset the change."],
    evidenceToSeek: ["Official agency data (e.g. EIA, OPEC statements)", "Inventory data"],
  },
  digital_asset: {
    importanceDrivers: ["Protocol changes affecting security or supply.", "Exchange solvency or custody issues.", "Regulatory decisions affecting market access."],
    importanceReducers: ["The change was long scheduled and widely communicated."],
    evidenceToSeek: ["Official protocol/foundation announcements", "Exchange status pages", "Regulator releases"],
  },
  geopolitics: {
    importanceDrivers: ["Direct effects on energy supply, trade routes or sanctions."],
    importanceReducers: ["Events are rhetorical without operational change."],
    evidenceToSeek: ["Official government statements", "Multiple independent reputable news reports"],
  },
  leadership: {
    importanceDrivers: ["Unexpected departure of a CEO/CFO, especially with no successor named."],
    importanceReducers: ["Planned succession previously announced."],
    evidenceToSeek: ["Company release or 8-K Item 5.02 filing"],
  },
  rumor: {
    importanceDrivers: ["Subsequent confirmation from the parties involved or a filing."],
    importanceReducers: ["Denial from a party involved.", "The claim originates from a single unverified account and is only being repeated."],
    evidenceToSeek: ["Statements from the named parties", "Independent reporting with named sourcing", "Regulatory filings"],
  },
  analyst_commentary: {
    importanceDrivers: ["New information in the analysis beyond a rating change."],
    importanceReducers: ["Rating/target changes without new information are opinion, not events."],
    evidenceToSeek: ["The underlying data or company disclosures the analyst relies on"],
  },
};

export const GENERIC_RESEARCH_PROMPTS = {
  importanceDrivers: ["Independent confirmation from a primary source.", "Clear, material effects on named companies or assets."],
  importanceReducers: ["The information was already public.", "Only one unverified source reports it."],
  evidenceToSeek: ["The original primary source", "Independent reputable reporting"],
};

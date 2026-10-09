import type { EventCategory } from "@/domain/categories";

/**
 * Rules-based classification baseline. Each pattern contributes `weight`
 * (capped per category at 1.0). A category is assigned when its score reaches
 * CLASSIFICATION_THRESHOLD. Patterns are case-insensitive unless `caseSensitive`.
 *
 * This deterministic baseline always runs; optional AI analysis can refine it
 * but never replaces it silently.
 */
export interface CategoryPattern {
  pattern: RegExp;
  weight: number;
  label: string;
}

export const CLASSIFICATION_THRESHOLD = 0.35;
export const RULES_VERSION = "rules-2026-10-08.1";

const p = (pattern: RegExp, weight: number, label?: string): CategoryPattern => ({
  pattern,
  weight,
  label: label ?? pattern.source.replace(/\\b|\\/g, "").slice(0, 60),
});

export const CATEGORY_PATTERNS: Record<EventCategory, CategoryPattern[]> = {
  monetary_policy: [
    p(/\b(fomc|federal open market committee)\b/i, 0.6, "FOMC"),
    // The institution name alone is not a monetary-policy signal (the Fed also
    // publishes supervision/enforcement news); it needs a policy term too.
    p(/\b(federal reserve|the fed)\b/i, 0.2, "Federal Reserve"),
    p(/\b(rate (cut|hike|increase|decrease|decision)s?|cuts? rates|raises? rates|holds? (rates|the policy rate)|kept rates)\b/i, 0.5, "rate decision"),
    p(/\b(policy rate|federal funds|funds rate|basis points?|\d+\s?bps?)\b/i, 0.35, "policy rate / bps"),
    p(/\b(monetary policy|forward guidance|dot plot|quantitative (easing|tightening)|balance sheet runoff)\b/i, 0.45, "monetary policy terms"),
    p(/\b(ecb|european central bank|bank of england|bank of japan|boj|pboc|people's bank of china|bank of canada|central bank)\b/i, 0.25, "central bank"),
    p(/\b(interest rates?|inflation target|monetary (policy )?committee|governing council|policy statement|economic projections|minutes of the)\b/i, 0.3, "policy communication"),
    p(/\b(powell|lagarde|ueda|bailey|macklem)\b/i, 0.25, "central bank official"),
  ],
  economic_data: [
    p(/\b(cpi|consumer price index|pce|ppi|producer price)\b/i, 0.55, "inflation release"),
    p(/\b(nonfarm payrolls?|payrolls|jobs report|unemployment rate|jobless claims|jolts)\b/i, 0.55, "labor data"),
    p(/\b(gdp|gross domestic product|retail sales|industrial production|durable goods|housing starts|trade balance|personal income)\b/i, 0.5, "macro release"),
    p(/\b(ism|pmi|purchasing managers)\b/i, 0.4, "survey data"),
    p(/\b(inflation|economy (grew|contracted)|annualized rate|seasonally adjusted|month-over-month|year-over-year)\b/i, 0.25, "macro terms"),
  ],
  earnings: [
    p(/\b(quarterly (results|earnings)|(q[1-4]|first|second|third|fourth)[- ]quarter (results|earnings|revenue))\b/i, 0.6, "quarterly results"),
    p(/\b(eps|earnings per share|net income|operating income|gross margin)\b/i, 0.4, "earnings metrics"),
    p(/\b(beat|missed?|tops?|exceeds?) (analyst |consensus |wall street )?(estimates|expectations|forecasts)\b/i, 0.45, "vs estimates"),
    p(/\b(reports?|reported|posts?|posted) (record )?(revenue|earnings|results|profit|loss)\b/i, 0.4, "reported results"),
  ],
  guidance: [
    p(/\b(raises?|raised|lowers?|lowered|cuts?|cut|withdraws?|withdrew|reaffirms?|reaffirmed|reiterates?) (its |full[- ]year |fy|annual |quarterly )?(guidance|outlook|forecast)\b/i, 0.65, "guidance change"),
    p(/\b(guidance|outlook)\b/i, 0.25, "guidance mention"),
    p(/\b(preannounce[sd]?|profit warning)\b/i, 0.5, "pre-announcement"),
  ],
  corporate_transaction: [
    p(/\b(acquires?|acquired|acquisition of|to acquire|agreed to buy|to buy)\b/i, 0.5, "acquisition"),
    p(/\b(merger|merge with|takeover|buyout|tender offer|definitive agreement)\b/i, 0.55, "merger / takeover"),
    p(/\b(in (advanced )?talks to (buy|acquire|merge)|exploring (a )?sale|strategic alternatives)\b/i, 0.45, "deal talks"),
    p(/\b(spin[- ]?off|divest(s|ed|iture)?|stake in|ipo|initial public offering|files? for (an )?ipo)\b/i, 0.45, "capital markets transaction"),
    p(/\b(share (buyback|repurchase)|buyback program)\b/i, 0.4, "buyback"),
  ],
  regulatory: [
    p(/\b(SEC|CFTC|FTC|FDA|FCC|DOJ|OCC|FDIC|EPA)\b/, 0.4, "regulator (acronym)"),
    p(/\b(securities and exchange commission|commodity futures trading commission|federal trade commission|food and drug administration)\b/i, 0.45, "regulator"),
    p(/\b(final rule|proposed rule|rulemaking|regulat(ion|ory|or)s?|antitrust|enforcement action|consent order)\b/i, 0.4, "regulatory action"),
    p(/\b(approves?|approved|approval|clears?|cleared|rejects?|rejected|bans?|banned)\b/i, 0.15, "approval / ban"),
    p(/\b(export controls?|sanctions? on|tariffs?|trade restrictions?)\b/i, 0.45, "trade restrictions"),
  ],
  legal: [
    p(/\b(lawsuit|sues|sued|class action|indict(ed|ment)|charged with|plea deal)\b/i, 0.5, "litigation"),
    p(/\b(court|judge|jury|verdict|ruling|ruled|injunction|appeals court|supreme court|settle(s|d|ment))\b/i, 0.35, "court"),
  ],
  product_launch: [
    p(/\b(launch(es|ed)?|unveil(s|ed)?|introduc(es|ed)|debuts?|general availability)\b/i, 0.4, "launch"),
    p(/\b(new (chip|model|product|platform|gpu|processor|drug|vehicle))\b/i, 0.3, "new product"),
  ],
  supply_chain: [
    p(/\b(supply chain|shortages?|production (is |was |has been )?(halt|halted|cut|disrupted|disruption|suspended|stopped)|(halts?|halted|suspend(s|ed)?|stop(s|ped)?) production|outage at|plant (fire|closure|shutdown)|factory (fire|shutdown))\b/i, 0.55, "supply disruption"),
    p(/\b(power outage|fire|flood(ing)?|earthquake|explosion)\b/i, 0.2, "physical disruption"),
    p(/\b(fab|foundry|wafer|capacity constraints?|lead times?|logistics|port (closure|strike)|shipping (disruption|delays))\b/i, 0.3, "supply chain terms"),
  ],
  industry: [
    p(/\b(industry|sector-wide|market share|hyperscalers?|data cent(er|re)s?|capex|capital expenditure)\b/i, 0.25, "industry terms"),
    p(/\b(ai (chips?|accelerators?|infrastructure|demand)|semiconductor (demand|sales|industry))\b/i, 0.35, "AI / semis industry"),
  ],
  commodity: [
    p(/\b(opec\+?|crude (oil|inventories|output)|oil (output|production|prices|supply)|barrels? per day|bpd)\b/i, 0.55, "oil"),
    p(/\b(natural gas|lng|henry hub)\b/i, 0.45, "natural gas"),
    p(/\b(gold|silver|copper|iron ore|lithium|uranium|wheat|corn|soybeans?)\b/i, 0.3, "commodity"),
    p(/\b(eia|inventor(y|ies) (draw|build))\b/i, 0.3, "inventory data"),
  ],
  digital_asset: [
    p(/\b(bitcoin|ethereum|solana|stablecoins?|crypto(currency|currencies)?|digital assets?)\b/i, 0.45, "digital asset"),
    p(/\b(hard fork|soft fork|mainnet|protocol upgrade|network upgrade|staking|validator|block height|at block)\b/i, 0.45, "protocol event"),
    p(/\b(exchange (hack|outage|halts? withdrawals)|withdrawals (paused|halted)|exploit|drained)\b/i, 0.5, "exchange / security incident"),
    p(/\b(spot (bitcoin|ether|ethereum) etf|etf (inflows|outflows))\b/i, 0.4, "crypto ETF"),
  ],
  geopolitics: [
    p(/\b(war|invasion|missile|airstrikes?|military|troops|ceasefire|blockade|embargo)\b/i, 0.45, "conflict"),
    p(/\b(sanctions|election|coup|referendum|diplomatic|summit)\b/i, 0.3, "political event"),
  ],
  leadership: [
    p(/\b(ceo|cfo|coo|chief executive|chief financial officer|chair(man|woman|person)?)\b/i, 0.25, "executive role"),
    p(/\b(resign(s|ed|ation)?|steps? down|stepping down|appoint(s|ed|ment)|names? (a )?new|successor|ousted|fired|retire(s|ment))\b/i, 0.4, "leadership change"),
  ],
  analyst_commentary: [
    p(/\b(upgrade[sd]?|downgrade[sd]?|initiates? coverage|reiterates? (buy|sell|hold|overweight|underweight))\b/i, 0.55, "rating change"),
    p(/\b(price target|pt (raised|cut|to)|overweight|underweight|outperform|underperform|equal[- ]weight)\b/i, 0.4, "analyst terms"),
  ],
  rumor: [
    p(/\b(reportedly|rumou?rs?|rumou?red|unconfirmed|hearing that|chatter|speculation that)\b/i, 0.5, "hedged sourcing"),
    p(/\b(sources (say|said|tell)|people familiar with|according to (people|a person|sources)|anonymous sources)\b/i, 0.45, "anonymous sourcing"),
    p(/\b(may be|could be|considering|in talks|exploring)\b/i, 0.15, "speculative phrasing"),
  ],
  market_commentary: [
    p(/\b(i think|imo|in my (view|opinion)|my take|i'm (bullish|bearish)|i am (bullish|bearish))\b/i, 0.5, "opinion marker"),
    p(/\b(bullish|bearish|to the moon|going higher|going lower|chart|support level|resistance level|breakout)\b/i, 0.3, "market sentiment"),
  ],
  other_material: [],
};

/** Phrases indicating the post corrects earlier information. */
export const CORRECTION_PATTERNS: RegExp[] = [
  /\bcorrection\s*[:\-]/i,
  /\b(corrects?|corrected) (an )?(earlier|previous|prior)/i,
  /\b(clarification|clarifies)\b/i,
  /\b(erroneously|incorrectly) (reported|stated)/i,
  /\bupdated? to (correct|reflect)/i,
];

/** Phrases indicating a denial or contradiction of a claim. */
export const DENIAL_PATTERNS: RegExp[] = [
  /\b(denies|denied|refutes?|refuted|rejects? (the )?(report|claim)s?)\b/i,
  /\b(not true|false report|fake news|no truth|baseless|unfounded)\b/i,
  /\b(is not|are not|isn't|aren't) in (discussions|talks|negotiations)\b/i,
  /\bno (plans|intention) to\b/i,
  /\bdoes not comment on (rumou?rs|market speculation)\b/i,
];

/** Attribution patterns used for independence analysis ("via Reuters"). */
export const ATTRIBUTION_PATTERNS: RegExp[] = [
  /\bvia @([A-Za-z0-9_]{2,15})\b/i,
  /\bvia (reuters|bloomberg|wsj|cnbc|dow jones|the information|nikkei|axios|ap)\b/i,
  /\baccording to (reuters|bloomberg|the wall street journal|wsj|financial times|ft|cnbc|ap|associated press|the information|axios|nikkei|dow jones)\b/i,
  /\b(reuters|bloomberg|wsj|cnbc|dow jones|the information|nikkei) (reports?|reported|says|said)\b/i,
  /\bper (reuters|bloomberg|wsj|cnbc|the information|axios)\b/i,
];

/** Signals that a post states facts first-hand vs. relays or opines. */
export const DIRECTNESS_PATTERNS = {
  firstHand: [/\b(we (announce|report|are pleased|have)|today (we|the committee|the board)|the committee decided|announced today)\b/i],
  hedged: [/\b(reportedly|rumou?r|unconfirmed|sources say|people familiar|hearing that|speculation)\b/i],
  opinion: [/\b(i think|imo|in my view|my take|bullish|bearish)\b/i],
};

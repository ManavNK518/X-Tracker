import type { AssetRelation } from "@/domain/misc";

/**
 * Alias dictionary used for entity resolution and asset mapping.
 *
 * - `tickerMatch: "cashtag_only"` marks tickers that collide with ordinary
 *   words or abbreviations (e.g. ON, F, T, MS). Those only match as cashtags
 *   ($F) or when a company alias also appears in the text.
 * - `related` lists *possible* relationships. A mapping never implies the
 *   direction or size of a price reaction.
 * - Demo assets use a ".DEMO" suffix so they cannot be confused with real
 *   instruments, and are only active when DEMO_MODE is enabled.
 *
 * Extend this file (or add watchlist custom assets in the UI) rather than
 * changing pipeline logic.
 */

export type AssetClass = "equity" | "etf" | "crypto" | "rate" | "fx" | "commodity" | "index";

export interface AssetDef {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  sector?: string;
  aliases: string[];
  tickerMatch?: "cashtag_only" | "cashtag_or_upper" | "none";
  related?: { symbol: string; relation: AssetRelation }[];
  demo?: boolean;
}

const peers = (...symbols: string[]) => symbols.map((symbol) => ({ symbol, relation: "peer" as const }));
const suppliers = (...symbols: string[]) => symbols.map((symbol) => ({ symbol, relation: "supplier" as const }));
const customers = (...symbols: string[]) => symbols.map((symbol) => ({ symbol, relation: "customer" as const }));
const sector = (...symbols: string[]) => symbols.map((symbol) => ({ symbol, relation: "sector" as const }));

export const ASSETS: AssetDef[] = [
  // --- Semiconductors ---
  {
    symbol: "NVDA", name: "NVIDIA", assetClass: "equity", sector: "Semiconductors",
    aliases: ["nvidia", "nvidia corp", "nvidia corporation"],
    related: [...peers("AMD", "INTC", "AVGO"), ...suppliers("TSM", "MU", "ASML"), ...customers("MSFT", "META", "GOOGL", "AMZN", "ORCL"), ...sector("SOXX")],
  },
  {
    symbol: "AMD", name: "Advanced Micro Devices", assetClass: "equity", sector: "Semiconductors",
    aliases: ["advanced micro devices"],
    related: [...peers("NVDA", "INTC"), ...suppliers("TSM"), ...sector("SOXX")],
  },
  {
    symbol: "INTC", name: "Intel", assetClass: "equity", sector: "Semiconductors",
    aliases: ["intel", "intel corp", "intel corporation"],
    related: [...peers("AMD", "NVDA", "TSM"), ...suppliers("ASML", "AMAT"), ...sector("SOXX")],
  },
  {
    symbol: "TSM", name: "Taiwan Semiconductor Manufacturing", assetClass: "equity", sector: "Semiconductors",
    aliases: ["tsmc", "taiwan semiconductor", "taiwan semiconductor manufacturing"],
    related: [...customers("NVDA", "AAPL", "AMD", "AVGO", "QCOM"), ...suppliers("ASML", "AMAT", "LRCX"), ...peers("INTC"), ...sector("SOXX")],
  },
  {
    symbol: "ASML", name: "ASML Holding", assetClass: "equity", sector: "Semiconductor equipment",
    aliases: ["asml", "asml holding"],
    related: [...customers("TSM", "INTC"), ...peers("AMAT", "LRCX", "KLAC"), ...sector("SOXX")],
  },
  {
    symbol: "AVGO", name: "Broadcom", assetClass: "equity", sector: "Semiconductors",
    aliases: ["broadcom"],
    related: [...peers("NVDA", "MRVL"), ...suppliers("TSM"), ...sector("SOXX")],
  },
  {
    symbol: "MU", name: "Micron Technology", assetClass: "equity", sector: "Semiconductors",
    aliases: ["micron", "micron technology"],
    related: [...customers("NVDA"), ...sector("SOXX")],
  },
  {
    symbol: "QCOM", name: "Qualcomm", assetClass: "equity", sector: "Semiconductors",
    aliases: ["qualcomm"],
    related: [...suppliers("TSM"), ...customers("AAPL"), ...sector("SOXX")],
  },
  {
    symbol: "AMAT", name: "Applied Materials", assetClass: "equity", sector: "Semiconductor equipment",
    aliases: ["applied materials"],
    related: [...peers("LRCX", "KLAC", "ASML"), ...customers("TSM", "INTC"), ...sector("SOXX")],
  },
  {
    symbol: "LRCX", name: "Lam Research", assetClass: "equity", sector: "Semiconductor equipment",
    aliases: ["lam research"],
    related: [...peers("AMAT", "KLAC", "ASML"), ...sector("SOXX")],
  },
  {
    symbol: "KLAC", name: "KLA Corporation", assetClass: "equity", sector: "Semiconductor equipment",
    aliases: ["kla corp", "kla corporation"],
    related: [...peers("AMAT", "LRCX"), ...sector("SOXX")],
  },
  {
    symbol: "MRVL", name: "Marvell Technology", assetClass: "equity", sector: "Semiconductors",
    aliases: ["marvell", "marvell technology"],
    related: [...peers("AVGO"), ...sector("SOXX")],
  },
  {
    symbol: "ARM", name: "Arm Holdings", assetClass: "equity", sector: "Semiconductors",
    aliases: ["arm holdings"], tickerMatch: "cashtag_only",
    related: [...sector("SOXX")],
  },
  {
    symbol: "ON", name: "ON Semiconductor", assetClass: "equity", sector: "Semiconductors",
    aliases: ["onsemi", "on semiconductor"], tickerMatch: "cashtag_only",
    related: [...sector("SOXX")],
  },
  {
    symbol: "SMCI", name: "Super Micro Computer", assetClass: "equity", sector: "AI infrastructure",
    aliases: ["super micro computer", "supermicro"],
    related: [...suppliers("NVDA")],
  },
  // --- Large-cap technology / AI infrastructure ---
  {
    symbol: "AAPL", name: "Apple", assetClass: "equity", sector: "Technology",
    aliases: ["apple inc", "apple"],
    related: [...suppliers("TSM", "QCOM"), ...peers("MSFT", "GOOGL")],
  },
  {
    symbol: "MSFT", name: "Microsoft", assetClass: "equity", sector: "Technology",
    aliases: ["microsoft", "microsoft corp", "azure"],
    related: [...peers("GOOGL", "AMZN", "ORCL"), ...suppliers("NVDA", "AMD")],
  },
  {
    symbol: "GOOGL", name: "Alphabet", assetClass: "equity", sector: "Technology",
    aliases: ["alphabet", "google"],
    related: [...peers("MSFT", "META", "AMZN"), ...suppliers("NVDA", "AVGO")],
  },
  {
    symbol: "AMZN", name: "Amazon", assetClass: "equity", sector: "Technology",
    aliases: ["amazon", "amazon.com", "aws", "amazon web services"],
    related: [...peers("MSFT", "GOOGL", "WMT"), ...suppliers("NVDA")],
  },
  {
    symbol: "META", name: "Meta Platforms", assetClass: "equity", sector: "Technology",
    aliases: ["meta platforms", "facebook", "instagram"], tickerMatch: "cashtag_only",
    related: [...peers("GOOGL"), ...suppliers("NVDA", "AVGO")],
  },
  {
    symbol: "ORCL", name: "Oracle", assetClass: "equity", sector: "Technology",
    aliases: ["oracle", "oracle corp"],
    related: [...peers("MSFT", "AMZN", "GOOGL"), ...suppliers("NVDA")],
  },
  {
    symbol: "TSLA", name: "Tesla", assetClass: "equity", sector: "Automotive",
    aliases: ["tesla"],
    related: [...peers("F", "GM")],
  },
  {
    symbol: "NFLX", name: "Netflix", assetClass: "equity", sector: "Communication services",
    aliases: ["netflix"],
  },
  {
    symbol: "CRM", name: "Salesforce", assetClass: "equity", sector: "Technology",
    aliases: ["salesforce"],
  },
  {
    symbol: "PLTR", name: "Palantir", assetClass: "equity", sector: "Technology",
    aliases: ["palantir"],
  },
  // --- Financials ---
  {
    symbol: "JPM", name: "JPMorgan Chase", assetClass: "equity", sector: "Financials",
    aliases: ["jpmorgan", "jp morgan", "jpmorgan chase"],
    related: [...peers("BAC", "C", "WFC", "GS", "MS"), ...sector("XLF")],
  },
  {
    symbol: "BAC", name: "Bank of America", assetClass: "equity", sector: "Financials",
    aliases: ["bank of america"],
    related: [...peers("JPM", "C", "WFC"), ...sector("XLF")],
  },
  {
    symbol: "C", name: "Citigroup", assetClass: "equity", sector: "Financials",
    aliases: ["citigroup", "citi"], tickerMatch: "cashtag_only",
    related: [...peers("JPM", "BAC"), ...sector("XLF")],
  },
  {
    symbol: "WFC", name: "Wells Fargo", assetClass: "equity", sector: "Financials",
    aliases: ["wells fargo"],
    related: [...peers("JPM", "BAC"), ...sector("XLF")],
  },
  {
    symbol: "GS", name: "Goldman Sachs", assetClass: "equity", sector: "Financials",
    aliases: ["goldman sachs", "goldman"],
    related: [...peers("MS", "JPM"), ...sector("XLF")],
  },
  {
    symbol: "MS", name: "Morgan Stanley", assetClass: "equity", sector: "Financials",
    aliases: ["morgan stanley"], tickerMatch: "cashtag_only",
    related: [...peers("GS", "JPM"), ...sector("XLF")],
  },
  {
    symbol: "AXP", name: "American Express", assetClass: "equity", sector: "Financials",
    aliases: ["american express", "amex"],
    related: [...peers("V", "MA", "COF"), ...sector("XLF")],
  },
  {
    symbol: "COF", name: "Capital One", assetClass: "equity", sector: "Financials",
    aliases: ["capital one"],
    related: [...peers("AXP", "JPM"), ...sector("XLF")],
  },
  {
    symbol: "SCHW", name: "Charles Schwab", assetClass: "equity", sector: "Financials",
    aliases: ["charles schwab", "schwab"],
    related: [...peers("MS", "GS"), ...sector("XLF")],
  },
  {
    symbol: "BLK", name: "BlackRock", assetClass: "equity", sector: "Financials",
    aliases: ["blackrock"],
    related: [...sector("XLF")],
  },
  {
    symbol: "COIN", name: "Coinbase Global", assetClass: "equity", sector: "Financials / digital assets",
    aliases: ["coinbase"],
    related: [{ symbol: "BTC", relation: "sector" }, { symbol: "ETH", relation: "sector" }],
  },
  {
    symbol: "V", name: "Visa", assetClass: "equity", sector: "Financials",
    aliases: ["visa inc"], tickerMatch: "cashtag_only",
    related: [...peers("MA")],
  },
  {
    symbol: "MA", name: "Mastercard", assetClass: "equity", sector: "Financials",
    aliases: ["mastercard"], tickerMatch: "cashtag_only",
    related: [...peers("V")],
  },
  // --- Industrials, consumer, health, energy ---
  {
    symbol: "BA", name: "Boeing", assetClass: "equity", sector: "Industrials",
    aliases: ["boeing"], tickerMatch: "cashtag_only",
  },
  {
    symbol: "CAT", name: "Caterpillar", assetClass: "equity", sector: "Industrials",
    aliases: ["caterpillar"], tickerMatch: "cashtag_only",
  },
  {
    symbol: "F", name: "Ford Motor", assetClass: "equity", sector: "Automotive",
    aliases: ["ford motor", "ford"], tickerMatch: "cashtag_only",
    related: [...peers("GM", "TSLA")],
  },
  {
    symbol: "GM", name: "General Motors", assetClass: "equity", sector: "Automotive",
    aliases: ["general motors"],
    related: [...peers("F", "TSLA")],
  },
  {
    symbol: "WMT", name: "Walmart", assetClass: "equity", sector: "Consumer staples",
    aliases: ["walmart"],
    related: [...peers("COST", "AMZN")],
  },
  {
    symbol: "COST", name: "Costco", assetClass: "equity", sector: "Consumer staples",
    aliases: ["costco"],
    related: [...peers("WMT")],
  },
  {
    symbol: "LLY", name: "Eli Lilly", assetClass: "equity", sector: "Health care",
    aliases: ["eli lilly", "lilly"],
    related: [...peers("NVO")],
  },
  {
    symbol: "NVO", name: "Novo Nordisk", assetClass: "equity", sector: "Health care",
    aliases: ["novo nordisk"],
    related: [...peers("LLY")],
  },
  {
    symbol: "UNH", name: "UnitedHealth Group", assetClass: "equity", sector: "Health care",
    aliases: ["unitedhealth", "unitedhealth group"],
  },
  {
    symbol: "XOM", name: "Exxon Mobil", assetClass: "equity", sector: "Energy",
    aliases: ["exxon", "exxonmobil", "exxon mobil"],
    related: [...peers("CVX"), { symbol: "WTI", relation: "sector" }, ...sector("XLE")],
  },
  {
    symbol: "CVX", name: "Chevron", assetClass: "equity", sector: "Energy",
    aliases: ["chevron"],
    related: [...peers("XOM"), { symbol: "WTI", relation: "sector" }, ...sector("XLE")],
  },
  {
    symbol: "T", name: "AT&T", assetClass: "equity", sector: "Communication services",
    aliases: ["at&t"], tickerMatch: "cashtag_only",
  },
  // --- ETFs / indices ---
  { symbol: "SPY", name: "SPDR S&P 500 ETF", assetClass: "etf", aliases: [] },
  { symbol: "QQQ", name: "Invesco QQQ (Nasdaq-100) ETF", assetClass: "etf", aliases: [] },
  { symbol: "IWM", name: "iShares Russell 2000 ETF", assetClass: "etf", aliases: ["russell 2000"] },
  { symbol: "TLT", name: "iShares 20+ Year Treasury Bond ETF", assetClass: "etf", aliases: [] },
  { symbol: "SOXX", name: "iShares Semiconductor ETF", assetClass: "etf", sector: "Semiconductors", aliases: ["semiconductor index", "chip stocks"] },
  { symbol: "XLF", name: "Financial Select Sector SPDR", assetClass: "etf", sector: "Financials", aliases: ["bank stocks"] },
  { symbol: "XLE", name: "Energy Select Sector SPDR", assetClass: "etf", sector: "Energy", aliases: ["energy stocks"] },
  { symbol: "SPX", name: "S&P 500 Index", assetClass: "index", aliases: ["s&p 500", "s&p500", "sp500"], tickerMatch: "cashtag_only" },
  { symbol: "NDX", name: "Nasdaq-100 Index", assetClass: "index", aliases: ["nasdaq 100", "nasdaq-100", "nasdaq composite"] },
  { symbol: "VIX", name: "CBOE Volatility Index", assetClass: "index", aliases: ["vix", "volatility index"] },
  // --- Rates / FX ---
  { symbol: "UST2Y", name: "US 2-Year Treasury yield", assetClass: "rate", aliases: ["2-year yield", "two-year yield", "2-year treasury", "two-year treasury", "2y yield"], tickerMatch: "none" },
  { symbol: "UST10Y", name: "US 10-Year Treasury yield", assetClass: "rate", aliases: ["10-year yield", "ten-year yield", "10-year treasury", "ten-year treasury", "10y yield", "treasury yields"], tickerMatch: "none" },
  { symbol: "FEDFUNDS", name: "Fed funds rate expectations", assetClass: "rate", aliases: ["fed funds", "federal funds rate", "fed funds futures"], tickerMatch: "none" },
  { symbol: "DXY", name: "US Dollar Index", assetClass: "fx", aliases: ["dollar index", "us dollar index", "greenback"] },
  { symbol: "EURUSD", name: "EUR/USD", assetClass: "fx", aliases: ["eur/usd", "euro-dollar", "euro dollar exchange rate"] },
  { symbol: "USDJPY", name: "USD/JPY", assetClass: "fx", aliases: ["usd/jpy", "dollar-yen", "japanese yen"] },
  { symbol: "GBPUSD", name: "GBP/USD", assetClass: "fx", aliases: ["gbp/usd", "sterling", "british pound"] },
  // --- Commodities ---
  { symbol: "WTI", name: "WTI crude oil", assetClass: "commodity", aliases: ["wti", "crude oil", "oil prices", "west texas intermediate"], tickerMatch: "none" },
  { symbol: "BRENT", name: "Brent crude oil", assetClass: "commodity", aliases: ["brent", "brent crude"], tickerMatch: "none" },
  { symbol: "NATGAS", name: "Natural gas", assetClass: "commodity", aliases: ["natural gas", "henry hub", "lng"], tickerMatch: "none" },
  { symbol: "GOLD", name: "Gold", assetClass: "commodity", aliases: ["gold prices", "gold price", "bullion", "xau"], tickerMatch: "none" },
  { symbol: "SILVER", name: "Silver", assetClass: "commodity", aliases: ["silver prices", "xag"], tickerMatch: "none" },
  { symbol: "COPPER", name: "Copper", assetClass: "commodity", aliases: ["copper prices", "copper"], tickerMatch: "none" },
  { symbol: "WHEAT", name: "Wheat", assetClass: "commodity", aliases: ["wheat futures", "wheat prices"], tickerMatch: "none" },
  // --- Digital assets ---
  { symbol: "BTC", name: "Bitcoin", assetClass: "crypto", aliases: ["bitcoin"], related: [{ symbol: "ETH", relation: "sector" }, { symbol: "COIN", relation: "sector" }] },
  { symbol: "ETH", name: "Ethereum", assetClass: "crypto", aliases: ["ethereum", "ether"], related: [{ symbol: "BTC", relation: "sector" }] },
  { symbol: "SOL", name: "Solana", assetClass: "crypto", aliases: ["solana"], related: [{ symbol: "BTC", relation: "sector" }] },
  { symbol: "XRP", name: "XRP", assetClass: "crypto", aliases: ["ripple"] },
  { symbol: "USDT", name: "Tether (USDT)", assetClass: "crypto", aliases: ["tether"] },
  { symbol: "USDC", name: "USD Coin (USDC)", assetClass: "crypto", aliases: ["usd coin", "circle's usdc"] },

  // --- Demo-only fictional instruments (DEMO_MODE) ---
  { symbol: "HLCN.DEMO", name: "Halcyon Semiconductor (fictional)", assetClass: "equity", sector: "Semiconductors (demo)", aliases: ["halcyon semiconductor", "halcyon"], demo: true, related: [{ symbol: "KSTL.DEMO", relation: "supplier" }, { symbol: "ORBX.DEMO", relation: "peer" }] },
  { symbol: "ORBX.DEMO", name: "Orbix Systems (fictional)", assetClass: "equity", sector: "Technology (demo)", aliases: ["orbix systems", "orbix"], demo: true, related: [{ symbol: "HLCN.DEMO", relation: "peer" }] },
  { symbol: "KSTL.DEMO", name: "Kestrel Foundry (fictional)", assetClass: "equity", sector: "Semiconductors (demo)", aliases: ["kestrel foundry", "kestrel"], demo: true, related: [{ symbol: "HLCN.DEMO", relation: "customer" }] },
  { symbol: "DLD10Y.DEMO", name: "Demoland 10-year yield (fictional)", assetClass: "rate", aliases: ["demoland 10-year", "demoland yields"], tickerMatch: "none", demo: true },
  { symbol: "DLDX.DEMO", name: "Demoland currency index (fictional)", assetClass: "fx", aliases: ["demoland currency", "demoland dollar"], tickerMatch: "none", demo: true },
  { symbol: "DMC.DEMO", name: "DemoChain token (fictional)", assetClass: "crypto", aliases: ["demochain"], demo: true },
];

const bySymbol = new Map(ASSETS.map((a) => [a.symbol, a]));

export function getAsset(symbol: string): AssetDef | undefined {
  return bySymbol.get(symbol.toUpperCase());
}

export function activeAssets(includeDemo: boolean): AssetDef[] {
  return ASSETS.filter((a) => includeDemo || !a.demo);
}

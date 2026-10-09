/** Event categories shared by the pipeline, API and UI. */
export const EVENT_CATEGORIES = [
  "monetary_policy",
  "economic_data",
  "earnings",
  "guidance",
  "corporate_transaction",
  "regulatory",
  "legal",
  "product_launch",
  "supply_chain",
  "industry",
  "commodity",
  "digital_asset",
  "geopolitics",
  "leadership",
  "analyst_commentary",
  "rumor",
  "market_commentary",
  "other_material",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  monetary_policy: "Monetary policy",
  economic_data: "Economic data",
  earnings: "Earnings",
  guidance: "Guidance",
  corporate_transaction: "Corporate transaction",
  regulatory: "Regulatory",
  legal: "Legal",
  product_launch: "Product launch",
  supply_chain: "Supply chain",
  industry: "Industry development",
  commodity: "Commodity",
  digital_asset: "Digital asset",
  geopolitics: "Geopolitics",
  leadership: "Leadership change",
  analyst_commentary: "Analyst commentary",
  rumor: "Rumor / unverified claim",
  market_commentary: "Market commentary",
  other_material: "Other material development",
};

/** Categories that describe the nature of a claim rather than its subject. */
export const CLAIM_NATURE_CATEGORIES: ReadonlySet<EventCategory> = new Set([
  "rumor",
  "market_commentary",
  "analyst_commentary",
]);

export const MACRO_CATEGORIES: ReadonlySet<EventCategory> = new Set([
  "monetary_policy",
  "economic_data",
]);

export function isEventCategory(value: unknown): value is EventCategory {
  return typeof value === "string" && (EVENT_CATEGORIES as readonly string[]).includes(value);
}

export function categoryLabel(value: string): string {
  return isEventCategory(value) ? CATEGORY_LABELS[value] : value;
}

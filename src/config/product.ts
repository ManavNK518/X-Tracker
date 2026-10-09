/**
 * Product identity. This is the single place to rename the product.
 * Safe to import from both client and server code (no secrets here).
 */
export const PRODUCT = {
  name: "Signal Terminal",
  shortName: "SIGNAL",
  tagline: "Market-intelligence research terminal",
  /** Shown on alerts, event pages and the footer of exported notes. */
  disclaimer:
    "Research tool only. Scores prioritise research attention; they are not probabilities of price movement or trading recommendations.",
  sessionCookieName: "st_session",
} as const;

/**
 * Market-data provider interface. No provider is connected by default: the
 * application never scrapes prices or hard-codes them. To enable event
 * studies, implement this interface against an authorized data vendor and
 * store observations in `price_observations` with explicit freshness flags.
 */
export interface PriceObservation {
  symbol: string;
  provider: string;
  price: string; // decimal string to avoid floating-point loss in storage
  currency: string;
  marketTs: Date;
  collectedAt: Date;
  isRealtime: boolean;
  /** Delay in seconds for delayed feeds; null when unknown. Never present delayed data as real time. */
  delaySeconds: number | null;
}

export interface MarketDataProvider {
  readonly id: string;
  configured(): boolean;
  /** Historical bars/ticks between two instants. Granularity depends on the vendor plan. */
  history(symbol: string, from: Date, to: Date, granularity: "1m" | "5m" | "1d"): Promise<PriceObservation[]>;
  latest(symbols: string[]): Promise<PriceObservation[]>;
}

export class NoMarketDataProvider implements MarketDataProvider {
  readonly id = "none";
  configured() {
    return false;
  }
  async history(): Promise<PriceObservation[]> {
    throw new Error("No market-data provider configured");
  }
  async latest(): Promise<PriceObservation[]> {
    throw new Error("No market-data provider configured");
  }
}

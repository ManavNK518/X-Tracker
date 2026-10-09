import { closeAfterTradingDays, sessionAt } from "./calendar";

/**
 * Event-study foundations. Computes post-event returns at configurable
 * horizons from a price series supplied by an authorized market-data provider.
 *
 * Important limitations (also shown in the UI):
 *  - Results describe what happened after an event; they do not show the event
 *    caused the move.
 *  - An event study is not a tradable strategy: it ignores spreads, slippage,
 *    fees and execution delay unless explicitly modelled.
 *  - Horizons without adequate data return "insufficient_data" rather than a guess.
 */
export interface PricePoint {
  ts: Date;
  price: number;
}

export type Horizon = { id: string; kind: "minutes"; minutes: number } | { id: string; kind: "trading_days"; days: number };

export const DEFAULT_HORIZONS: Horizon[] = [
  { id: "5m", kind: "minutes", minutes: 5 },
  { id: "30m", kind: "minutes", minutes: 30 },
  { id: "1h", kind: "minutes", minutes: 60 },
  { id: "1d", kind: "trading_days", days: 1 },
  { id: "5d", kind: "trading_days", days: 5 },
];

export interface HorizonResult {
  horizon: string;
  status: "ok" | "insufficient_data";
  reason?: string;
  basePrice?: number;
  baseTs?: string;
  endPrice?: number;
  endTs?: string;
  return?: number;
  benchmarkReturn?: number | null;
  abnormalReturn?: number | null;
  maxFavorable?: number;
  maxAdverse?: number;
  crossesSessionClose?: boolean;
}

export interface EventStudyOptions {
  /** Max age of the last price before the event to be used as the base. */
  maxBaseStalenessMs: number;
  /** Max distance between the horizon end and the nearest observation. */
  maxEndToleranceMs: number;
  /** Round-trip cost assumption (fraction) for the simple "net of costs" figure. */
  roundTripCost?: number;
  /** Use the NYSE calendar for trading-day horizons and session checks. */
  exchangeCalendar?: boolean;
}

function lastAtOrBefore(series: PricePoint[], t: Date): PricePoint | null {
  let lo = 0;
  let hi = series.length - 1;
  let ans: PricePoint | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].ts.getTime() <= t.getTime()) {
      ans = series[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function firstAtOrAfter(series: PricePoint[], t: Date): PricePoint | null {
  let lo = 0;
  let hi = series.length - 1;
  let ans: PricePoint | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].ts.getTime() >= t.getTime()) {
      ans = series[mid];
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

export function horizonEnd(eventTs: Date, h: Horizon, calendar: boolean): Date {
  if (h.kind === "minutes") return new Date(eventTs.getTime() + h.minutes * 60_000);
  if (calendar) return closeAfterTradingDays(eventTs, h.days);
  return new Date(eventTs.getTime() + h.days * 86_400_000);
}

export function computeEventStudy(
  eventTs: Date,
  series: PricePoint[],
  benchmark: PricePoint[] | null,
  horizons: Horizon[] = DEFAULT_HORIZONS,
  options: EventStudyOptions = { maxBaseStalenessMs: 15 * 60_000, maxEndToleranceMs: 15 * 60_000, exchangeCalendar: true },
): HorizonResult[] {
  const sorted = [...series].filter((p) => Number.isFinite(p.price) && p.price > 0).sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const bench = benchmark ? [...benchmark].sort((a, b) => a.ts.getTime() - b.ts.getTime()) : null;
  const base = lastAtOrBefore(sorted, eventTs);
  return horizons.map((h) => {
    if (!base) return { horizon: h.id, status: "insufficient_data", reason: "no price at or before the event time" };
    if (eventTs.getTime() - base.ts.getTime() > options.maxBaseStalenessMs) {
      return { horizon: h.id, status: "insufficient_data", reason: "last price before the event is too old (market may have been closed)" };
    }
    const end = horizonEnd(eventTs, h, options.exchangeCalendar ?? false);
    const endPoint = lastAtOrBefore(sorted, end) ?? firstAtOrAfter(sorted, end);
    if (!endPoint || endPoint.ts.getTime() <= base.ts.getTime() || Math.abs(endPoint.ts.getTime() - end.getTime()) > options.maxEndToleranceMs) {
      return { horizon: h.id, status: "insufficient_data", reason: "no observation near the horizon end" };
    }
    const window = sorted.filter((p) => p.ts >= base.ts && p.ts <= endPoint.ts);
    const ret = endPoint.price / base.price - 1;
    const maxP = Math.max(...window.map((p) => p.price));
    const minP = Math.min(...window.map((p) => p.price));
    let benchmarkReturn: number | null = null;
    if (bench) {
      const b0 = lastAtOrBefore(bench, base.ts);
      const b1 = lastAtOrBefore(bench, endPoint.ts);
      if (b0 && b1 && b1.ts > b0.ts) benchmarkReturn = b1.price / b0.price - 1;
    }
    const crosses = options.exchangeCalendar
      ? (() => {
          const s = sessionAt(base.ts);
          return !s || endPoint.ts > s.close;
        })()
      : false;
    return {
      horizon: h.id,
      status: "ok",
      basePrice: base.price,
      baseTs: base.ts.toISOString(),
      endPrice: endPoint.price,
      endTs: endPoint.ts.toISOString(),
      return: ret,
      benchmarkReturn,
      abnormalReturn: benchmarkReturn === null ? null : ret - benchmarkReturn,
      maxFavorable: maxP / base.price - 1,
      maxAdverse: minP / base.price - 1,
      crossesSessionClose: crosses,
    };
  });
}

export function realizedVolatility(series: PricePoint[]): number | null {
  const sorted = [...series].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  if (sorted.length < 3) return null;
  const rets: number[] = [];
  for (let i = 1; i < sorted.length; i++) rets.push(Math.log(sorted[i].price / sorted[i - 1].price));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance);
}

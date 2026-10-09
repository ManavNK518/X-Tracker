# Market data and event studies

The first version focuses on information collection and event intelligence. **No market-data provider is connected**, the app never scrapes prices, and no prices are hard-coded.

## What exists

- `src/server/providers/market/types.ts`: the `MarketDataProvider` interface (`history`, `latest`) and observation type, including `isRealtime` and `delaySeconds`, so delayed data is never shown as real time.
- `price_observations` table: symbol, provider, `numeric` price, currency, market timestamp, collection timestamp, realtime/delay flags.
- `event_studies` table for computed results.
- `src/server/evaluation/calendar.ts`: NYSE sessions in America/New_York with algorithmic holidays, weekend observance and 1 pm early closes. Unpredictable one-off closures must be added to `EXTRA_CLOSURES`.
- `src/server/evaluation/event-study.ts`: returns at configurable horizons (5 min, 30 min, 1 h, 1 and 5 trading days), benchmark-relative (abnormal) returns, maximum favorable and adverse excursions, realized volatility, and session-crossing flags. Horizons without adequate data return `insufficient_data` instead of a guess.

## Connecting a provider

1. Pick a vendor whose license permits your use, including storage and display.
2. Implement `MarketDataProvider` for it, and record whether its data is real-time or delayed (and by how much).
3. Add a scheduled job that stores observations in `price_observations` for the assets of recent events.
4. Compute event studies with `computeEventStudy(eventTs, series, benchmarkSeries)` and store the results in `event_studies`.

## Interpreting results

- A move after an event does not show the event caused it.
- Event-study returns are not a trading strategy. A simulation must model spreads, slippage, fees, execution delay, overnight gaps and liquidity.
- Not every asset has minute-level history, and pre/post-market sessions differ by venue.
- Measure detection latency (collected − published) separately from market reaction.

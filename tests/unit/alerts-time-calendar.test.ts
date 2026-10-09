import { describe, expect, it } from "vitest";
import { keywordMatches, matchRule, quietHoursStatus, type AlertEventView, type RuleView } from "@/server/alerts/match";
import { formatDateTime, isValidTimeZone, timeZoneOffsetMinutes, zonedTimeToUtc, formatAge } from "@/lib/time";
import { closeAfterTradingDays, easterSunday, isEarlyClose, isTradingDay, nyseHolidays, sessionAt, sessionFor } from "@/server/evaluation/calendar";
import { computeEventStudy, realizedVolatility, type PricePoint } from "@/server/evaluation/event-study";

const event: AlertEventView = {
  id: "e1",
  importance: 72,
  confidence: 55,
  band: "high",
  verificationStatus: "unverified",
  categories: ["supply_chain"],
  assetSymbols: ["TSM", "NVDA"],
  originSourceCategory: "news_org",
  evidenceSourceIds: ["s1"],
  timeSensitivity: 85,
  isDemo: false,
  text: "production halted at a major fab; export controls not involved",
};
const rule: RuleView = {
  id: "r1",
  name: "Rule",
  kind: "rule",
  minImportance: 60,
  minConfidence: 0,
  categories: [],
  assetSymbols: [],
  sourceCategories: [],
  verificationStates: [],
  requireTimeSensitive: false,
  includeDemo: true,
  channels: ["in_app"],
  cooldownMinutes: null,
  keywords: [],
  sourceIds: [],
};

describe("alert matching", () => {
  it("matches on importance threshold", () => {
    expect(matchRule(event, rule).matched).toBe(true);
    expect(matchRule(event, { ...rule, minImportance: 80 }).matched).toBe(false);
  });
  it("respects confidence, category, asset, source type and verification filters", () => {
    expect(matchRule(event, { ...rule, minConfidence: 60 }).reasons[0]).toMatch(/confidence/);
    expect(matchRule(event, { ...rule, categories: ["earnings"] }).matched).toBe(false);
    expect(matchRule(event, { ...rule, assetSymbols: ["nvda"] }).matched).toBe(true);
    expect(matchRule(event, { ...rule, assetSymbols: ["AAPL"] }).matched).toBe(false);
    expect(matchRule(event, { ...rule, sourceCategories: ["central_bank"] }).matched).toBe(false);
    expect(matchRule(event, { ...rule, verificationStates: ["confirmed"] }).matched).toBe(false);
  });
  it("supports time-sensitivity requirements", () => {
    expect(matchRule({ ...event, timeSensitivity: 30 }, { ...rule, requireTimeSensitive: true }).matched).toBe(false);
  });
  it("can exclude sample data", () => {
    expect(matchRule({ ...event, isDemo: true }, { ...rule, includeDemo: false }).matched).toBe(false);
  });
  it("watchlists match on any selector (asset, keyword, source)", () => {
    const wl: RuleView = { ...rule, kind: "watchlist", assetSymbols: ["AAPL"], keywords: ["fab"], minImportance: 40 };
    expect(matchRule(event, wl).matched).toBe(true);
    expect(matchRule(event, { ...wl, keywords: ["foundry"] }).matched).toBe(false);
    expect(matchRule(event, { ...wl, keywords: [], sourceIds: ["s1"] }).matched).toBe(true);
  });
  it("keywords match on word boundaries", () => {
    expect(keywordMatches("export controls tightened", "export controls")).toBe(true);
    expect(keywordMatches("the fabric market", "fab")).toBe(false);
  });
});

describe("quiet hours", () => {
  const qh = { enabled: true, start: "22:00", end: "07:00", allowCritical: true };
  it("handles overnight windows in the user's time zone", () => {
    // 03:00 in New York (EDT, UTC-4) = 07:00 UTC
    const s = quietHoursStatus(new Date("2026-10-08T07:00:00Z"), "America/New_York", qh);
    expect(s.active).toBe(true);
    expect(s.endsAt!.toISOString()).toBe("2026-10-08T11:00:00.000Z");
    expect(quietHoursStatus(new Date("2026-10-08T16:00:00Z"), "America/New_York", qh).active).toBe(false);
  });
  it("ends tomorrow when inside the evening part of the window", () => {
    const s = quietHoursStatus(new Date("2026-10-09T03:00:00Z"), "America/New_York", qh); // 23:00 EDT on Oct 8
    expect(s.active).toBe(true);
    expect(s.endsAt!.toISOString()).toBe("2026-10-09T11:00:00.000Z");
  });
  it("is inactive when disabled", () => expect(quietHoursStatus(new Date(), "UTC", { ...qh, enabled: false }).active).toBe(false));
});

describe("time zones", () => {
  it("validates IANA zones", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
  it("renders UTC instants in the selected zone across DST", () => {
    expect(formatDateTime("2026-07-01T12:00:00Z", "America/New_York")).toBe("2026-07-01 08:00");
    expect(formatDateTime("2026-12-01T12:00:00Z", "America/New_York")).toBe("2026-12-01 07:00");
    expect(formatDateTime("2026-12-01T12:00:00Z", "Asia/Kolkata")).toBe("2026-12-01 17:30");
  });
  it("converts wall-clock times to UTC including DST boundaries", () => {
    expect(timeZoneOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-240);
    expect(zonedTimeToUtc(2026, 3, 9, 9, 30, "America/New_York").toISOString()).toBe("2026-03-09T13:30:00.000Z"); // day after spring forward
    expect(zonedTimeToUtc(2026, 3, 6, 9, 30, "America/New_York").toISOString()).toBe("2026-03-06T14:30:00.000Z");
  });
  it("formats ages", () => {
    const now = new Date("2026-10-08T15:00:00Z");
    expect(formatAge("2026-10-08T14:59:30Z", now)).toBe("30s");
    expect(formatAge("2026-10-08T12:00:00Z", now)).toBe("3h");
    expect(formatAge("2026-10-05T15:00:00Z", now)).toBe("3d");
  });
});

describe("NYSE calendar", () => {
  it("computes Easter and Good Friday", () => {
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(nyseHolidays(2026).has("2026-04-03")).toBe(true);
  });
  it("applies weekend observance rules", () => {
    const h = nyseHolidays(2026);
    expect(h.has("2026-07-03")).toBe(true); // July 4 is a Saturday
    expect(h.has("2026-11-26")).toBe(true); // Thanksgiving
    expect(h.has("2026-01-19")).toBe(true); // MLK Day
    expect(nyseHolidays(2022).has("2021-12-31")).toBe(false); // no Friday observance for New Year's on Saturday
  });
  it("knows trading days, early closes and session times in UTC", () => {
    expect(isTradingDay(2026, 10, 10)).toBe(false); // Saturday
    expect(isTradingDay(2026, 10, 8)).toBe(true);
    expect(isEarlyClose(2026, 11, 27)).toBe(true);
    const s = sessionFor(2026, 10, 8)!;
    expect(s.open.toISOString()).toBe("2026-10-08T13:30:00.000Z");
    expect(s.close.toISOString()).toBe("2026-10-08T20:00:00.000Z");
    expect(sessionFor(2026, 11, 27)!.close.toISOString()).toBe("2026-11-27T18:00:00.000Z");
    expect(sessionAt(new Date("2026-10-08T21:00:00Z"))).toBeNull();
  });
  it("counts trading-day horizons across weekends and holidays", () => {
    // Friday Oct 9 2026 after close → next trading day close is Monday Oct 12
    expect(closeAfterTradingDays(new Date("2026-10-09T21:00:00Z"), 1).toISOString()).toBe("2026-10-12T20:00:00.000Z");
  });
});

describe("event study", () => {
  const t0 = new Date("2026-10-08T14:00:00Z"); // market open
  const series: PricePoint[] = Array.from({ length: 121 }, (_, i) => ({ ts: new Date(t0.getTime() + (i - 30) * 60_000), price: 100 + (i >= 30 ? (i - 30) * 0.1 : 0) }));
  const bench: PricePoint[] = series.map((p) => ({ ts: p.ts, price: 50 }));
  it("computes returns, benchmark-relative returns and excursions", () => {
    const [m5, m30] = computeEventStudy(t0, series, bench, [
      { id: "5m", kind: "minutes", minutes: 5 },
      { id: "30m", kind: "minutes", minutes: 30 },
    ]);
    expect(m5.status).toBe("ok");
    expect(m5.return).toBeCloseTo(0.005, 6);
    expect(m5.abnormalReturn).toBeCloseTo(0.005, 6);
    expect(m30.maxFavorable).toBeCloseTo(0.03, 6);
    expect(m30.maxAdverse).toBeCloseTo(0, 6);
  });
  it("returns insufficient_data instead of guessing", () => {
    const [r] = computeEventStudy(t0, series, null, [{ id: "5d", kind: "trading_days", days: 5 }]);
    expect(r.status).toBe("insufficient_data");
    const [r2] = computeEventStudy(new Date("2026-10-10T14:00:00Z"), series, null, [{ id: "5m", kind: "minutes", minutes: 5 }]);
    expect(r2.status).toBe("insufficient_data");
  });
  it("computes realized volatility", () => {
    expect(realizedVolatility(series.slice(0, 2))).toBeNull();
    expect(realizedVolatility(series)).toBeGreaterThan(0);
  });
});

import { zonedParts, zonedTimeToUtc } from "@/lib/time";

/**
 * NYSE regular-session calendar (America/New_York), computed algorithmically:
 * full-day holidays with weekend observance rules and 1:00 pm early closes.
 * Special one-off closures (e.g. national days of mourning) are not
 * predictable and must be added to EXTRA_CLOSURES when announced.
 */
export const NYSE_TZ = "America/New_York";
export const EXTRA_CLOSURES: string[] = []; // "YYYY-MM-DD"

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  const first = dow(y, m, 1);
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}
function lastWeekday(y: number, m: number, weekday: number): number {
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = dow(y, m, days);
  return days - ((last - weekday + 7) % 7);
}
/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(y: number): { month: number; day: number } {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Saturday holidays are observed Friday, Sunday holidays Monday (NYSE rule). */
function observed(y: number, m: number, d: number): string {
  const wd = dow(y, m, d);
  const date = new Date(Date.UTC(y, m - 1, d + (wd === 6 ? -1 : wd === 0 ? 1 : 0)));
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const holidayCache = new Map<number, Set<string>>();

export function nyseHolidays(y: number): Set<string> {
  const cached = holidayCache.get(y);
  if (cached) return cached;
  const set = new Set<string>();
  // New Year's Day: NYSE does not observe on Friday Dec 31 when Jan 1 is a Saturday.
  if (dow(y, 1, 1) !== 6) set.add(observed(y, 1, 1));
  set.add(iso(y, 1, nthWeekday(y, 1, 1, 3))); // MLK Day
  set.add(iso(y, 2, nthWeekday(y, 2, 1, 3))); // Presidents' Day
  const easter = easterSunday(y);
  const gf = new Date(Date.UTC(y, easter.month - 1, easter.day - 2));
  set.add(iso(gf.getUTCFullYear(), gf.getUTCMonth() + 1, gf.getUTCDate())); // Good Friday
  set.add(iso(y, 5, lastWeekday(y, 5, 1))); // Memorial Day
  if (y >= 2022) set.add(observed(y, 6, 19)); // Juneteenth
  set.add(observed(y, 7, 4)); // Independence Day
  set.add(iso(y, 9, nthWeekday(y, 9, 1, 1))); // Labor Day
  set.add(iso(y, 11, nthWeekday(y, 11, 4, 4))); // Thanksgiving
  set.add(observed(y, 12, 25)); // Christmas
  for (const extra of EXTRA_CLOSURES) if (extra.startsWith(String(y))) set.add(extra);
  holidayCache.set(y, set);
  return set;
}

/** Early closes (13:00 ET): day before Independence Day, day after Thanksgiving, Christmas Eve. */
export function isEarlyClose(y: number, m: number, d: number): boolean {
  if (!isTradingDay(y, m, d)) return false;
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  if (m === 11 && d === thanksgiving + 1) return true;
  if (m === 12 && d === 24) return true;
  return m === 7 && d === 3 && dow(y, 7, 4) !== 6 && dow(y, 7, 4) !== 0;
}

export function isTradingDay(y: number, m: number, d: number): boolean {
  const wd = dow(y, m, d);
  if (wd === 0 || wd === 6) return false;
  return !nyseHolidays(y).has(iso(y, m, d));
}

export interface Session {
  date: string;
  open: Date;
  close: Date;
  earlyClose: boolean;
}

export function sessionFor(y: number, m: number, d: number): Session | null {
  if (!isTradingDay(y, m, d)) return null;
  const early = isEarlyClose(y, m, d);
  return {
    date: iso(y, m, d),
    open: zonedTimeToUtc(y, m, d, 9, 30, NYSE_TZ),
    close: zonedTimeToUtc(y, m, d, early ? 13 : 16, 0, NYSE_TZ),
    earlyClose: early,
  };
}

/** The session containing `at`, or null if the market is closed at that instant. */
export function sessionAt(at: Date): Session | null {
  const p = zonedParts(at, NYSE_TZ);
  const s = sessionFor(p.year, p.month, p.day);
  if (!s) return null;
  return at >= s.open && at < s.close ? s : null;
}

/** Next session whose close is after `at` (the current one if the market is open). */
export function nextSession(at: Date): Session {
  const p = zonedParts(at, NYSE_TZ);
  for (let i = 0; i < 15; i++) {
    const date = new Date(Date.UTC(p.year, p.month - 1, p.day + i));
    const s = sessionFor(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    if (s && s.close > at) return s;
  }
  throw new Error("no trading session found within 15 days");
}

/** The close of the Nth trading session after `at` (N ≥ 1; the session containing `at` counts as 1 if open). */
export function closeAfterTradingDays(at: Date, n: number): Date {
  let s = nextSession(at);
  for (let i = 1; i < n; i++) s = nextSession(new Date(s.close.getTime() + 60_000));
  return s.close;
}

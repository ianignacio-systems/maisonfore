import type { Day, Minutes } from './types';

/** The day and clock time (minutes after midnight) of a moment, in a time zone. */
export function localParts(at: number, timeZone: string): { day: Day; minutes: Minutes } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** The moment (epoch ms) of a day and clock time in a time zone. */
export function zonedEpoch(day: Day, minutes: Minutes, timeZone: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = localParts(guess, timeZone);
    const [py, pm, pd] = p.day.split('-').map(Number);
    const seen = Date.UTC(py, pm - 1, pd, Math.floor(p.minutes / 60), p.minutes % 60);
    guess += asUtc - seen;
  }
  return guess;
}

export function addDays(day: Day, n: number): Day {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole days from a to b (b later = positive). */
export function daysBetween(a: Day, b: Day): number {
  const t = (s: Day) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: Day): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const validDay = (s: unknown): s is Day => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const validMinutes = (n: unknown): n is Minutes => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 24 * 60;

/** 390 → "6:30 AM". */
export function formatTime(min: Minutes): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2026-11-21' → "Saturday, 21 November". */
export function formatDay(day: Day): string {
  const [, m, d] = day.split('-').map(Number);
  return `${DAYS.at(weekday(day))}, ${d} ${MONTHS.at(m - 1)}`;
}

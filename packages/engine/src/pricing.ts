import { weekday } from './time';
import type { BookingRules, CourseSetup, Day, DayType, Minutes, Rate, TimeBand } from './types';

export function dayType(day: Day, holidays: Day[]): DayType {
  if (holidays.includes(day)) return 'holiday';
  const w = weekday(day);
  return w === 0 || w === 6 ? 'weekend' : 'weekday';
}

export function bandAt(time: Minutes, rules: BookingRules): TimeBand {
  return rules.twilightFrom !== null && time >= rules.twilightFrom ? 'twilight' : 'regular';
}

/**
 * The rate for one player: the most recent rate in force on the day for that player type, day type,
 * holes and time band. A holiday with no holiday rate uses the weekend rate; twilight with no twilight
 * rate uses the regular one. null = no rate set (the course must set one before it can be booked).
 */
export function priceFor(setup: CourseSetup, playerTypeId: string, holes: 9 | 18, day: Day, time: Minutes): number | null {
  const dt = dayType(day, setup.holidays);
  const band = bandAt(time, setup.rules);
  const tries: [DayType, TimeBand][] = [[dt, band]];
  if (band === 'twilight') tries.push([dt, 'regular']);
  if (dt === 'holiday') { tries.push(['weekend', band]); if (band === 'twilight') tries.push(['weekend', 'regular']); }
  for (const [d, b] of tries) {
    const r = latest(setup.rates.filter((x) => x.playerTypeId === playerTypeId && x.holes === holes && x.dayType === d && x.band === b && x.effectiveFrom <= day));
    if (r) return r.amount;
  }
  return null;
}

function latest(rs: Rate[]): Rate | undefined {
  return rs.reduce<Rate | undefined>((a, r) => (!a || r.effectiveFrom > a.effectiveFrom ? r : a), undefined);
}

/** ₱1,250.00 */
export function peso(centavos: number): string {
  return `₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

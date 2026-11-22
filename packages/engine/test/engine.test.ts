import { describe, expect, it } from 'vitest';
import {
  dueByNow, lapsedUnpaid, mustPayNow, payDeadline,
  DEFAULT_RULES,
  addDays, buildSheet, canChange, checkBooking, checkSettings, dayType, formatDay, formatTime, golferCanChange, isOpen, localParts, newRef,
  opensMessage, priceFor, publicWindow, settingsFor, takesSlot, teeTimes, zonedEpoch, type Block, type CourseSetup,
} from '../src';
import { at, booking, course, TZ } from './helpers';

const block = (over: Partial<Block>): Block => ({ id: 'K1', layoutId: null, startTee: null, day: '2026-11-23', from: 360, to: 380, kind: 'walkin', reason: 'Walk-ins', releaseAt: null, ...over });

describe('time', () => {
  it('converts between Manila clock time and moments', () => {
    const t = zonedEpoch('2026-11-23', 390, TZ);
    expect(new Date(t).toISOString()).toBe('2026-11-22T22:30:00.000Z');
    expect(localParts(t, TZ)).toEqual({ day: '2026-11-23', minutes: 390 });
  });
  it('handles time zones with daylight saving', () => {
    const t = zonedEpoch('2026-07-01', 9 * 60, 'America/New_York');
    expect(new Date(t).toISOString()).toBe('2026-07-01T13:00:00.000Z');
  });
  it('formats times and days', () => {
    expect(formatTime(390)).toBe('6:30 AM');
    expect(formatTime(780)).toBe('1:00 PM');
    expect(formatTime(0)).toBe('12:00 AM');
    expect(formatDay('2026-11-21')).toBe('Saturday, 21 November');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('tee times', () => {
  it('lists the tee times from first to last, every interval', () => {
    const s = settingsFor(course(), 'L18', '2026-11-23')!;
    expect(teeTimes(s)).toEqual([360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480]);
  });
  it('uses the settings in force on the day; new settings do not change earlier days', () => {
    const c = course();
    c.settings.push({ layoutId: 'L18', effectiveFrom: '2026-12-01', firstTee: 330, lastTee: 480, interval: 8, maxPlayers: 4 });
    expect(settingsFor(c, 'L18', '2026-11-30')!.interval).toBe(10);
    expect(settingsFor(c, 'L18', '2026-12-01')!.interval).toBe(8);
    expect(settingsFor(c, 'L18', '2025-12-31')).toBeNull();
  });
  it('explains settings that make no sense', () => {
    expect(checkSettings({ firstTee: 360, lastTee: 300, interval: 3, maxPlayers: 6 })).toHaveLength(3);
    expect(checkSettings({ firstTee: 360, lastTee: 840, interval: 8, maxPlayers: 4 })).toEqual([]);
  });
  it('builds one slot per tee time per starting tee', () => {
    const now = at('2026-11-20', '12:00');
    const sheet = buildSheet(course(), { layoutId: 'L2T', day: '2026-11-23', bookings: [], blocks: [], now, audience: 'staff' });
    expect(sheet).toHaveLength(7 * 2);
    expect(sheet.filter((s) => s.startTee === '10')).toHaveLength(7);
    expect(sheet.every((s) => s.state === 'open' && s.free === 4)).toBe(true);
  });
});

describe('slot states', () => {
  const now = at('2026-11-20', '12:00');
  it('counts players on active bookings; cancelled and expired ones free their slot', () => {
    const bookings = [
      booking({ time: 360, players: 3 }),
      booking({ time: 360, players: 1, status: 'held', holdExpiresAt: now + 60_000 }),
      booking({ time: 370, players: 4, status: 'cancelled' }),
      booking({ time: 370, players: 2, status: 'held', holdExpiresAt: now - 1 }),
      booking({ time: 380, players: 2 }),
    ];
    const sheet = buildSheet(course(), { layoutId: 'L18', day: '2026-11-23', bookings, blocks: [], now, audience: 'staff' });
    const at6 = sheet.find((s) => s.time === 360)!;
    expect(at6.state).toBe('full');
    expect(at6.bookings).toHaveLength(2);
    expect(sheet.find((s) => s.time === 370)!.state).toBe('open');
    expect(sheet.find((s) => s.time === 380)!).toMatchObject({ state: 'partial', used: 2, free: 2 });
  });
  it('hides who is booked from the public', () => {
    const sheet = buildSheet(course(), { layoutId: 'L18', day: '2026-11-23', bookings: [booking({ time: 380 })], blocks: [], now, audience: 'public' });
    expect(sheet.find((s) => s.time === 380)!.bookings).toEqual([]);
  });
  it('marks past tee times', () => {
    const sheet = buildSheet(course(), { layoutId: 'L18', day: '2026-11-23', bookings: [], blocks: [], now: at('2026-11-23', '07:05'), audience: 'staff' });
    expect(sheet.find((s) => s.time === 420)!.state).toBe('past');
    expect(sheet.find((s) => s.time === 430)!.state).toBe('open');
  });
  it('holds and closes slots; a closure wins over a hold', () => {
    const blocks = [block({ from: 360, to: 380 }), block({ id: 'K2', kind: 'weather', reason: 'Lightning', from: 370, to: 390 })];
    const sheet = buildSheet(course(), { layoutId: 'L18', day: '2026-11-23', bookings: [], blocks, now, audience: 'public' });
    expect(sheet.find((s) => s.time === 360)!.state).toBe('held');
    expect(sheet.find((s) => s.time === 370)!.state).toBe('closed');
    expect(sheet.find((s) => s.time === 380)!.state).toBe('closed');
    expect(sheet.find((s) => s.time === 390)!.state).toBe('open');
  });
  it('applies a hold to one starting tee only, when it says so', () => {
    const sheet = buildSheet(course(), { layoutId: 'L2T', day: '2026-11-23', bookings: [], blocks: [block({ startTee: '10', to: 420 })], now, audience: 'staff' });
    expect(sheet.filter((s) => s.startTee === '1').every((s) => s.state === 'open')).toBe(true);
    expect(sheet.filter((s) => s.startTee === '10' && s.time < 420).every((s) => s.state === 'held')).toBe(true);
  });
  it('releases held walk-in slots to the app at their release time, but never a closure', () => {
    const blocks = [block({ releaseAt: at('2026-11-22', '18:00'), to: 370 }), block({ id: 'K2', kind: 'maintenance', from: 370, to: 380, releaseAt: at('2026-11-22', '18:00') })];
    const before = buildSheet(course(), { layoutId: 'L18', day: '2026-11-23', bookings: [], blocks, now: at('2026-11-22', '17:59'), audience: 'public' });
    const after = buildSheet(course(), { layoutId: 'L18', day: '2026-11-23', bookings: [], blocks, now: at('2026-11-22', '18:00'), audience: 'public' });
    expect(before.find((s) => s.time === 360)!.state).toBe('held');
    expect(after.find((s) => s.time === 360)!.state).toBe('open');
    expect(after.find((s) => s.time === 370)!.state).toBe('closed');
  });
});

describe('public booking window', () => {
  it('opens a new day at the release time', () => {
    const c = course(); // 7 days ahead, from 7:00 AM
    expect(publicWindow(c, at('2026-11-20', '06:59')).lastDay).toBe('2026-11-26');
    expect(publicWindow(c, at('2026-11-20', '07:00')).lastDay).toBe('2026-11-27');
    const later = buildSheet(c, { layoutId: 'L18', day: '2026-11-28', bookings: [], blocks: [], now: at('2026-11-20', '12:00'), audience: 'public' });
    expect(later.every((s) => s.state === 'not_released')).toBe(true);
    const staff = buildSheet(c, { layoutId: 'L18', day: '2026-11-28', bookings: [], blocks: [], now: at('2026-11-20', '12:00'), audience: 'staff' });
    expect(staff.every((s) => s.state === 'open')).toBe(true);
    expect(opensMessage(c, '2026-11-28')).toBe('Bookings for Saturday, 28 November open on Saturday, 21 November at 7:00 AM.');
  });
});

describe('checking a booking', () => {
  const now = at('2026-11-20', '12:00');
  const c = course();
  const sheetOf = (audience: 'staff' | 'public', bookings = [booking({ time: 360, players: 3 })], blocks: Block[] = []) =>
    buildSheet(c, { layoutId: 'L18', day: '2026-11-23', bookings, blocks, now, audience });
  const req = { layoutId: 'L18', startTee: '1', day: '2026-11-23', time: 380, players: 2, audience: 'public' as const };

  it('accepts a booking with room', () => expect(checkBooking(c, sheetOf('public'), req)).toBeNull());
  it('refuses more players than are left', () => {
    expect(checkBooking(c, sheetOf('public'), { ...req, time: 360 })).toBe('Only 1 spot is left at 6:00 AM.');
    expect(checkBooking(c, sheetOf('staff', [booking({ time: 360, players: 4 })]), { ...req, time: 360, audience: 'staff' })).toBe('6:00 AM is full.');
  });
  it('refuses a time that is not on the sheet', () => {
    expect(checkBooking(c, sheetOf('public'), { ...req, time: 365 })).toBe('There is no tee time at 6:05 AM on Monday, 23 November.');
  });
  it('lets staff book held slots, but not the public', () => {
    const blocks = [block({ from: 380, to: 390 })];
    expect(checkBooking(c, sheetOf('public', [], blocks), req)).toBe('6:20 AM is not available for booking.');
    expect(checkBooking(c, sheetOf('staff', [], blocks), { ...req, audience: 'staff' })).toBeNull();
  });
  it('applies the minimum players per booking to app bookings, by weekday or weekend', () => {
    const c2 = course({ rules: { ...DEFAULT_RULES, publicDaysAhead: 60, minPlayersWeekday: 1, minPlayersWeekend: 2 } });
    const mon = buildSheet(c2, { layoutId: 'L18', day: '2026-11-23', bookings: [], blocks: [], now: at('2026-11-22', '08:00'), audience: 'public' });
    expect(checkBooking(c2, mon, { ...req, players: 1 })).toBeNull();
    const sat = buildSheet(c2, { layoutId: 'L18', day: '2026-11-28', bookings: [], blocks: [], now: at('2026-11-22', '08:00'), audience: 'public' });
    expect(checkBooking(c2, sat, { ...req, day: '2026-11-28', players: 1 })).toBe('Book at least 2 players on weekends and holidays.');
    const satStaff = buildSheet(c2, { layoutId: 'L18', day: '2026-11-28', bookings: [], blocks: [], now: at('2026-11-22', '08:00'), audience: 'staff' });
    expect(checkBooking(c2, satStaff, { ...req, day: '2026-11-28', players: 1, audience: 'staff' })).toBeNull();
  });
  it('keeps one group per tee time when sharing is off', () => {
    const solo = course({ rules: { ...DEFAULT_RULES, shareTeeTimes: false } });
    const s = buildSheet(solo, { layoutId: 'L18', day: '2026-11-23', bookings: [booking({ time: 380, players: 2 })], blocks: [], now: at('2026-11-22', '08:00'), audience: 'staff' });
    expect(s.find((x) => x.time === 380)).toMatchObject({ state: 'full', free: 0, used: 2 });
  });
  it('turns an unpaid booking into a pencil booking when its payment time runs out', () => {
    const now = at('2026-11-22', '08:00');
    const due = booking({ time: 380, players: 4, payDueBy: now + 60_000 });
    const lapsed = booking({ time: 390, players: 4, payDueBy: now - 60_000 });
    const s = buildSheet(course(), { layoutId: 'L18', day: '2026-11-23', bookings: [due, lapsed], blocks: [], now, audience: 'staff' });
    expect(s.find((x) => x.time === 380)).toMatchObject({ state: 'full', free: 0 });
    const t = s.find((x) => x.time === 390)!;
    expect(t).toMatchObject({ state: 'open', free: 4, used: 0 });
    expect(t.bookings.map((b) => b.id)).toEqual([lapsed.id]);
    const pub = buildSheet(course(), { layoutId: 'L18', day: '2026-11-23', bookings: [lapsed], blocks: [], now, audience: 'public' });
    expect(pub.find((x) => x.time === 390)!.bookings).toEqual([]);
  });
  it('leaves special bookings out of every slot', () => {
    const s = buildSheet(course(), { layoutId: 'L18', day: '2026-11-23', bookings: [booking({ time: 380, players: 4, special: true })], blocks: [], now: at('2026-11-22', '08:00'), audience: 'staff' });
    expect(s.find((x) => x.time === 380)).toMatchObject({ state: 'open', used: 0, free: 4 });
  });
  it('blocks event and tournament times for everyone, staff included', () => {
    const blocks = [{ id: 'E', layoutId: null, startTee: null, day: '2026-11-23', from: 360, to: 400, kind: 'event' as const, reason: 'Club championship', releaseAt: null }];
    const s = sheetOf('staff', [], blocks);
    expect(s.find((x) => x.time === 360)!.state).toBe('closed');
    expect(checkBooking(c, s, { ...req, audience: 'staff' })).toBe('6:20 AM is blocked for Club championship.');
  });
  it('refuses closed times for everyone, with the reason', () => {
    const blocks = [block({ kind: 'maintenance', reason: 'Greens aeration', from: 380, to: 390 })];
    expect(checkBooking(c, sheetOf('staff', [], blocks), { ...req, audience: 'staff' })).toBe('6:20 AM is closed: Greens aeration.');
  });
  it('limits the players in one app booking and the bookings a golfer can hold', () => {
    const tight = course({ rules: { ...c.rules, maxPlayersPerBooking: 2 } });
    const s = buildSheet(tight, { layoutId: 'L18', day: '2026-11-23', bookings: [], blocks: [], now, audience: 'public' });
    expect(checkBooking(tight, s, { ...req, players: 3 })).toBe('A booking can have at most 2 players.');
    expect(checkBooking(c, sheetOf('public'), { ...req, golferOpenBookings: 2 })).toBe('You can have up to 2 bookings at this course at a time.');
    expect(checkBooking(c, sheetOf('public'), { ...req, golferRecentNoShows: 2 })).toMatch(/missed bookings/);
  });
  it('lets a moved booking keep its own spots', () => {
    const mine = booking({ id: 'MINE', time: 380, players: 3 });
    const s = sheetOf('staff', [mine, booking({ time: 380, players: 1 })]);
    expect(checkBooking(c, s, { ...req, audience: 'staff', players: 3 })).toBe('6:20 AM is full.');
    expect(checkBooking(c, s, { ...req, audience: 'staff', players: 3, movingBookingId: 'MINE' })).toBeNull();
  });
  it('refuses public bookings on days without rates', () => {
    const noRates = course({ rates: [] });
    const s = buildSheet(noRates, { layoutId: 'L18', day: '2026-11-23', bookings: [], blocks: [], now, audience: 'public' });
    expect(checkBooking(noRates, s, req)).toBe('The course has not set its rates for this day yet.');
  });
});

describe('member features (MaisonClub)', () => {
  const now = at('2026-11-20', '12:00');
  const blocks = [block({ kind: 'members', reason: 'Members', from: 360, to: 400 })];
  it('are switched off for partner courses: member-only times are ignored', () => {
    const sheet = buildSheet(course(), { layoutId: 'L18', day: '2026-11-23', bookings: [], blocks, now, audience: 'public' });
    expect(sheet.find((s) => s.time === 360)!.state).toBe('open');
  });
  it('work when switched on: members book member-only times and further ahead', () => {
    const c = course({ memberFeatures: true, rules: { ...course().rules, memberDaysAhead: 14 } });
    const pub = buildSheet(c, { layoutId: 'L18', day: '2026-11-23', bookings: [], blocks, now, audience: 'public' });
    const mem = buildSheet(c, { layoutId: 'L18', day: '2026-11-23', bookings: [], blocks, now, audience: 'member' });
    expect(pub.find((s) => s.time === 360)!.state).toBe('members');
    expect(mem.find((s) => s.time === 360)!.state).toBe('open');
    const far = buildSheet(c, { layoutId: 'L18', day: '2026-12-02', bookings: [], blocks: [], now, audience: 'member' });
    expect(far[0].state).toBe('open');
    const farPub = buildSheet(c, { layoutId: 'L18', day: '2026-12-02', bookings: [], blocks: [], now, audience: 'public' });
    expect(farPub[0].state).toBe('not_released');
  });
});

describe('rates', () => {
  const c = course({ rules: { ...course().rules, twilightFrom: 450 } });
  it('picks the day type, falling back from holiday to weekend and from twilight to regular', () => {
    expect(dayType('2026-11-23', c.holidays)).toBe('weekday');
    expect(dayType('2026-11-21', c.holidays)).toBe('weekend');
    expect(dayType('2026-12-25', c.holidays)).toBe('holiday');
    expect(priceFor(c, 'PUB', 18, '2026-11-23', 400)).toBe(250000);
    expect(priceFor(c, 'PUB', 18, '2026-11-23', 460)).toBe(180000);
    expect(priceFor(c, 'PUB', 18, '2026-11-21', 460)).toBe(350000);
    expect(priceFor(c, 'PUB', 18, '2026-12-25', 400)).toBe(350000);
    expect(priceFor(c, 'PUB', 9, '2026-11-23', 400)).toBeNull();
  });
  it('uses the newest rate in force on the day', () => {
    const later = course();
    later.rates.push({ playerTypeId: 'PUB', dayType: 'weekday', holes: 18, band: 'regular', amount: 280000, effectiveFrom: '2026-12-01' });
    expect(priceFor(later, 'PUB', 18, '2026-11-30', 400)).toBe(250000);
    expect(priceFor(later, 'PUB', 18, '2026-12-01', 400)).toBe(280000);
  });
});

describe('booking status', () => {
  it('allows only the defined changes', () => {
    expect(canChange('held', 'confirmed')).toBe(true);
    expect(canChange('confirmed', 'checked_in')).toBe(true);
    expect(canChange('no_show', 'checked_in')).toBe(true);
    expect(canChange('cancelled', 'confirmed')).toBe(false);
    expect(canChange('played', 'cancelled')).toBe(false);
    expect(canChange('held', 'checked_in')).toBe(false);
  });
  it('knows which bookings take a slot and which are still open for the golfer', () => {
    const now = 1_000;
    expect(takesSlot({ status: 'held', holdExpiresAt: 2_000 }, now)).toBe(true);
    expect(takesSlot({ status: 'held', holdExpiresAt: 500 }, now)).toBe(false);
    expect(takesSlot({ status: 'no_show', holdExpiresAt: null }, now)).toBe(true);
    expect(isOpen({ status: 'checked_in', holdExpiresAt: null }, now)).toBe(false);
  });
  it('lets golfers change a booking only before the cutoff', () => {
    const c = course(); // 24 hours
    const b = { day: '2026-11-23', time: 420, status: 'confirmed' as const };
    expect(golferCanChange(c, b, at('2026-11-22', '07:00'))).toBe(true);
    expect(golferCanChange(c, b, at('2026-11-22', '07:01'))).toBe(false);
  });
  it('makes readable reference codes', () => {
    const ref = newRef((n) => new Uint8Array(n).map((_, i) => i * 7));
    expect(ref).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
});

describe('paying by a deadline', () => {
  const MON = '2026-11-23';
  const rules = (r: Partial<CourseSetup['rules']>) => course({ rules: { ...course().rules, ...r } });
  it('has no deadline unless the club sets one, and none for staff bookings', () => {
    expect(payDeadline(course(), { day: MON, time: 420, channel: 'phone' }, at('2026-11-20', '12:00'))).toBeNull();
    expect(payDeadline(rules({ payBeforeMinutes: 30 }), { day: MON, time: 420, channel: 'staff' }, at('2026-11-20', '12:00'))).toBeNull();
  });
  it('takes the earlier of the time before the tee time and the days after booking, never after the tee time', () => {
    const c = rules({ payBeforeMinutes: 30, payWithinDays: 1 });
    expect(payDeadline(c, { day: MON, time: 420, channel: 'phone' }, at('2026-11-20', '12:00'))).toBe(at('2026-11-21', '12:00'));
    expect(payDeadline(c, { day: MON, time: 420, channel: 'app' }, at('2026-11-23', '05:00'))).toBe(at(MON, '06:30'));
    expect(payDeadline(rules({ payWithinDays: 3 }), { day: MON, time: 420, channel: 'viber' }, at('2026-11-22', '12:00'))).toBe(at(MON, '07:00'));
  });
  it('asks same-day walk-ins and late phone bookings to pay on the spot; late app bookings pay before teeing off', () => {
    const c = rules({ payBeforeMinutes: 60 });
    expect(mustPayNow(c, { day: MON, time: 900, channel: 'walkin' }, at(MON, '06:00'))).toBe(true);
    expect(mustPayNow(c, { day: '2026-11-24', time: 900, channel: 'walkin' }, at(MON, '06:00'))).toBe(false);
    expect(mustPayNow(c, { day: MON, time: 420, channel: 'phone' }, at(MON, '06:30'))).toBe(true);
    expect(mustPayNow(c, { day: MON, time: 420, channel: 'phone' }, at(MON, '05:30'))).toBe(false);
    expect(dueByNow(c, { day: MON, time: 420, channel: 'app' }, at(MON, '06:30'), at(MON, '06:30'))).toBe(at(MON, '07:00'));
  });
  it('counts an app booking never paid, whose tee time went by, as a no-show', () => {
    const c = rules({ payBeforeMinutes: 60 });
    const b = { day: MON, time: 420, status: 'confirmed' as const, channel: 'app' as const, payDueBy: at(MON, '06:00'), payStatus: 'unpaid' };
    expect(lapsedUnpaid(c, b, at(MON, '06:30'))).toBe(false);
    expect(lapsedUnpaid(c, b, at(MON, '07:01'))).toBe(true);
    expect(lapsedUnpaid(c, { ...b, payStatus: 'paid_course' }, at(MON, '07:01'))).toBe(false);
    expect(lapsedUnpaid(c, { ...b, channel: 'phone' }, at(MON, '07:01'))).toBe(false);
  });
});

import { priceFor } from './pricing';
import { takesSlot } from './status';
import { addDays, daysBetween, formatDay, formatTime, localParts, zonedEpoch } from './time';
import type { Audience, Block, Booking, CourseSetup, Day, Layout, Minutes, SheetSettings, Slot } from './types';
import { DEFAULT_OPTIONS } from './types';

/** The settings in force for a layout on a day: the latest whose effectiveFrom is on or before it. */
export function settingsFor(setup: CourseSetup, layoutId: string, day: Day): SheetSettings | null {
  let best: SheetSettings | null = null;
  for (const s of setup.settings) {
    if (s.layoutId !== layoutId || s.effectiveFrom > day) continue;
    if (!best || s.effectiveFrom > best.effectiveFrom) best = s;
  }
  return best;
}

/** The tee times on a day for a layout: first to last tee, every interval. */
export function teeTimes(s: SheetSettings): Minutes[] {
  const out: Minutes[] = [];
  if (s.interval <= 0) return out;
  for (let t = s.firstTee; t <= s.lastTee; t += s.interval) out.push(t);
  return out;
}

/** Problems with a layout's settings, in plain words; empty when they are fine. */
export function checkSettings(s: Pick<SheetSettings, 'firstTee' | 'lastTee' | 'interval' | 'maxPlayers'>): string[] {
  const p: string[] = [];
  if (!(s.interval >= 5 && s.interval <= 30)) p.push('The interval between flights should be 5 to 30 minutes.');
  if (!(s.firstTee >= 4 * 60 && s.firstTee <= 20 * 60)) p.push('The first tee time should be between 4:00 AM and 8:00 PM.');
  if (!(s.lastTee >= s.firstTee && s.lastTee < 24 * 60)) p.push('The last tee time must be after the first.');
  if (!(s.maxPlayers >= 1 && s.maxPlayers <= 5)) p.push('A flight is 1 to 5 players.');
  return p;
}

/** The last day the public can book right now, and when the next day opens. */
export function publicWindow(setup: CourseSetup, now: number): { today: Day; lastDay: Day; nextOpens: { day: Day; at: Minutes; opensOn: Day } } {
  const { day: today, minutes } = localParts(now, setup.timeZone);
  const r = setup.rules;
  const lastDay = addDays(today, minutes >= r.releaseTime ? r.publicDaysAhead : r.publicDaysAhead - 1);
  const next = addDays(lastDay, 1);
  return { today, lastDay, nextOpens: { day: next, at: r.releaseTime, opensOn: addDays(next, -r.publicDaysAhead) } };
}

/** When a day opens to the public, in words: "Bookings for Saturday, 28 November open on Saturday, 21 November at 7:00 AM." */
export function opensMessage(setup: CourseSetup, day: Day): string {
  const opensOn = addDays(day, -setup.rules.publicDaysAhead);
  return `Bookings for ${formatDay(day)} open on ${formatDay(opensOn)} at ${formatTime(setup.rules.releaseTime)}.`;
}

/** Does a block cover this slot right now? Held-back blocks with a release time stop applying once it has passed. */
export function blockOn(blocks: Block[], layoutId: string, startTee: string, day: Day, time: Minutes, now: number, memberFeatures: boolean): Block | null {
  let found: Block | null = null;
  for (const b of blocks) {
    if (b.day !== day || time < b.from || time >= b.to) continue;
    if (b.layoutId !== null && b.layoutId !== layoutId) continue;
    if (b.startTee !== null && b.startTee !== startTee) continue;
    if (b.kind === 'members' && !memberFeatures) continue;
    if (b.releaseAt !== null && now >= b.releaseAt && (b.kind === 'walkin' || b.kind === 'regulars' || b.kind === 'event' || b.kind === 'members')) continue;
    // A closure wins over a hold.
    if (!found || isClosure(b)) found = b;
    if (isClosure(b)) break;
  }
  return found;
}

/**
 * Times nobody can book, staff included: closed for maintenance or weather, or blocked for an event or
 * tournament. Holds for walk-ins and regulars are pencil bookings: staff can still book into them.
 */
export const isClosure = (b: Pick<Block, 'kind'>) => b.kind === 'maintenance' || b.kind === 'weather' || b.kind === 'event';

export interface SheetInput {
  layoutId: string;
  day: Day;
  bookings: Booking[];
  blocks: Block[];
  now: number;
  audience: Audience;
}

/**
 * The day's tee sheet for one layout, worked out from the settings, the bookings that take up slots,
 * and the holds and closures. Nothing here is stored. The public never sees who is booked.
 */
export function buildSheet(setup: CourseSetup, input: SheetInput): Slot[] {
  const layout = setup.layouts.find((l) => l.id === input.layoutId);
  if (!layout || !layout.active) return [];
  const s = settingsFor(setup, layout.id, input.day);
  if (!s) return [];
  const { now, day, audience } = input;
  const win = publicWindow(setup, now);
  const beyondPublic = daysBetween(win.lastDay, day) > 0;
  const beyondMember = setup.memberFeatures && setup.rules.memberDaysAhead !== null
    ? daysBetween(addDays(win.today, setup.rules.memberDaysAhead), day) > 0 : beyondPublic;
  const active = input.bookings.filter((b) => b.layoutId === layout.id && b.day === day && takesSlot(b, now));
  const out: Slot[] = [];
  for (const time of teeTimes(s)) {
    const past = zonedEpoch(day, time, setup.timeZone) <= now;
    for (const startTee of layout.startTees) {
      const on = active.filter((b) => b.startTee === startTee && b.time === time);
      const used = on.reduce((n, b) => n + b.players, 0);
      const block = blockOn(input.blocks, layout.id, startTee, day, time, now, setup.memberFeatures);
      const capacity = s.maxPlayers;
      let state: Slot['state'];
      if (past) state = 'past';
      else if (block && isClosure(block)) state = 'closed';
      else if (used >= capacity) state = 'full';
      else if (block && block.kind === 'members') state = audience === 'member' ? (used ? 'partial' : 'open') : 'members';
      else if (block) state = 'held';
      else if (audience === 'public' && beyondPublic) state = 'not_released';
      else if (audience === 'member' && beyondMember) state = 'not_released';
      else state = used ? 'partial' : 'open';
      out.push({
        layoutId: layout.id, startTee, day, time, capacity, used, free: Math.max(0, capacity - used), state, block,
        bookings: audience === 'staff' ? on : [],
      });
    }
  }
  return out;
}

export interface BookingRequest {
  layoutId: string;
  startTee: string;
  day: Day;
  time: Minutes;
  players: number;
  audience: Audience;
  /** App bookings: the golfer's bookings still ahead, and no-shows in the last 90 days. */
  golferOpenBookings?: number;
  golferRecentNoShows?: number;
  /** Moving an existing booking: its own players don't count against the slot. */
  movingBookingId?: string;
}

/**
 * Can this booking go on the sheet? null = yes; otherwise the reason, in words the person can act on.
 * Run it on the sheet worked out inside the same database transaction that locks the slot.
 */
export function checkBooking(setup: CourseSetup, sheet: Slot[], r: BookingRequest): string | null {
  const layout: Layout | undefined = setup.layouts.find((l) => l.id === r.layoutId);
  if (!layout || !layout.active) return 'That layout is not open for booking.';
  const slot = sheet.find((x) => x.startTee === r.startTee && x.time === r.time && x.day === r.day && x.layoutId === r.layoutId);
  const at = `${formatTime(r.time)}${layout.startTees.length > 1 ? ` (tee ${r.startTee})` : ''}`;
  if (!slot) return `There is no tee time at ${at} on ${formatDay(r.day)}.`;
  if (!Number.isInteger(r.players) || r.players < 1) return 'A booking needs at least 1 player.';
  const maxPlayers = r.audience === 'staff' ? slot.capacity : Math.min(slot.capacity, setup.rules.maxPlayersPerBooking);
  if (r.players > maxPlayers) return `A booking can have at most ${maxPlayers} players.`;
  if (slot.state === 'past') return `${at} on ${formatDay(r.day)} has already passed.`;
  if (slot.state === 'closed' && slot.block?.kind === 'event') return `${at} is blocked for ${slot.block.reason && slot.block.reason !== 'Event' ? slot.block.reason : 'an event'}.`;
  if (slot.state === 'closed') return `${at} is closed${slot.block?.reason ? `: ${slot.block.reason}` : ''}.`;
  if (r.audience !== 'staff') {
    if (slot.state === 'held') return `${at} is not available for booking.`;
    if (slot.state === 'members') return `${at} is for members only.`;
    if (slot.state === 'not_released') return opensMessage(setup, r.day);
    if ((r.golferRecentNoShows ?? 0) >= setup.rules.noShowLimit && setup.rules.noShowLimit > 0) {
      return 'App booking is paused on your account because of missed tee times. Call the course to book.';
    }
    if (!r.movingBookingId && (r.golferOpenBookings ?? 0) >= setup.rules.maxOpenBookingsPerGolfer) {
      return `You can have up to ${setup.rules.maxOpenBookingsPerGolfer} bookings at this course at a time.`;
    }
  }
  const mine = r.movingBookingId ? slot.bookings.filter((b) => b.id === r.movingBookingId).reduce((n, b) => n + b.players, 0) : 0;
  const free = slot.free + mine;
  if (r.players > free) return free === 0 ? `${at} is full.` : `Only ${free} ${free === 1 ? 'spot is' : 'spots are'} left at ${at}.`;
  if (r.audience !== 'staff') {
    const pub = setup.playerTypes.find((p) => p.public);
    if (pub && priceFor(setup, pub.id, layout.holes, r.day, r.time) === null) return 'The course has not set its rates for this day yet.';
  }
  return null;
}

/** A sensible starting setup for a new course, changed in Course setup before going live. */
export function starterSetup(ids: { layoutId: string; localTypeId: string; foreignTypeId: string }, today: Day, timeZone = 'Asia/Manila'): Omit<CourseSetup, 'rules'> {
  const type = (id: string, name: string, proof: string) => ({ id, name, public: true, member: false, proof, days: [], earliest: null, active: true });
  return {
    timeZone,
    layouts: [{ id: ids.layoutId, name: '18 holes', holes: 18, startTees: ['1'], active: true }],
    settings: [{ layoutId: ids.layoutId, effectiveFrom: today, firstTee: 6 * 60, lastTee: 14 * 60, interval: 8, maxPlayers: 4 }],
    holidays: [],
    playerTypes: [type(ids.localTypeId, 'Local', ''), type(ids.foreignTypeId, 'Foreign', 'Passport')],
    rates: [],
    fees: [],
    options: { ...DEFAULT_OPTIONS },
    memberFeatures: false,
  };
}

import { counterSplit } from './quote';
import { zonedEpoch } from './time';
import type { Booking, BookingStatus, CourseSetup } from './types';

/**
 * A pencil booking: confirmed but unpaid past the club's payment grace period. It stays on the sheet for
 * staff to follow up, but no longer takes its spots, so others can book the time.
 */
export function isPencil(b: Pick<Booking, 'status' | 'payDueBy'>, now: number): boolean {
  return b.status === 'confirmed' && b.payDueBy !== undefined && b.payDueBy !== null && b.payDueBy <= now;
}

type Payable = { quote?: { amount: number; payAt: string; label?: string; kind?: string }[] | null; amount: number; channel?: string };

/**
 * What the counter collects for a booking. Staff bookings: the lines paid with the booking. App bookings
 * (paid at the course for now): those plus the fees paid at the counter, but never the caddie fee. Bookings
 * made before prices were kept line by line owe their whole amount.
 */
export function dueWithBooking(b: Payable): number {
  return b.quote?.length ? counterSplit(b.quote, b.channel === 'app').total : b.amount;
}

/** A booking can be checked in only once it's paid (or when nothing is paid with the booking). */
export function paidForCheckIn(b: Payable & { payStatus: string }): boolean {
  return b.payStatus !== 'unpaid' || dueWithBooking(b) === 0;
}

/** Bookings that take up their slot: an unexpired hold, or anything confirmed or after (but not a pencil booking). */
export function takesSlot(b: Pick<Booking, 'status' | 'holdExpiresAt'> & { payDueBy?: number | null }, now: number): boolean {
  if (b.status === 'held') return b.holdExpiresAt !== null && b.holdExpiresAt > now;
  if (isPencil({ status: b.status, payDueBy: b.payDueBy }, now)) return false;
  return b.status === 'confirmed' || b.status === 'checked_in' || b.status === 'played' || b.status === 'no_show';
}

/** Still ahead of the golfer: counts toward their open-bookings limit. */
export function isOpen(b: Pick<Booking, 'status' | 'holdExpiresAt'>, now: number): boolean {
  return (b.status === 'held' && takesSlot(b, now)) || b.status === 'confirmed';
}

/**
 * Which status changes are allowed. Staff can also undo a check-in or a no-show (a golfer who
 * arrived late); a cancelled, expired or played booking is final.
 */
const NEXT: Record<BookingStatus, BookingStatus[]> = {
  held: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['played', 'confirmed'],
  no_show: ['checked_in', 'confirmed'],
  played: [],
  cancelled: [],
  expired: [],
};

export function canChange(from: BookingStatus, to: BookingStatus): boolean {
  return NEXT[from].includes(to);
}

export const STATUS_WORDS: Record<BookingStatus, string> = {
  held: 'Held', confirmed: 'Confirmed', checked_in: 'Checked in', played: 'Played', cancelled: 'Cancelled', no_show: 'No-show', expired: 'Expired',
};

/** The tee time as a moment (epoch ms). */
export function teeMoment(setup: CourseSetup, b: Pick<Booking, 'day' | 'time'>): number {
  return zonedEpoch(b.day, b.time, setup.timeZone);
}

/** Can the golfer still cancel or move it themselves? (Staff always can, before it is played.) */
export function golferCanChange(setup: CourseSetup, b: Pick<Booking, 'day' | 'time' | 'status'>, now: number): boolean {
  if (b.status !== 'confirmed' && b.status !== 'held') return false;
  return teeMoment(setup, b) - now >= setup.rules.cancelCutoffHours * 3_600_000;
}

const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** A short booking reference golfers can read out on the phone, e.g. "K7QM4P" (no 0/O or 1/I). */
export function newRef(random: (n: number) => Uint8Array): string {
  const b = random(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_CHARS[b[i] % REF_CHARS.length];
  return s;
}

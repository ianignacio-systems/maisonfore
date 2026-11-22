import type { BookingStatus, CourseSetup, QuoteLine } from '@maison/engine';
import { token } from './auth';

// The server's address. Unset in a built app = the address the app is served from (the Render test site).
const BASE = ((import.meta.env.VITE_SERVER_URL as string | undefined) || (import.meta.env.DEV ? 'http://localhost:8787' : '')).replace(/\/$/, '');

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const t = await token();
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/v1/golf${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: `Bearer ${t}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new Error('Can’t reach MaisonFore. Check your internet connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Something went wrong. Try again.');
  return data as T;
}

export interface Profile { name: string; mobile: string; residency: 'local' | 'foreign' }
export interface Me { email: string; profile: Profile | null }
export interface CourseCard {
  id: string; slug: string; name: string; city: string; province: string; description: string; facilities: string[];
  day: string; fromPrice: number | null; openSlots: number; nextTimes: number[]; notYet: string | null; holes: number[];
}
export interface CoursePage {
  course: { id: string; slug: string; name: string; address: string; city: string; province: string; phone: string; description: string; facilities: string[] };
  window: { today: string; lastDay: string };
  setup: CourseSetup;
}
export interface OpenSlot { time: number; startTee: string; free: number; capacity: number }
/** One tee time as golfers see it: the same time on every starting tee, shown once. */
export interface TeeTime { time: number; free: number; tees: OpenSlot[] }

/**
 * Courses that start on two tees (1 and 10) have each time twice. Golfers book a time, not a tee:
 * show each time once, with the most room on any tee, in the course's tee order.
 */
export function teeTimes(slots: OpenSlot[], startTees: string[]): TeeTime[] {
  const by = new Map<number, OpenSlot[]>();
  for (const x of slots) by.set(x.time, [...(by.get(x.time) ?? []), x]);
  const order = (t: string) => { const i = startTees.indexOf(t); return i < 0 ? 99 : i; };
  return [...by].sort((a, b) => a[0] - b[0]).map(([time, tees]) => ({ time, tees: tees.sort((a, b) => order(a.startTee) - order(b.startTee)), free: Math.max(...tees.map((x) => x.free)) }));
}

/** The starting tee for a group of this size: the first tee, in the course's order, with room for all of them. */
export function teeFor(t: TeeTime, players: number): OpenSlot {
  return t.tees.find((x) => x.free >= players) ?? t.tees[0];
}
export interface Times { day: string; notYet: string | null; layouts: { id: string; name: string; holes: 9 | 18; startTees: string[]; slots: OpenSlot[] }[] }
export interface MyBooking {
  id: string; ref: string; day: string; time: number; players: number; holes: number; status: BookingStatus; statusWords: string;
  amount: number; quote: QuoteLine[]; payStatus: string; carts: number; caddies: number; gallery: number;
  course: { slug: string; name: string; phone: string }; layoutName: string; startTee: string;
  roster: { name: string; type: string }[]; upcoming: boolean; canChange: boolean; cutoffHours: number;
  /** Unpaid: arrive and pay by this time (the course's clock), on payByDay. lapsed = not paid in time, open to others. */
  payDueBy: number | null; payBy: string | null; payByDay: string | null; lapsed: boolean;
}

/** Waiting for a time at a course on a day; `offer` is a time held for the golfer to book before `until`. */
export interface WaitEntry {
  id: string; day: string; from: number; to: number; players: number; status: 'waiting' | 'offered' | 'missed';
  course: { name: string; slug: string };
  offer: { layoutId: string; startTee: string; time: number; free: number; until: number } | null;
}
export interface Inbox { unread: number; messages: { id: string; kind: string; title: string; body: string; link: string; at: number; read: boolean }[] }

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
export interface Times { day: string; notYet: string | null; layouts: { id: string; name: string; holes: 9 | 18; startTees: string[]; slots: OpenSlot[] }[] }
export interface MyBooking {
  id: string; ref: string; day: string; time: number; players: number; holes: number; status: BookingStatus; statusWords: string;
  amount: number; quote: QuoteLine[]; payStatus: string; carts: number; caddies: number; gallery: number;
  course: { slug: string; name: string; phone: string }; layoutName: string; startTee: string;
  roster: { name: string; type: string }[]; upcoming: boolean; canChange: boolean; cutoffHours: number;
}

import type { CourseSetup, Layout, Slot, Booking, Block, QuoteLine } from '@maison/engine';
import { token } from './auth';

// The server's address. Unset in a built portal = the same address the portal is served from (the Render test site).
const BASE = ((import.meta.env.VITE_SERVER_URL as string | undefined) || (import.meta.env.DEV ? 'http://localhost:8787' : '')).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Calls the MaisonFore server; its error messages are written to be shown as they are. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const t = await token();
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: `Bearer ${t}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('Can’t reach MaisonFore. Check the internet connection.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? 'Something went wrong. Try again.', res.status);
  return data as T;
}

export type Role = 'owner' | 'manager' | 'starter' | 'viewer';
export type CourseStatus = 'draft' | 'review' | 'live' | 'paused' | 'declined';
export interface Me { account: { id: string; email: string }; courses: { id: string; name: string; slug: string; role: Role; status: CourseStatus }[]; admin: boolean }
export interface Course {
  id: string; name: string; slug: string; status: CourseStatus; address: string; city: string; province: string; phone: string; email: string;
  description: string; facilities: string[]; reviewNote: string; submittedAt: number | null; timeZone: string;
}
export interface CourseData { course: Course; role: Role; setup: CourseSetup; readiness: { step: string; done: boolean }[]; holidayNames?: Record<string, string> }
export interface StaffBooking extends Booking {
  mobile: string; email: string; notes: string; amount: number; payStatus: string; paidAmount: number; paidMethod: string;
  holes: 9 | 18; carts: number; caddies: number; gallery: number; extras: string[]; quote: QuoteLine[]; payInApp: number;
}
export interface DaySummary { day: string; used: number; capacity: number; bookings: number; closed: boolean }
export interface SheetData {
  unchanged: false; seq: number; day: string; now: number; timeZone: string;
  layouts: { layout: Layout; slots: StaffSlot[] }[];
  blocks: Block[]; loose: StaffBooking[];
}
export type SheetReply = SheetData | { unchanged: true; seq: number };
export type StaffSlot = Omit<Slot, 'bookings'> & { bookings: StaffBooking[] };

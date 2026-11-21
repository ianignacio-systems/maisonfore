import { UserError } from '@maison/core';

/** Small checks on what the portal sends, with messages a person can act on. */
export function text(v: unknown, what: string, o: { max?: number; required?: boolean } = {}): string {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (o.required && !s) throw new UserError(`Enter ${what}.`);
  if (s.length > (o.max ?? 200)) throw new UserError(`${cap(what)} is too long (at most ${o.max ?? 200} characters).`);
  return s;
}

export function int(v: unknown, what: string, min: number, max: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n) || (n as number) < min || (n as number) > max) throw new UserError(`${cap(what)} must be a whole number from ${min} to ${max}.`);
  return n as number;
}

export function oneOf<T extends string>(v: unknown, what: string, options: readonly T[]): T {
  if (typeof v !== 'string' || !options.includes(v as T)) throw new UserError(`Choose ${what}.`);
  return v as T;
}

export function day(v: unknown, what = 'a date'): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new UserError(`Enter ${what} (YYYY-MM-DD).`);
  return v;
}

export function minutes(v: unknown, what: string): number {
  return int(v, what, 0, 24 * 60 - 1);
}

export function mobile(v: unknown): string {
  const s = text(v, 'the mobile number', { max: 20 }).replace(/[\s-]/g, '');
  if (!s) return '';
  const m = s.match(/^(?:\+?63|0)?(9\d{9})$/);
  if (!m) throw new UserError('Enter a Philippine mobile number, e.g. 0917 123 4567.');
  return `+63${m[1]}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

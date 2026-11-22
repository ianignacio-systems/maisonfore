import { formatTime, weekday } from './time';
import { dayType, peso, priceFor } from './pricing';
import type { CourseSetup, Day, Fee, Minutes, PaidTo, PlayerType } from './types';

/** What is being booked, for a price. */
export interface QuoteRequest {
  layoutId: string;
  day: Day;
  time: Minutes;
  /** 9 or 18; a 9-hole layout is always 9. */
  holes: 9 | 18;
  /** The player type of each player, in order. */
  players: string[];
  /** Carts wanted. Where carts are required, at least enough for everyone is charged. */
  carts?: number;
  /** Caddies wanted, where caddies are optional. Where required, every player has one. */
  caddies?: number;
  /** Non-playing guests. */
  gallery?: number;
  /** Optional fees chosen (ids), for fees of kind 'other'. */
  extras?: string[];
}

export interface QuoteLine {
  key: string;
  label: string;
  /** e.g. "2 × ₱3,000.00 + 1 × ₱4,000.00" */
  detail: string;
  qty: number;
  amount: number;
  /** Paid with the booking, separately at the counter, or straight to the caddie (a minimum). */
  payAt: PaidTo;
  feeId: string | null;
}

export interface Quote {
  holes: 9 | 18;
  lines: QuoteLine[];
  total: number;
  /** The part paid with the booking (green fees and fees paid with them). */
  payInApp: number;
  carts: number;
  caddies: number;
  gallery: number;
  /** Things to sort out: a missing rate, a player type outside its days or hours. */
  problems: string[];
}

const DAY_WORDS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** The holes a booking on this layout can be: [18, 9] when 9-hole rounds are allowed on an 18-hole layout. */
export function holesOffered(setup: CourseSetup, layoutId: string): (9 | 18)[] {
  const l = setup.layouts.find((x) => x.id === layoutId);
  if (!l || l.holes === 9) return [9];
  return setup.options.nineHoles ? [18, 9] : [18];
}

/** Why a player type can't play this day and time, or null. */
export function playerTypeProblem(t: PlayerType, day: Day, time: Minutes): string | null {
  if (!t.active) return `${t.name} is switched off.`;
  if (t.days.length && t.days.length < 7 && !t.days.includes(weekday(day))) {
    return `${t.name} rates are for ${listWords([...t.days].sort().map((d) => DAY_WORDS[d]))} only.`;
  }
  if (t.earliest !== null && time < t.earliest) return `${t.name} tee time starts at ${formatTime(t.earliest)}.`;
  return null;
}

/**
 * A fee's amount for one player type (or for everyone when null), holes and day type. The most specific
 * amount wins: this player type over every type, this day type over weekday (a fee with no weekend
 * amount costs the same every day), and this many holes over 18 (no 9-hole amount = the 18-hole one).
 */
export function feeAmount(fee: Fee, holes: 9 | 18, dt: 'weekday' | 'weekend', playerTypeId: string | null): number | null {
  const tries: [9 | 18, 'weekday' | 'weekend', string | null][] = [];
  for (const h of holes === 9 ? [9, 18] as const : [18] as const) {
    for (const t of playerTypeId ? [playerTypeId, null] : [null]) {
      tries.push([h, dt, t]);
      if (dt === 'weekend') tries.push([h, 'weekday', t]);
    }
  }
  for (const [h, d, t] of tries) {
    const a = fee.amounts.find((x) => x.holes === h && x.dayType === d && x.playerTypeId === t);
    if (a) return a.amount;
  }
  return null;
}

/** What a booking costs, line by line: green fees by player type, then carts, caddies, gallery and other fees. */
export function quote(setup: CourseSetup, r: QuoteRequest): Quote {
  const offered = holesOffered(setup, r.layoutId);
  const holes = offered.includes(r.holes) ? r.holes : offered[0];
  const n = r.players.length;
  const dt = dayType(r.day, setup.holidays) === 'weekday' ? 'weekday' : 'weekend';
  const typeOf = new Map(setup.playerTypes.map((t) => [t.id, t]));
  const lines: QuoteLine[] = [];
  const problems: string[] = [];

  // Green fees, one line per player type.
  const counts = new Map<string, number>();
  for (const id of r.players) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, count] of counts) {
    const t = typeOf.get(id);
    if (!t) { problems.push('Pick a player type for every player.'); continue; }
    const p = playerTypeProblem(t, r.day, r.time);
    if (p) problems.push(p);
    const each = priceFor(setup, id, holes, r.day, r.time);
    if (each === null) problems.push(`There is no ${holes}-hole ${dayType(r.day, setup.holidays)} green fee for ${t.name} yet.`);
    lines.push({ key: `green:${id}`, label: `Green fee, ${t.name}`, detail: `${count} × ${peso(each ?? 0)}`, qty: count, amount: (each ?? 0) * count, payAt: 'booking', feeId: null });
  }

  const fees = setup.fees.filter((f) => f.active);
  const pick = (kind: Fee['kind']) => fees.find((f) => f.kind === kind);
  const clamp = (v: number | undefined, max: number) => Math.max(0, Math.min(max, Math.floor(v ?? 0)));

  const cart = pick('cart');
  const seats = Math.max(1, setup.options.cartSeats);
  const carts = !cart ? 0 : cart.required ? Math.max(Math.ceil(n / seats), clamp(r.carts, n)) : clamp(r.carts, n);
  const caddie = pick('caddie');
  const caddies = !caddie ? 0 : caddie.required ? n : clamp(r.caddies, n);
  const gallery = clamp(r.gallery, setup.options.galleryMax);
  // Gallery is switched on by the most-guests setting (0 = no gallery); its fee is charged whenever guests are allowed.
  const galleryFee = setup.options.galleryMax > 0 ? (pick('gallery') ?? setup.fees.find((f) => f.kind === 'gallery')) : undefined;

  const counted = (f: Fee, qty: number, label: string) => {
    if (!qty) return;
    const each = feeAmount(f, holes, dt, null);
    if (each === null) problems.push(`${f.name} has no amount for ${holes} holes yet.`);
    lines.push({ key: `fee:${f.id}`, label, detail: `${qty} × ${peso(each ?? 0)}`, qty, amount: (each ?? 0) * qty, payAt: f.paidTo, feeId: f.id });
  };
  if (cart) counted(cart, carts, carts === 1 ? cart.name : `${cart.name} (${carts} carts)`);
  if (caddie) counted(caddie, caddies, caddies === 1 ? caddie.name : `${caddie.name} (${caddies} caddies)`);
  if (galleryFee) counted(galleryFee, gallery, gallery === 1 ? galleryFee.name : `${galleryFee.name} (${gallery} guests)`);

  // Other fees: per player (each at their own player type's amount) or once per booking.
  const chosen = new Set(r.extras ?? []);
  for (const f of fees.filter((x) => x.kind === 'other' && (x.required || chosen.has(x.id)))) {
    if (f.per === 'booking' || f.per === 'cart' || f.per === 'guest') {
      counted(f, f.per === 'booking' ? 1 : f.per === 'cart' ? carts : gallery, f.name);
      continue;
    }
    let amount = 0;
    const parts: string[] = [];
    let missing = false;
    // A fee set per player type charges nothing to the types left out (e.g. a fee for foreigners only).
    const byType = f.amounts.some((a) => a.playerTypeId !== null);
    for (const [id, count] of counts) {
      const each = feeAmount(f, holes, dt, id);
      if (each === null && !byType) missing = true;
      amount += (each ?? 0) * count;
      if (each !== null) parts.push(`${count} × ${peso(each)}`);
    }
    if (missing) problems.push(`${f.name} has no amount for ${holes} holes yet.`);
    if (n && (amount || missing)) lines.push({ key: `fee:${f.id}`, label: f.name, detail: byType ? parts.join(' + ') : `${n} × ${peso(feeAmount(f, holes, dt, null) ?? 0)}`, qty: n, amount, payAt: f.paidTo, feeId: f.id });
  }

  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { holes, lines, total, payInApp: lines.filter((l) => l.payAt === 'booking').reduce((s, l) => s + l.amount, 0), carts, caddies, gallery, problems: [...new Set(problems)] };
}

function listWords(ws: string[]): string {
  return ws.length <= 1 ? ws.join('') : `${ws.slice(0, -1).join(', ')} and ${ws.at(-1)}`;
}

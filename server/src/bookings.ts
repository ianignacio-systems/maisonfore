import { randomBytes } from 'node:crypto';
import { audit, newId, NotFound, UserError, type Caller, type Db } from '@maison/core';
import {
  addDays, buildSheet, canChange, checkBooking, daysBetween, formatDay, formatTime, localParts, newRef, priceFor, quote, STATUS_WORDS, takesSlot, teeMoment,
  type Block, type BlockKind, type Booking, type BookingStatus, type Channel, type CourseSetup, type Quote, type QuoteLine, type Slot,
} from '@maison/engine';
import { day, int, minutes, mobile, oneOf, text } from './check';
import { CAN, loadSetup, roleAt } from './courses';

export const BOOKING_COLS = `id, ref, layout_id, start_tee, day, time_min, players, status, channel, hold_expires_at, golfer_account, contact_name, mobile, email, notes,
  amount, pay_status, paid_amount, paid_method, paid_ref, cancel_reason, created_by, created_at, updated_at, holes, carts, caddies, gallery, extras, quote, pay_in_app, special`;

export interface BookingRow extends Booking {
  mobile: string; email: string; notes: string; amount: number; payStatus: 'unpaid' | 'paid_course' | 'paid_online';
  paidAmount: number; paidMethod: string; paidRef: string; cancelReason: string; createdBy: string; createdAt: number; updatedAt: number;
  holes: 9 | 18; carts: number; caddies: number; gallery: number; extras: string[]; quote: QuoteLine[]; payInApp: number;
}

export function bookingOf(r: Record<string, unknown>): BookingRow {
  return {
    id: r.id as string, ref: r.ref as string, layoutId: r.layout_id as string, startTee: r.start_tee as string, day: r.day as string, time: (r.time_min as number | null) ?? -1, special: r.special === true,
    players: r.players as number, status: r.status as BookingStatus, channel: r.channel as Channel, holdExpiresAt: (r.hold_expires_at as number) ?? null,
    golferId: (r.golfer_account as string) ?? null, contactName: r.contact_name as string, mobile: r.mobile as string, email: r.email as string,
    notes: r.notes as string, amount: r.amount as number, payStatus: r.pay_status as BookingRow['payStatus'], paidAmount: r.paid_amount as number,
    paidMethod: r.paid_method as string, paidRef: r.paid_ref as string, cancelReason: r.cancel_reason as string, createdBy: r.created_by as string,
    createdAt: r.created_at as number, updatedAt: r.updated_at as number,
    holes: (r.holes as 9 | 18) ?? 18, carts: Number(r.carts ?? 0), caddies: Number(r.caddies ?? 0), gallery: Number(r.gallery ?? 0),
    extras: (r.extras as string[]) ?? [], quote: (r.quote as QuoteLine[]) ?? [], payInApp: Number(r.pay_in_app ?? 0),
  };
}

function blockOf(r: Record<string, unknown>): Block & { createdBy: string } {
  return {
    id: r.id as string, layoutId: (r.layout_id as string) ?? null, startTee: (r.start_tee as string) ?? null, day: r.day as string, from: r.from_min as number,
    to: r.to_min as number, kind: r.kind as BlockKind, reason: r.reason as string, releaseAt: (r.release_at as number) ?? null, createdBy: r.created_by as string,
  };
}

async function dayBookings(q: Db, courseId: string, d: string, layoutId?: string): Promise<BookingRow[]> {
  const rows = await q.query(`select ${BOOKING_COLS} from bookings where business_id = $1 and day = $2 ${layoutId ? 'and layout_id = $3' : ''} order by time_min, created_at`,
    layoutId ? [courseId, d, layoutId] : [courseId, d]);
  return rows.map(bookingOf);
}

async function dayBlocks(q: Db, courseId: string, d: string): Promise<(Block & { createdBy: string })[]> {
  return (await q.query('select * from blocks where business_id = $1 and day = $2 and removed_at is null order by from_min', [courseId, d])).map(blockOf);
}

/** The highest change number on anything the tee sheet shows. */
async function sheetSeq(db: Db, courseId: string): Promise<number> {
  const [r] = await db.query<{ seq: number }>(
    `select greatest(
       (select coalesce(max(seq), 0) from bookings where business_id = $1),
       (select coalesce(max(seq), 0) from blocks where business_id = $1),
       (select coalesce(max(seq), 0) from courses where business_id = $1),
       (select coalesce(max(seq), 0) from layouts where business_id = $1),
       (select coalesce(max(seq), 0) from sheet_settings where business_id = $1)) as seq`, [courseId]);
  return r.seq;
}

/**
 * The day's tee sheet for staff (TEE-1, PTR-6): every layout's slots with their bookings, holds and
 * closures. With `since`, answers { unchanged: true } when nothing changed, so the screen can ask often.
 */
export async function staffSheet(db: Db, c: Caller, courseId: string, q: { day?: unknown; since?: unknown }, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.view);
  const seq = await sheetSeq(db, courseId);
  if (q.since !== undefined && Number(q.since) === seq) return { unchanged: true as const, seq };
  const setup = await loadSetup(db, courseId);
  const d = q.day ? day(q.day) : localParts(now, setup.timeZone).day;
  const bookings = await dayBookings(db, courseId, d);
  const blocks = await dayBlocks(db, courseId, d);
  const layouts = setup.layouts.filter((l) => l.active).map((l) => ({
    layout: l,
    slots: buildSheet(setup, { layoutId: l.id, day: d, bookings, blocks, now, audience: 'staff' }) as (Slot & { bookings: BookingRow[] })[],
  }));
  return {
    unchanged: false as const, seq, day: d, now, timeZone: setup.timeZone, layouts, blocks,
    // Bookings not on any slot any more (their layout was switched off or its tee times changed): staff must move them.
    // Special bookings (VIPs, members, favours) accepted outside the sheet, in time order, those with no set time first.
    specials: bookings.filter((b) => b.special && b.status !== 'cancelled' && b.status !== 'expired').sort((a, b) => a.time - b.time),
    loose: bookings.filter((b) => !b.special && takesSlot(b, now) && !layouts.some((l) => l.slots.some((s) => s.layoutId === b.layoutId && s.startTee === b.startTee && s.time === b.time))),
  };
}

/** Locks one slot for the rest of the transaction (the row is made the first time the slot is booked). */
async function lockSlot(q: Db, courseId: string, layoutId: string, startTee: string, d: string, time: number) {
  await q.query('insert into slot_locks (business_id, layout_id, start_tee, day, time_min) values ($1, $2, $3, $4, $5) on conflict do nothing', [courseId, layoutId, startTee, d, time]);
  await q.query('select 1 from slot_locks where business_id = $1 and layout_id = $2 and start_tee = $3 and day = $4 and time_min = $5 for update', [courseId, layoutId, startTee, d, time]);
}

interface Wanted { layoutId: string; startTee: string; day: string; time: number; players: number }

function wanted(input: Record<string, unknown>): Wanted {
  return {
    layoutId: text(input.layoutId, 'the layout', { required: true, max: 40 }),
    startTee: text(input.startTee ?? '1', 'the starting tee', { required: true, max: 4 }),
    day: day(input.day, 'the day'),
    time: minutes(input.time, 'the tee time'),
    players: int(input.players, 'the number of players', 1, 5),
  };
}

/** Staff: refuses with the engine's reason when the slot can't take this booking. */
async function checkSlot(q: Db, setup: CourseSetup, courseId: string, w: Wanted, now: number, movingBookingId?: string) {
  const sheet = buildSheet(setup, { layoutId: w.layoutId, day: w.day, bookings: await dayBookings(q, courseId, w.day, w.layoutId), blocks: await dayBlocks(q, courseId, w.day), now, audience: 'staff' });
  const problem = checkBooking(setup, sheet, { ...w, audience: 'staff', movingBookingId });
  if (problem) throw new UserError(problem);
}

/** What the booking includes besides the slot: holes, each player's type, carts, caddies, gallery, optional fees. */
interface Pick { holes: 9 | 18; types: string[]; carts: number; caddies: number; gallery: number; extras: string[] }

function pickOf(setup: CourseSetup, input: Record<string, unknown>, players: number, before?: Pick): Pick {
  const active = setup.playerTypes.filter((t) => t.active);
  const fallback = (active.find((t) => t.public) ?? active[0])?.id ?? '';
  const given = Array.isArray(input.playerTypes) ? input.playerTypes.map((t) => text(t, 'a player type', { max: 40 })) : before?.types ?? [];
  const types = Array.from({ length: players }, (_, i) => given[i] || fallback);
  if (types.some((t) => !active.some((a) => a.id === t))) throw new UserError('Pick a player type the course offers for every player.');
  const n = (v: unknown, label: string, prev: number | undefined) => (v === undefined ? prev ?? 0 : int(v, label, 0, 8));
  return {
    holes: input.holes === undefined ? before?.holes ?? 18 : input.holes === 9 ? 9 : 18,
    types,
    carts: n(input.carts, 'the number of carts', before?.carts),
    caddies: n(input.caddies, 'the number of caddies', before?.caddies),
    gallery: n(input.gallery, 'the number of gallery guests', before?.gallery),
    extras: Array.isArray(input.extras) ? input.extras.map((x) => text(x, 'a fee', { max: 40 })) : before?.extras ?? [],
  };
}

function priceOf(setup: CourseSetup, w: Wanted, p: Pick): Quote {
  return quote(setup, { layoutId: w.layoutId, day: w.day, time: w.time, holes: p.holes, players: p.types, carts: p.carts, caddies: p.caddies, gallery: p.gallery, extras: p.extras });
}

/** The green fee each player pays, by their place in the booking. */
const greenFees = (setup: CourseSetup, w: Wanted, q: Quote, types: string[]) => types.map((t) => priceFor(setup, t, q.holes, w.day, w.time) ?? 0);

async function insertRef(q: Db, courseId: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const ref = newRef((n) => randomBytes(n));
    if (!(await q.query('select 1 from bookings where business_id = $1 and ref = $2', [courseId, ref])).length) return ref;
  }
  throw new Error('Could not make a booking reference.');
}

/**
 * Staff booking (TEE-2, PTR-6): phone, Viber or walk-in, straight onto the sheet. `hold: true` keeps
 * the slot as a hold instead (TEE-3), to be confirmed within the course's hold time.
 */
export async function createBooking(db: Db, c: Caller, courseId: string, input: Record<string, unknown>, now = Date.now()): Promise<BookingRow> {
  await roleAt(db, c, courseId, CAN.daily);
  const w = wanted(input);
  const channel = oneOf(input.channel ?? 'phone', 'how the booking came in', ['phone', 'viber', 'walkin', 'staff'] as const);
  const hold = input.hold === true;
  const contactName = text(input.contactName, 'the name for the booking', { required: true, max: 80 });
  const contact = { mobile: mobile(input.mobile), email: text(input.email, 'the email', { max: 120 }), notes: text(input.notes, 'the note', { max: 500 }) };
  const names: string[] = Array.isArray(input.playerNames) ? input.playerNames.map((n) => text(n, 'a player name', { max: 80 })) : [];
  const setup = await loadSetup(db, courseId);
  const pick = pickOf(setup, input, w.players);
  return db.tx(async (q) => {
    await lockSlot(q, courseId, w.layoutId, w.startTee, w.day, w.time);
    await checkSlot(q, setup, courseId, w, now);
    const price = priceOf(setup, w, pick);
    const each = greenFees(setup, w, price, pick.types);
    const id = newId();
    const ref = await insertRef(q, courseId);
    await q.query(
      `insert into bookings (business_id, id, ref, layout_id, start_tee, day, time_min, players, status, channel, hold_expires_at, contact_name, mobile, email, notes,
        amount, created_by, created_at, updated_at, holes, carts, caddies, gallery, extras, quote, pay_in_app)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18, $19, $20, $21, $22, $23, $24, $25)`,
      [courseId, id, ref, w.layoutId, w.startTee, w.day, w.time, w.players, hold ? 'held' : 'confirmed', channel, hold ? now + setup.rules.holdMinutes * 60_000 : null,
        contactName, contact.mobile, contact.email, contact.notes, price.total, c.email, now,
        price.holes, price.carts, price.caddies, price.gallery, JSON.stringify(pick.extras), JSON.stringify(price.lines), price.payInApp]);
    for (let n = 1; n <= w.players; n++) {
      await q.query('insert into booking_players (business_id, booking_id, n, name, player_type_id, rate) values ($1, $2, $3, $4, $5, $6)',
        [courseId, id, n, names[n - 1] ?? (n === 1 ? contactName : ''), pick.types[n - 1], each[n - 1]]);
    }
    await audit(q, courseId, c.email, hold ? 'booking.held' : 'booking.created', `${ref} · ${contactName}`, `${formatDay(w.day)} ${formatTime(w.time)}, ${w.players} players, ${price.holes} holes, ${channel}`, null, now);
    return getBookingIn(q, courseId, id);
  });
}

async function getBookingIn(q: Db, courseId: string, id: string): Promise<BookingRow> {
  const [r] = await q.query(`select ${BOOKING_COLS} from bookings where business_id = $1 and id = $2`, [courseId, id]);
  if (!r) throw new NotFound('Booking not found.');
  return bookingOf(r);
}

export async function getBooking(db: Db, c: Caller, courseId: string, id: string) {
  await roleAt(db, c, courseId, CAN.view);
  const b = await getBookingIn(db, courseId, id);
  const players = await db.query('select n, name, player_type_id, rate from booking_players where business_id = $1 and booking_id = $2 order by n', [courseId, id]);
  const history = await db.query('select at, by_name, action, detail from audit where business_id = $1 and subject like $2 order by at', [courseId, `${b.ref} ·%`]);
  return { booking: b, players, history };
}

/** Locks a booking's row for the rest of the transaction. */
async function lockBooking(q: Db, courseId: string, id: string): Promise<BookingRow> {
  const [r] = await q.query(`select ${BOOKING_COLS} from bookings where business_id = $1 and id = $2 for update`, [courseId, id]);
  if (!r) throw new NotFound('Booking not found.');
  return bookingOf(r);
}

const said = (b: BookingRow) => `${b.ref} · ${b.contactName}`;

/**
 * Status changes by staff (PTR-8): confirm a hold, check in, mark a no-show, finish, cancel, or undo a
 * check-in or no-show. The golfer is told when staff change an app booking.
 */
export async function changeStatus(db: Db, c: Caller, courseId: string, id: string, input: { to?: unknown; reason?: unknown }, now = Date.now()): Promise<BookingRow> {
  await roleAt(db, c, courseId, CAN.daily);
  const to = oneOf(input.to, 'what to change the booking to', ['confirmed', 'checked_in', 'played', 'cancelled', 'no_show'] as const);
  const reason = text(input.reason, 'the reason', { max: 300 });
  const setup = await loadSetup(db, courseId);
  return db.tx(async (q) => {
    const b = await lockBooking(q, courseId, id);
    if (b.status === 'held' && b.holdExpiresAt !== null && b.holdExpiresAt <= now) {
      // It already stopped counting when it ran out (expireHolds tidies its status).
      throw new UserError('This hold ran out and the slot was freed. Make the booking again.');
    }
    if (!canChange(b.status, to)) throw new UserError(`A booking that is ${STATUS_WORDS[b.status].toLowerCase()} can’t be changed to ${STATUS_WORDS[to].toLowerCase()}.`);
    if (to === 'no_show' && teeMoment(setup, b) > now) throw new UserError('You can mark a no-show once the tee time has passed.');
    if (to === 'cancelled' && !reason) throw new UserError('Add a reason for cancelling.');
    await q.query('update bookings set status = $3, hold_expires_at = null, cancel_reason = $4, updated_at = $5 where business_id = $1 and id = $2',
      [courseId, id, to, to === 'cancelled' ? reason : b.cancelReason, now]);
    await audit(q, courseId, c.email, `booking.${to}`, said(b), `${STATUS_WORDS[b.status]} → ${STATUS_WORDS[to]}${reason ? `: ${reason}` : ''}`, null, now);
    if (b.channel === 'app' && (to === 'cancelled' || to === 'no_show')) {
      await q.query('insert into notices (business_id, booking_id, kind, detail, created_at) values ($1, $2, $3, $4, $5)', [courseId, id, to, reason, now]);
    }
    return getBookingIn(q, courseId, id);
  });
}

/** Move a booking to another time, tee or day (PTR-8). Locks both slots, in a fixed order. */
export async function moveBooking(db: Db, c: Caller, courseId: string, id: string, input: Record<string, unknown>, now = Date.now()): Promise<BookingRow> {
  await roleAt(db, c, courseId, CAN.daily);
  const setup = await loadSetup(db, courseId);
  return db.tx(async (q) => {
    const b = await lockBooking(q, courseId, id);
    if (b.status !== 'confirmed' && !(b.status === 'held' && takesSlot(b, now))) throw new UserError('Only a confirmed or held booking can be moved.');
    const w = wanted({ ...input, players: input.players ?? b.players });
    const keys = (b.special ? [[w.layoutId, w.startTee, w.day, w.time]] : [[b.layoutId, b.startTee, b.day, b.time], [w.layoutId, w.startTee, w.day, w.time]]) as [string, string, string, number][];
    for (const k of [...keys].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))) await lockSlot(q, courseId, k[0], k[1], k[2], k[3]);
    await checkSlot(q, setup, courseId, w, now, id);
    const had = (await q.query<{ player_type_id: string }>('select player_type_id from booking_players where business_id = $1 and booking_id = $2 order by n', [courseId, id])).map((r) => r.player_type_id);
    const pick = pickOf(setup, input, w.players, { holes: b.holes, types: had, carts: b.carts, caddies: b.caddies, gallery: b.gallery, extras: b.extras });
    const price = priceOf(setup, w, pick);
    const each = greenFees(setup, w, price, pick.types);
    await q.query(
      `update bookings set layout_id = $3, start_tee = $4, day = $5, time_min = $6, players = $7, amount = $8, updated_at = $9,
         holes = $10, carts = $11, caddies = $12, gallery = $13, extras = $14, quote = $15, pay_in_app = $16, special = false where business_id = $1 and id = $2`,
      [courseId, id, w.layoutId, w.startTee, w.day, w.time, w.players, price.total, now,
        price.holes, price.carts, price.caddies, price.gallery, JSON.stringify(pick.extras), JSON.stringify(price.lines), price.payInApp]);
    await q.query('delete from booking_players where business_id = $1 and booking_id = $2 and n > $3', [courseId, id, w.players]);
    for (let n = 1; n <= w.players; n++) {
      await q.query(
        `insert into booking_players (business_id, booking_id, n, name, player_type_id, rate) values ($1, $2, $3, '', $4, $5)
         on conflict (business_id, booking_id, n) do update set player_type_id = excluded.player_type_id, rate = excluded.rate`, [courseId, id, n, pick.types[n - 1], each[n - 1]]);
    }
    await audit(q, courseId, c.email, 'booking.moved', said(b),
      `${formatDay(b.day)} ${formatTime(b.time)} → ${formatDay(w.day)} ${formatTime(w.time)}${w.players !== b.players ? `, ${b.players} → ${w.players} players` : ''}`, null, now);
    if (b.channel === 'app') await q.query("insert into notices (business_id, booking_id, kind, created_at) values ($1, $2, 'moved', $3)", [courseId, id, now]);
    return getBookingIn(q, courseId, id);
  });
}

/** Contact details and notes (PTR-8). */
export async function editBooking(db: Db, c: Caller, courseId: string, id: string, input: Record<string, unknown>, now = Date.now()): Promise<BookingRow> {
  await roleAt(db, c, courseId, CAN.daily);
  const contactName = text(input.contactName, 'the name for the booking', { required: true, max: 80 });
  const m = mobile(input.mobile), email = text(input.email, 'the email', { max: 120 }), notes = text(input.notes, 'the note', { max: 500 });
  return db.tx(async (q) => {
    const b = await lockBooking(q, courseId, id);
    await q.query('update bookings set contact_name = $3, mobile = $4, email = $5, notes = $6, updated_at = $7 where business_id = $1 and id = $2', [courseId, id, contactName, m, email, notes, now]);
    await audit(q, courseId, c.email, 'booking.edited', said({ ...b, contactName }), 'Contact details or notes', null, now);
    return getBookingIn(q, courseId, id);
  });
}

/** Payment taken at the counter for walk-ins and phone bookings (PTR-8). It goes straight to the course: no booking fee. */
export async function recordPayment(db: Db, c: Caller, courseId: string, id: string, input: Record<string, unknown>, now = Date.now()): Promise<BookingRow> {
  await roleAt(db, c, courseId, CAN.daily);
  const amount = int(input.amount, 'the amount paid (in centavos)', 1, 50_000_000);
  const method = oneOf(input.method, 'how they paid', ['cash', 'gcash', 'maya', 'card', 'bank'] as const);
  const ref = text(input.ref, 'the payment reference', { max: 60 });
  if (method !== 'cash' && !ref) throw new UserError('Enter the reference number for GCash, Maya, card or bank payments.');
  return db.tx(async (q) => {
    const b = await lockBooking(q, courseId, id);
    if (b.payStatus === 'paid_online') throw new UserError('This booking was already paid in the app.');
    if (b.status === 'cancelled' || b.status === 'expired') throw new UserError('This booking is not active.');
    await q.query("update bookings set pay_status = 'paid_course', paid_amount = $3, paid_method = $4, paid_ref = $5, updated_at = $6 where business_id = $1 and id = $2",
      [courseId, id, amount, method, ref, now]);
    await audit(q, courseId, c.email, 'booking.paid', said(b), `₱${(amount / 100).toFixed(2)} ${method}${ref ? ` ${ref}` : ''}`, null, now);
    return getBookingIn(q, courseId, id);
  });
}

// ---------------------------------------------------------------- holds and closures

const KINDS = ['walkin', 'regulars', 'event', 'maintenance', 'weather'] as const;
const KIND_WORDS: Record<string, string> = { walkin: 'Walk-ins', regulars: 'Regulars', event: 'Event', maintenance: 'Maintenance', weather: 'Weather' };

/**
 * Hold slots back for walk-ins or regulars (pencil bookings staff can still book), block them for an event
 * or tournament, or close them (maintenance, weather) (PTR-7, PTR-9). Blocking or closing over existing bookings is allowed; it reports them so staff can move or cancel each one.
 */
export async function addBlock(db: Db, c: Caller, courseId: string, input: Record<string, unknown>, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.daily);
  const kind = oneOf(input.kind, 'what the time is for', KINDS);
  const d = day(input.day, 'the day');
  const from = minutes(input.from, 'the start time');
  const to = minutes(input.to, 'the end time');
  if (to <= from) throw new UserError('The end time must be after the start time.');
  const layoutId = input.layoutId ? text(input.layoutId, 'the layout', { max: 40 }) : null;
  const startTee = input.startTee ? text(input.startTee, 'the starting tee', { max: 4 }) : null;
  const reason = text(input.reason, 'the reason', { max: 200 }) || KIND_WORDS[kind];
  const releaseAt = input.releaseAt === undefined || input.releaseAt === null || input.releaseAt === '' ? null : int(input.releaseAt, 'the release time', 0, Number.MAX_SAFE_INTEGER);
  if (releaseAt !== null && (kind === 'maintenance' || kind === 'weather' || kind === 'event')) throw new UserError('Blocked and closed times don’t open on their own. Remove the block when the times are free again.');
  const id = newId();
  return db.tx(async (q) => {
    await q.query(`insert into blocks (business_id, id, layout_id, start_tee, day, from_min, to_min, kind, reason, release_at, created_by, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [courseId, id, layoutId, startTee, d, from, to, kind, reason, releaseAt, c.email, now]);
    await audit(q, courseId, c.email, `block.${kind}`, reason, `${formatDay(d)} ${formatTime(from)} to ${formatTime(to)}`, null, now);
    const affected = (await dayBookings(q, courseId, d)).filter((b) => takesSlot(b, now) && b.time >= from && b.time < to
      && (layoutId === null || b.layoutId === layoutId) && (startTee === null || b.startTee === startTee));
    return { block: blockOf((await q.query('select * from blocks where business_id = $1 and id = $2', [courseId, id]))[0]), affected };
  });
}

/** Release a hold to the app, or reopen closed times. */
export async function removeBlock(db: Db, c: Caller, courseId: string, id: string, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.daily);
  await db.tx(async (q) => {
    const [b] = await q.query<{ reason: string; day: string; from_min: number; to_min: number }>(
      'update blocks set removed_at = $3 where business_id = $1 and id = $2 and removed_at is null returning reason, day, from_min, to_min', [courseId, id, now]);
    if (!b) throw new NotFound('That hold or closure was already removed.');
    await audit(q, courseId, c.email, 'block.removed', b.reason, `${formatDay(b.day)} ${formatTime(b.from_min)} to ${formatTime(b.to_min)}`, null, now);
  });
  return { ok: true };
}

/** Expires holds that ran out (they already stopped counting the moment they ran out; this tidies their status). */
export async function expireHolds(db: Db, now = Date.now()): Promise<number> {
  const r = await db.query("update bookings set status = 'expired', updated_at = $1 where status = 'held' and hold_expires_at <= $1 returning id", [now]);
  return r.length;
}

/**
 * How full each day is, for the date slider over the tee sheet: player spots booked out of those open,
 * per day, for one layout or all of them. Up to 120 days at a time.
 */
export async function daySummary(db: Db, c: Caller, courseId: string, input: { from?: unknown; to?: unknown; layoutId?: unknown }, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.view);
  const from = day(input.from, 'the first day'), to = day(input.to, 'the last day');
  const span = daysBetween(from, to);
  if (span < 0 || span > 120) throw new UserError('Ask for up to 120 days at a time.');
  const layoutId = input.layoutId ? text(input.layoutId, 'the layout', { max: 40 }) : null;
  const setup = await loadSetup(db, courseId);
  const layouts = setup.layouts.filter((l) => l.active && (!layoutId || l.id === layoutId));
  const bookings = (await db.query(`select ${BOOKING_COLS} from bookings where business_id = $1 and day between $2 and $3`, [courseId, from, to])).map(bookingOf);
  const blocks = (await db.query('select * from blocks where business_id = $1 and day between $2 and $3 and removed_at is null', [courseId, from, to])).map(blockOf);
  const out: { day: string; used: number; capacity: number; bookings: number; closed: boolean }[] = [];
  for (let i = 0; i <= span; i++) {
    const d = addDays(from, i);
    const db_ = bookings.filter((b) => b.day === d), bl = blocks.filter((b) => b.day === d);
    let used = 0, capacity = 0, count = 0, slots = 0, closed = 0;
    for (const l of layouts) {
      for (const s of buildSheet(setup, { layoutId: l.id, day: d, bookings: db_, blocks: bl, now, audience: 'staff' })) {
        slots++;
        if (s.state === 'closed') { closed++; continue; }
        used += s.used; capacity += s.capacity; count += s.bookings.length;
      }
    }
    out.push({ day: d, used, capacity, bookings: count, closed: slots > 0 && closed === slots });
  }
  return out;
}

/**
 * A special booking (owners and managers): a VIP, a member or a favour, accepted without choosing a slot or
 * blocking one. It takes no slot's spots, is never refused for a full or held time, and may have no set time
 * or a time between flights. It is charged like any booking, by each player's type.
 */
export async function createSpecial(db: Db, c: Caller, courseId: string, input: Record<string, unknown>, now = Date.now()): Promise<BookingRow> {
  await roleAt(db, c, courseId, CAN.setup);
  const setup = await loadSetup(db, courseId);
  const d = day(input.day, 'the day');
  const time = input.time === null || input.time === undefined || input.time === '' ? null : minutes(input.time, 'the time');
  const open = setup.layouts.filter((l) => l.active);
  const layoutId = input.layoutId ? text(input.layoutId, 'the course', { max: 40 }) : open[0]?.id ?? '';
  const layout = open.find((l) => l.id === layoutId);
  if (!layout) throw new UserError('Pick a course that is open for booking.');
  const startTee = text(input.startTee ?? layout.startTees[0], 'the starting tee', { max: 4 });
  if (!layout.startTees.includes(startTee)) throw new UserError(`${layout.name} starts flights from tee ${layout.startTees.join(' or ')}.`);
  const players = int(input.players, 'the number of players', 1, 5);
  const channel = oneOf(input.channel ?? 'staff', 'how the booking came in', ['phone', 'viber', 'walkin', 'staff'] as const);
  const contactName = text(input.contactName, 'the name for the booking', { required: true, max: 80 });
  const contact = { mobile: mobile(input.mobile), email: text(input.email, 'the email', { max: 120 }), notes: text(input.notes, 'the note', { max: 500 }) };
  const pick = pickOf(setup, input, players);
  const w: Wanted = { layoutId, startTee, day: d, time: time ?? 0, players };
  const price = priceOf(setup, w, pick);
  const each = greenFees(setup, w, price, pick.types);
  return db.tx(async (q) => {
    const id = newId();
    const ref = await insertRef(q, courseId);
    await q.query(
      `insert into bookings (business_id, id, ref, layout_id, start_tee, day, time_min, players, status, channel, contact_name, mobile, email, notes,
        amount, created_by, created_at, updated_at, holes, carts, caddies, gallery, extras, quote, pay_in_app, special)
        values ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9, $10, $11, $12, $13, $14, $15, $16, $16, $17, $18, $19, $20, $21, $22, $23, true)`,
      [courseId, id, ref, layoutId, startTee, d, time, players, channel, contactName, contact.mobile, contact.email, contact.notes, price.total, c.email, now,
        price.holes, price.carts, price.caddies, price.gallery, JSON.stringify(pick.extras), JSON.stringify(price.lines), price.payInApp]);
    for (let n = 1; n <= players; n++) {
      await q.query('insert into booking_players (business_id, booking_id, n, name, player_type_id, rate) values ($1, $2, $3, $4, $5, $6)',
        [courseId, id, n, n === 1 ? contactName : '', pick.types[n - 1], each[n - 1]]);
    }
    await audit(q, courseId, c.email, 'booking.special', `${ref} · ${contactName}`,
      `${formatDay(d)}${time === null ? ', no set time' : ` ${formatTime(time)}`}, ${players} players`, null, now);
    return getBookingIn(q, courseId, id);
  });
}

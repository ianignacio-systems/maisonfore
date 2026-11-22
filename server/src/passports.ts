import { audit, newId, NotFound, UserError, type Caller, type Db } from '@maison/core';
import { canChange, formatDay, formatTime, localParts, passportLines, peso, STATUS_WORDS, teeMoment, type CourseSetup, type PassportLine } from '@maison/engine';
import { getBookingIn, lockBooking, pencilBack, type BookingRow } from './bookings';
import { day as dayOf, int, mobile, oneOf, text } from './check';
import { CAN, loadSetup, roleAt } from './courses';

/**
 * Paying after playing (PAY-2). Golfers register at the counter on arrival: each player gets a passport
 * with their share of the booking's charges. Tee houses add food and drinks to it during the round; the
 * players settle at the counter afterwards, each their own passport or the group together. The club
 * collects for the tee houses and remits what's due to each one.
 */

const METHODS = ['cash', 'gcash', 'maya', 'card', 'bank'] as const;

export interface Charge { id: string; label: string; qty: number; unit: number; amount: number; teeHouseId: string | null; teeHouse: string; at: number; by: string }
export interface Passport { n: number; name: string; mobile: string; type: string; lines: PassportLine[]; charges: Charge[]; total: number; paid: number; balance: number }
export interface Passports { players: Passport[]; total: number; paid: number; balance: number; settled: boolean; payments: { n: number | null; amount: number; method: string; ref: string; at: number }[] }

/** The players' passports for a booking: their share of it, what the tee houses charged, what's been paid. */
export async function passportsOf(q: Db, setup: CourseSetup, courseId: string, b: BookingRow): Promise<Passports> {
  const players = await q.query<{ n: number; name: string; mobile: string; player_type_id: string; rate: number }>(
    'select n, name, mobile, player_type_id, rate from booking_players where business_id = $1 and booking_id = $2 order by n', [courseId, b.id]);
  const [mv] = await q.query<{ passport_moves: Record<string, number> }>('select passport_moves from bookings where business_id = $1 and id = $2', [courseId, b.id]);
  const shares = b.quote.length
    ? passportLines(setup, { day: b.day, holes: b.holes, lines: b.quote }, players.map((p) => ({ typeId: p.player_type_id, rate: Number(p.rate) })), mv?.passport_moves ?? {})
    : players.map((_, i) => [{ label: 'Booking', amount: Math.floor(b.amount / players.length) + (i < b.amount % players.length ? 1 : 0), unit: null }]);
  const charges = await q.query<{ id: string; player_n: number; label: string; qty: number; unit_amount: number; amount: number; tee_house_id: string | null; house: string | null; created_at: string; created_by: string }>(
    `select pc.id, pc.player_n, pc.label, pc.qty, pc.unit_amount, pc.amount, pc.tee_house_id, th.name as house, pc.created_at, pc.created_by
       from passport_charges pc left join tee_houses th on th.business_id = pc.business_id and th.id = pc.tee_house_id
      where pc.business_id = $1 and pc.booking_id = $2 and pc.voided_at is null order by pc.created_at`, [courseId, b.id]);
  const pays = await q.query<{ player_n: number | null; amount: number; method: string; ref: string; created_at: string }>(
    'select player_n, amount, method, ref, created_at from passport_payments where business_id = $1 and booking_id = $2 order by created_at', [courseId, b.id]);
  const list: Passport[] = players.map((p, i) => {
    const mine = charges.filter((c) => c.player_n === p.n).map((c) => ({ id: c.id, label: c.label, qty: c.qty, unit: c.unit_amount, amount: c.amount, teeHouseId: c.tee_house_id, teeHouse: c.house ?? 'Counter', at: Number(c.created_at), by: c.created_by }));
    const lines = shares[i] ?? [];
    const total = lines.reduce((s, l) => s + l.amount, 0) + mine.reduce((s, c) => s + c.amount, 0);
    const paid = pays.filter((x) => x.player_n === p.n).reduce((s, x) => s + x.amount, 0);
    return { n: p.n, name: p.name, mobile: p.mobile, type: setup.playerTypes.find((t) => t.id === p.player_type_id)?.name ?? '', lines, charges: mine, total, paid, balance: total - paid };
  });
  // Payments for the whole group fill the passports in order.
  let group = pays.filter((x) => x.player_n === null).reduce((s, x) => s + x.amount, 0);
  for (const p of list) { const take = Math.min(group, Math.max(0, p.balance)); p.paid += take; p.balance -= take; group -= take; }
  const total = list.reduce((s, p) => s + p.total, 0), paid = pays.reduce((s, x) => s + x.amount, 0);
  return { players: list, total, paid, balance: total - paid, settled: total - paid <= 0,
    payments: pays.map((x) => ({ n: x.player_n, amount: x.amount, method: x.method, ref: x.ref, at: Number(x.created_at) })) };
}

export async function getPassports(db: Db, c: Caller, courseId: string, id: string) {
  await roleAt(db, c, courseId, CAN.view);
  const setup = await loadSetup(db, courseId);
  return passportsOf(db, setup, courseId, await getBookingIn(db, courseId, id));
}

/**
 * Opens the passports when a group registers: a payment taken before the round (a phone booking that paid
 * ahead) becomes a payment on the passports, and the booking is settled only when every passport is.
 */
export async function openPassports(q: Db, courseId: string, b: BookingRow, by: string, now: number) {
  if (b.payStatus === 'paid_course' && b.paidAmount > 0) {
    await q.query('insert into passport_payments (business_id, id, booking_id, player_n, amount, method, ref, created_by, created_at) values ($1, $2, $3, null, $4, $5, $6, $7, $8)',
      [courseId, newId(), b.id, b.paidAmount, b.paidMethod || 'cash', b.paidRef || 'Paid before the round', by, now]);
    await q.query("update bookings set pay_status = 'unpaid', paid_amount = 0 where business_id = $1 and id = $2", [courseId, b.id]);
  }
}

/** Registration on arrival: each player's name and mobile, then the passports open (checked in). */
export async function registerBooking(db: Db, c: Caller, courseId: string, id: string, input: Record<string, unknown>, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.daily);
  const setup = await loadSetup(db, courseId);
  if (setup.rules.payWhen !== 'after') throw new UserError('Golfers at this course pay before playing. Record the payment, then check them in.');
  const given = Array.isArray(input.players) ? input.players as { name?: unknown; mobile?: unknown }[] : [];
  return db.tx(async (q) => {
    const b = await lockBooking(q, courseId, id);
    if (!canChange(b.status, 'checked_in')) throw new UserError(`A booking that is ${STATUS_WORDS[b.status].toLowerCase()} can’t be registered.`);
    await pencilBack(q, courseId, b, now, 'register them');
    const rows = await q.query<{ n: number; name: string }>('select n, name from booking_players where business_id = $1 and booking_id = $2 order by n', [courseId, id]);
    for (const r of rows) {
      const g = given[r.n - 1] ?? {};
      const name = text(g.name ?? r.name, `player ${r.n}’s name`, { max: 80 }) || (r.n === 1 ? b.contactName : '');
      if (setup.rules.playerNames === 'required' && !name) throw new UserError(`Enter player ${r.n}’s name.`);
      await q.query('update booking_players set name = $4, mobile = $5 where business_id = $1 and booking_id = $2 and n = $3', [courseId, id, r.n, name, g.mobile === undefined ? '' : mobile(g.mobile)]);
    }
    await openPassports(q, courseId, b, c.email, now);
    await q.query("update bookings set status = 'checked_in', hold_expires_at = null, pay_due_by = null, updated_at = $3 where business_id = $1 and id = $2", [courseId, id, now]);
    await audit(q, courseId, c.email, 'booking.registered', `${b.ref} · ${b.contactName}`, `${rows.length} players registered, passports opened`, null, now);
    return passportsOf(q, setup, courseId, await getBookingIn(q, courseId, id));
  });
}

/** Settling at the counter after the round: one player's passport, or the whole group's balance. */
export async function settlePassports(db: Db, c: Caller, courseId: string, id: string, input: Record<string, unknown>, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.daily);
  const setup = await loadSetup(db, courseId);
  const method = oneOf(input.method, 'how they paid', METHODS);
  const ref = text(input.ref, 'the payment reference', { max: 60 });
  if (method !== 'cash' && !ref) throw new UserError('Enter the reference number for GCash, Maya, card or bank payments.');
  const player = input.player === null || input.player === undefined || input.player === '' ? null : int(input.player, 'the player', 1, 5);
  return db.tx(async (q) => {
    const b = await lockBooking(q, courseId, id);
    if (b.status !== 'checked_in' && b.status !== 'played') throw new UserError('Register the group first; passports open when they register.');
    const before = await passportsOf(q, setup, courseId, b);
    const target = player === null ? before.balance : before.players.find((p) => p.n === player)?.balance;
    if (target === undefined) throw new NotFound('No such player in this booking.');
    if (target <= 0) throw new UserError(player === null ? 'Every passport is already settled.' : `Player ${player}’s passport is already settled.`);
    const amount = input.amount === undefined || input.amount === null || input.amount === '' ? target : int(input.amount, 'the amount paid (in centavos)', 1, target);
    await q.query('insert into passport_payments (business_id, id, booking_id, player_n, amount, method, ref, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [courseId, newId(), id, player, amount, method, ref, c.email, now]);
    const after = await passportsOf(q, setup, courseId, b);
    if (after.settled) {
      await q.query("update bookings set pay_status = 'paid_course', paid_amount = $3, paid_method = $4, paid_ref = $5, pay_due_by = null, updated_at = $6 where business_id = $1 and id = $2",
        [courseId, id, after.paid, method, ref, now]);
    }
    const who = player === null ? 'the group' : before.players.find((p) => p.n === player)?.name || `player ${player}`;
    await audit(q, courseId, c.email, 'booking.settled', `${b.ref} · ${b.contactName}`, `${peso(amount)} ${method}${ref ? ` ${ref}` : ''} for ${who}${after.settled ? ', all passports settled' : ''}`, null, now);
    return after;
  });
}

/** Moves a charge that belongs to one passport (a cart, a gallery guest…) to the player who pays it. */
export async function movePassportLine(db: Db, c: Caller, courseId: string, id: string, input: Record<string, unknown>, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.daily);
  const unit = text(input.unit, 'the charge', { required: true, max: 80 });
  const to = int(input.to, 'the player', 1, 5);
  const setup = await loadSetup(db, courseId);
  return db.tx(async (q) => {
    const b = await lockBooking(q, courseId, id);
    if (b.payStatus === 'paid_course') throw new UserError('Every passport is settled already.');
    if (to > b.players) throw new UserError('No such player in this booking.');
    await q.query("update bookings set passport_moves = passport_moves || jsonb_build_object($3::text, $4::int), updated_at = $5 where business_id = $1 and id = $2", [courseId, id, unit, to, now]);
    await audit(q, courseId, c.email, 'passport.moved', `${b.ref} · ${b.contactName}`, `Moved to player ${to}`, null, now);
    return passportsOf(q, setup, courseId, await getBookingIn(q, courseId, id));
  });
}

// ---------------------------------------------------------------- tee houses: setup

export interface TeeHouse { id: string; name: string; concessionaire: string; sharePercent: number; rentAmount: number; rentNote: string; receipts: 'club' | 'tee_house'; active: boolean;
  items: { id: string; name: string; price: number; active: boolean }[] }

export async function teeHousesOf(q: Db, courseId: string, onlyActive = false): Promise<TeeHouse[]> {
  const houses = await q.query(`select * from tee_houses where business_id = $1 ${onlyActive ? 'and active' : ''} order by sort, name`, [courseId]);
  const items = await q.query(`select * from tee_house_items where business_id = $1 ${onlyActive ? 'and active' : ''} order by sort, name`, [courseId]);
  return houses.map((h) => ({
    id: h.id as string, name: h.name as string, concessionaire: h.concessionaire as string, sharePercent: Number(h.share_bp) / 100, rentAmount: Number(h.rent_amount),
    rentNote: h.rent_note as string, receipts: h.receipts as TeeHouse['receipts'], active: h.active as boolean,
    items: items.filter((i) => i.tee_house_id === h.id).map((i) => ({ id: i.id as string, name: i.name as string, price: Number(i.price), active: i.active as boolean })),
  }));
}

export async function listTeeHouses(db: Db, c: Caller, courseId: string) {
  await roleAt(db, c, courseId, CAN.setup);
  return teeHousesOf(db, courseId);
}

/** Saves the course's tee houses and their menus (owners and managers). Tee houses with orders are switched off, never deleted. */
export async function saveTeeHouses(db: Db, c: Caller, courseId: string, input: Record<string, unknown>, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.setup);
  const list = Array.isArray(input.teeHouses) ? input.teeHouses as Record<string, unknown>[] : [];
  if (list.length > 20) throw new UserError('Up to 20 tee houses.');
  await db.tx(async (q) => {
    const had = await teeHousesOf(q, courseId);
    const keep = new Set<string>();
    for (const [i, h] of list.entries()) {
      const id = text(h.id, 'the tee house', { max: 40 }) || newId();
      keep.add(id);
      const name = text(h.name, 'the tee house name', { required: true, max: 60 });
      const share = Math.round(Number(h.sharePercent ?? 0) * 100);
      if (!(share >= 0 && share <= 10000)) throw new UserError(`The club’s share for ${name} must be between 0 and 100%.`);
      const rent = h.rentAmount === undefined || h.rentAmount === '' ? 0 : int(h.rentAmount, `the rent for ${name} (in centavos)`, 0, 1_000_000_000);
      const receipts = h.receipts === 'tee_house' ? 'tee_house' : 'club';
      await q.query(
        `insert into tee_houses (business_id, id, name, concessionaire, share_bp, rent_amount, rent_note, receipts, active, sort, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (business_id, id) do update set name = excluded.name, concessionaire = excluded.concessionaire, share_bp = excluded.share_bp, rent_amount = excluded.rent_amount,
           rent_note = excluded.rent_note, receipts = excluded.receipts, active = excluded.active, sort = excluded.sort`,
        [courseId, id, name, text(h.concessionaire, 'the concessionaire', { max: 80 }), share, rent, text(h.rentNote, 'the rent note', { max: 120 }), receipts, h.active !== false, i, now]);
      const items = Array.isArray(h.items) ? h.items as Record<string, unknown>[] : [];
      const keepItems: string[] = [];
      for (const [j, it] of items.entries()) {
        const iname = text(it.name, 'the item name', { max: 60 });
        if (!iname) continue;
        const iid = text(it.id, 'the item', { max: 40 }) || newId();
        keepItems.push(iid);
        await q.query(
          `insert into tee_house_items (business_id, id, tee_house_id, name, price, active, sort) values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (business_id, id) do update set name = excluded.name, price = excluded.price, active = excluded.active, sort = excluded.sort`,
          [courseId, iid, id, iname, int(it.price, `the price of ${iname} (in centavos)`, 0, 10_000_000), it.active !== false, j]);
      }
      await q.query('update tee_house_items set active = false where business_id = $1 and tee_house_id = $2 and not (id = any($3::text[]))', [courseId, id, keepItems]);
    }
    for (const h of had.filter((x) => !keep.has(x.id))) {
      const used = await q.query('select 1 from passport_charges where business_id = $1 and tee_house_id = $2 limit 1', [courseId, h.id]);
      if (used.length) await q.query('update tee_houses set active = false where business_id = $1 and id = $2', [courseId, h.id]);
      else { await q.query('delete from tee_house_items where business_id = $1 and tee_house_id = $2', [courseId, h.id]); await q.query('delete from tee_houses where business_id = $1 and id = $2', [courseId, h.id]); }
    }
    await audit(q, courseId, c.email, 'setup.teehouses', 'Tee houses', `${list.length} tee houses`, null, now);
  });
  return teeHousesOf(db, courseId);
}

// ---------------------------------------------------------------- tee houses: the day, orders

/** The tee house a staff member works at (tee house role), or null for counter staff who can pick any. */
async function myTeeHouse(q: Db, courseId: string, c: Caller, role: string): Promise<string | null> {
  if (role !== 'teehouse') return null;
  const [r] = await q.query<{ tee_house_id: string }>('select tee_house_id from tee_house_staff where business_id = $1 and email = $2', [courseId, c.email.toLowerCase()]);
  if (!r) throw new UserError('You haven’t been given a tee house yet. Ask the club’s owner.');
  return r.tee_house_id;
}

/** What a tee house needs: its menu, the groups on the course today and their players, and today's orders. */
export async function teeHouseDay(db: Db, c: Caller, courseId: string, now = Date.now()) {
  const role = await roleAt(db, c, courseId, CAN.teehouse);
  const setup = await loadSetup(db, courseId);
  const mine = await myTeeHouse(db, courseId, c, role);
  const houses = (await teeHousesOf(db, courseId, true)).filter((h) => !mine || h.id === mine);
  const today = localParts(now, setup.timeZone).day;
  const groups = await db.query<{ id: string; ref: string; time_min: number; start_tee: string; contact_name: string; pay_status: string }>(
    "select id, ref, time_min, start_tee, contact_name, pay_status from bookings where business_id = $1 and day = $2 and status = 'checked_in' order by time_min", [courseId, today]);
  const players = groups.length ? await db.query<{ booking_id: string; n: number; name: string }>(
    'select booking_id, n, name from booking_players where business_id = $1 and booking_id = any($2::text[]) order by n', [courseId, groups.map((g) => g.id)]) : [];
  const orders = await db.query(
    `select pc.id, pc.booking_id, pc.player_n, pc.label, pc.qty, pc.amount, pc.tee_house_id, pc.created_at, pc.voided_at, bk.ref, bp.name as player_name
       from passport_charges pc join bookings bk on bk.business_id = pc.business_id and bk.id = pc.booking_id
       left join booking_players bp on bp.business_id = pc.business_id and bp.booking_id = pc.booking_id and bp.n = pc.player_n
      where pc.business_id = $1 and pc.created_at >= $2 ${mine ? 'and pc.tee_house_id = $3' : ''} order by pc.created_at desc limit 200`,
    mine ? [courseId, now - 18 * 3_600_000, mine] : [courseId, now - 18 * 3_600_000]);
  return {
    today, role, teeHouseId: mine, teeHouses: houses, courseName: (await db.query<{ name: string }>('select name from businesses where id = $1', [courseId]))[0]?.name ?? '',
    onCourse: groups.filter((g) => g.pay_status !== 'paid_course').map((g) => ({ id: g.id, ref: g.ref, time: g.time_min, startTee: g.start_tee, contactName: g.contact_name,
      players: players.filter((p) => p.booking_id === g.id).map((p) => ({ n: p.n, name: p.name || `Player ${p.n}` })) })),
    orders: orders.map((o) => ({ id: o.id as string, bookingId: o.booking_id as string, ref: o.ref as string, playerN: o.player_n as number, player: (o.player_name as string) || `Player ${o.player_n}`,
      label: o.label as string, qty: o.qty as number, amount: Number(o.amount), teeHouseId: (o.tee_house_id as string) ?? null, at: Number(o.created_at), voided: o.voided_at !== null })),
  };
}

/**
 * Adds food and drinks to a player's passport. Each order carries an id made on the phone, so an order sent
 * again after the signal dropped is only counted once.
 */
export async function addCharges(db: Db, c: Caller, courseId: string, input: Record<string, unknown>, now = Date.now()) {
  const role = await roleAt(db, c, courseId, CAN.teehouse);
  const setup = await loadSetup(db, courseId);
  const mine = await myTeeHouse(db, courseId, c, role);
  const houseId = mine ?? (text(input.teeHouseId, 'the tee house', { max: 40 }) || null);
  const clientId = text(input.clientId, 'the order', { required: true, max: 60 });
  const bookingId = text(input.bookingId, 'the booking', { required: true, max: 40 });
  const playerN = int(input.playerN, 'the player', 1, 5);
  const items = Array.isArray(input.items) ? input.items as Record<string, unknown>[] : [];
  if (!items.length) throw new UserError('Add at least one item.');
  return db.tx(async (q) => {
    if (houseId && !(await q.query('select 1 from tee_houses where business_id = $1 and id = $2', [courseId, houseId])).length) throw new NotFound('Tee house not found.');
    const already = await q.query('select 1 from passport_charges where business_id = $1 and client_id like $2 limit 1', [courseId, `${clientId}:%`]);
    if (already.length) return { ok: true, repeated: true };
    const b = await lockBooking(q, courseId, bookingId);
    if (b.status !== 'checked_in') throw new UserError(b.status === 'played' ? 'This group has finished and left. Ask the counter.' : 'This group hasn’t registered yet.');
    if (b.payStatus === 'paid_course') throw new UserError('This group has already settled at the counter. Ask the counter to add it.');
    if (playerN > b.players) throw new NotFound('No such player in this group.');
    if (b.day !== localParts(now, setup.timeZone).day) throw new UserError('Orders can be added on the day of play only.');
    let total = 0;
    for (const [i, it] of items.entries()) {
      const qty = int(it.qty ?? 1, 'the quantity', 1, 99);
      let label = text(it.label, 'the item', { max: 60 }), unit: number;
      const itemId = text(it.itemId, 'the item', { max: 40 }) || null;
      if (itemId) {
        const [row] = await q.query<{ name: string; price: number; tee_house_id: string }>('select name, price, tee_house_id from tee_house_items where business_id = $1 and id = $2', [courseId, itemId]);
        if (!row || (houseId && row.tee_house_id !== houseId)) throw new NotFound('That item isn’t on this tee house’s menu.');
        label = row.name; unit = Number(row.price);
      } else {
        if (!label) throw new UserError('Name the item.');
        unit = int(it.unit, `the price of ${label} (in centavos)`, 0, 10_000_000);
      }
      total += unit * qty;
      await q.query(
        `insert into passport_charges (business_id, id, booking_id, player_n, tee_house_id, item_id, label, qty, unit_amount, amount, client_id, created_by, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) on conflict do nothing`,
        [courseId, newId(), bookingId, playerN, houseId, itemId, label, qty, unit, unit * qty, `${clientId}:${i}`, c.email, Number(input.at) > 0 && Number(input.at) <= now ? Number(input.at) : now]);
    }
    await audit(q, courseId, c.email, 'passport.charged', `${b.ref} · ${b.contactName}`, `${peso(total)} for player ${playerN}${houseId ? '' : ' at the counter'}`, null, now);
    return { ok: true, repeated: false };
  });
}

/** Takes an order off a passport (wrong player, entered twice…). Tee house staff: their own, before the group settles. */
export async function voidCharge(db: Db, c: Caller, courseId: string, chargeId: string, input: Record<string, unknown>, now = Date.now()) {
  const role = await roleAt(db, c, courseId, CAN.teehouse);
  const mine = await myTeeHouse(db, courseId, c, role);
  return db.tx(async (q) => {
    const [ch] = await q.query<{ booking_id: string; tee_house_id: string | null; label: string; amount: number; voided_at: number | null }>(
      'select booking_id, tee_house_id, label, amount, voided_at from passport_charges where business_id = $1 and id = $2 for update', [courseId, chargeId]);
    if (!ch || (mine && ch.tee_house_id !== mine)) throw new NotFound('Order not found.');
    if (ch.voided_at) return { ok: true };
    const b = await lockBooking(q, courseId, ch.booking_id);
    if (b.payStatus === 'paid_course') throw new UserError('This group has already settled. The counter can sort it out.');
    await q.query('update passport_charges set voided_at = $3, voided_by = $4, void_reason = $5 where business_id = $1 and id = $2', [courseId, chargeId, now, c.email, text(input.reason, 'the reason', { max: 120 })]);
    await audit(q, courseId, c.email, 'passport.voided', `${b.ref} · ${b.contactName}`, `${ch.label}, ${peso(Number(ch.amount))}`, null, now);
    return { ok: true };
  });
}

// ---------------------------------------------------------------- tee houses: what the club owes them

/**
 * Each tee house's sales over a range of days, what the club keeps (its share), and what's due to the
 * tee house. The club owes every order charged to a passport, whether or not the golfer settled: the
 * unsettled ones are listed for the club to follow up.
 */
export async function teeHouseReport(db: Db, c: Caller, courseId: string, input: { from?: unknown; to?: unknown }, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.records);
  const setup = await loadSetup(db, courseId);
  const today = localParts(now, setup.timeZone).day;
  const from = input.from ? dayOf(input.from, 'the first day') : today, to = input.to ? dayOf(input.to, 'the last day') : from;
  if (to < from) throw new UserError('The last day must be after the first.');
  const houses = await teeHousesOf(db, courseId);
  const rows = await db.query(
    `select pc.id, pc.tee_house_id, pc.label, pc.qty, pc.amount, pc.player_n, pc.created_at, bk.day, bk.ref, bk.id as booking_id, bk.pay_status, bk.contact_name, bk.time_min, bp.name as player_name
       from passport_charges pc join bookings bk on bk.business_id = pc.business_id and bk.id = pc.booking_id
       left join booking_players bp on bp.business_id = pc.business_id and bp.booking_id = pc.booking_id and bp.n = pc.player_n
      where pc.business_id = $1 and pc.voided_at is null and pc.tee_house_id is not null and bk.day between $2 and $3 order by bk.day, pc.created_at`, [courseId, from, to]);
  const remits = await db.query<{ tee_house_id: string; day: string; amount: number; note: string; remitted_by: string; remitted_at: string }>(
    'select * from tee_house_remits where business_id = $1 and day between $2 and $3', [courseId, from, to]);
  const report = houses.filter((h) => h.active || rows.some((r) => r.tee_house_id === h.id)).map((h) => {
    const mine = rows.filter((r) => r.tee_house_id === h.id);
    const days = [...new Set(mine.map((r) => r.day as string))].sort().map((d) => {
      const list = mine.filter((r) => r.day === d);
      const sales = list.reduce((s, r) => s + Number(r.amount), 0);
      const share = Math.round((sales * h.sharePercent) / 100);
      const collected = list.filter((r) => r.pay_status === 'paid_course').reduce((s, r) => s + Number(r.amount), 0);
      const remit = remits.find((x) => x.tee_house_id === h.id && x.day === d);
      return { day: d, orders: list.length, sales, share, due: sales - share, collected, uncollected: sales - collected,
        remitted: remit ? { amount: Number(remit.amount), note: remit.note, by: remit.remitted_by, at: Number(remit.remitted_at) } : null };
    });
    const sum = (k: 'orders' | 'sales' | 'share' | 'due' | 'collected' | 'uncollected') => days.reduce((s, d) => s + d[k], 0);
    return {
      id: h.id, name: h.name, concessionaire: h.concessionaire, sharePercent: h.sharePercent, rentAmount: h.rentAmount, rentNote: h.rentNote, receipts: h.receipts,
      days, orders: sum('orders'), sales: sum('sales'), share: sum('share'), due: sum('due'), collected: sum('collected'), uncollected: sum('uncollected'),
      remitted: days.reduce((s, d) => s + (d.remitted?.amount ?? 0), 0),
      lines: mine.map((r) => ({ id: r.id as string, day: r.day as string, at: Number(r.created_at), ref: r.ref as string, player: (r.player_name as string) || `Player ${r.player_n}`,
        label: r.label as string, qty: r.qty as number, amount: Number(r.amount), settled: r.pay_status === 'paid_course' })),
    };
  });
  const unsettled = [...new Map(rows.filter((r) => r.pay_status !== 'paid_course').map((r) => [r.booking_id as string, r])).values()].map((r) => ({
    bookingId: r.booking_id as string, ref: r.ref as string, day: r.day as string, time: r.time_min as number, contactName: r.contact_name as string,
    teeHouseCharges: rows.filter((x) => x.booking_id === r.booking_id && x.pay_status !== 'paid_course').reduce((s, x) => s + Number(x.amount), 0),
  }));
  return { from, to, teeHouses: report, unsettled };
}

/** Marks a day's amount as paid to a tee house (or, with amount null, takes that back). */
export async function markRemitted(db: Db, c: Caller, courseId: string, input: Record<string, unknown>, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.records);
  const houseId = text(input.teeHouseId, 'the tee house', { required: true, max: 40 });
  const d = dayOf(input.day, 'the day');
  const [h] = await db.query<{ name: string }>('select name from tee_houses where business_id = $1 and id = $2', [courseId, houseId]);
  if (!h) throw new NotFound('Tee house not found.');
  await db.tx(async (q) => {
    if (input.amount === null) {
      await q.query('delete from tee_house_remits where business_id = $1 and tee_house_id = $2 and day = $3', [courseId, houseId, d]);
      await audit(q, courseId, c.email, 'teehouse.unremitted', h.name, formatDay(d), null, now);
      return;
    }
    const amount = int(input.amount, 'the amount paid (in centavos)', 0, 1_000_000_000);
    await q.query(`insert into tee_house_remits (business_id, tee_house_id, day, amount, note, remitted_by, remitted_at) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (business_id, tee_house_id, day) do update set amount = excluded.amount, note = excluded.note, remitted_by = excluded.remitted_by, remitted_at = excluded.remitted_at`,
      [courseId, houseId, d, amount, text(input.note, 'the note', { max: 120 }), c.email, now]);
    await audit(q, courseId, c.email, 'teehouse.remitted', h.name, `${formatDay(d)}: ${peso(amount)}`, null, now);
  });
  return { ok: true };
}

/** Groups who teed off hours ago and still haven't settled: for the overview. */
export async function unsettledGroups(db: Db, courseId: string, setup: CourseSetup, now: number) {
  if (setup.rules.payWhen !== 'after') return [];
  const rows = await db.query<{ id: string; day: string; time_min: number; contact_name: string }>(
    "select id, day, time_min, contact_name from bookings where business_id = $1 and status in ('checked_in', 'played') and pay_status = 'unpaid' and time_min >= 0 and day >= $2",
    [courseId, localParts(now - 14 * 86_400_000, setup.timeZone).day]);
  return rows.filter((r) => teeMoment(setup, { day: r.day, time: r.time_min }) + 5 * 3_600_000 < now).map((r) => ({ id: r.id, day: r.day, time: r.time_min, name: r.contact_name, label: `${formatTime(r.time_min)} ${r.contact_name}` }));
}

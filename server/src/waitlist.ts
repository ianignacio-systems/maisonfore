import { audit, newId, NotFound, UserError, type Caller, type Db } from '@maison/core';
import { formatDay, formatTime, localParts, minPlayers, publicWindow, teeMoment, type CourseSetup, type Slot } from '@maison/engine';
import { checkSlot, expireHolds, getBookingIn, greenFees, insertRef, lockSlot, pickOf, priceOf } from './bookings';
import { day as dayOf, int, minutes, mobile, text } from './check';
import { CAN, loadSetup, roleAt } from './courses';
import { liveCourseId, needProfile, publicSlots, typeFor } from './golf';
import { sendAlerts, tell } from './notify';

/**
 * Waiting for a tee time (TEE-7).
 * The counter standby list: groups waiting at the counter for a time to open, kept by staff, who seat them
 * from the tee sheet as walk-ins.
 * The app waitlist: a golfer waits for any time in a range on a day. When spots open (a booking not paid
 * by its deadline, a cancellation, a released hold), the first golfer in line whose group fits is offered
 * the time: it is held in their name for the club's claim time. If they don't book it, it goes to the next.
 * Under an hour before the tee time there's no time for that, so everyone who fits is told at once and
 * the first to book gets it.
 */

const HOUR = 3_600_000;
/** Closer than this to the tee time, an opening goes to everyone waiting at once instead of one by one. */
export const OFFER_AHEAD = HOUR;

interface Entry {
  businessId: string; id: string; kind: 'app' | 'standby'; golferId: string | null; layoutId: string | null; day: string; from: number; to: number;
  players: number; contactName: string; mobile: string; notes: string; status: string; bookingId: string | null; offerExpiresAt: number | null;
  toldTimes: number[]; createdAt: number;
}
const entryOf = (r: Record<string, unknown>): Entry => ({
  businessId: r.business_id as string, id: r.id as string, kind: r.kind as Entry['kind'], golferId: (r.golfer_account as string) ?? null, layoutId: (r.layout_id as string) ?? null,
  day: r.day as string, from: r.from_min as number, to: r.to_min as number, players: r.players as number, contactName: r.contact_name as string, mobile: r.mobile as string,
  notes: r.notes as string, status: r.status as string, bookingId: (r.booking_id as string) ?? null, offerExpiresAt: r.offer_expires_at === null ? null : Number(r.offer_expires_at),
  toldTimes: (r.told_times as number[]) ?? [], createdAt: Number(r.created_at),
});

/** A slot a waiting group could take: open to the app, room for the whole group, in their range, not yet teed off. */
const fits = (setup: CourseSetup, e: Pick<Entry, 'layoutId' | 'from' | 'to' | 'players'>, s: Slot, now: number) =>
  (s.state === 'open' || s.state === 'partial') && s.free >= e.players && s.time >= e.from && s.time <= e.to
  && (!e.layoutId || s.layoutId === e.layoutId) && teeMoment(setup, s) > now;

const clockAt = (setup: CourseSetup, at: number) => formatTime(localParts(at, setup.timeZone).minutes);
const range = (e: Pick<Entry, 'from' | 'to'>) => (e.from <= 0 && e.to >= 24 * 60 - 1 ? 'any time' : `${formatTime(e.from)} to ${formatTime(e.to)}`);

// ---------------------------------------------------------------- staff: the counter standby list

/** Adds a group waiting at the counter. Any time unless staff narrow it. */
export async function addStandby(db: Db, c: Caller, courseId: string, input: Record<string, unknown>, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.daily);
  const setup = await loadSetup(db, courseId);
  const d = input.day ? dayOf(input.day) : localParts(now, setup.timeZone).day;
  const players = int(input.players, 'the number of players', 1, 5);
  const contactName = text(input.contactName, 'the name', { required: true, max: 80 });
  const m = mobile(input.mobile);
  const notes = text(input.notes, 'the note', { max: 300 });
  const from = input.from === undefined || input.from === null || input.from === '' ? 0 : minutes(input.from, 'the earliest time');
  const to = input.to === undefined || input.to === null || input.to === '' ? 24 * 60 - 1 : minutes(input.to, 'the latest time');
  if (to < from) throw new UserError('The latest time must be after the earliest.');
  await db.tx(async (q) => {
    await q.query(
      `insert into waitlist (business_id, id, kind, day, from_min, to_min, players, contact_name, mobile, notes, created_by, created_at, updated_at)
       values ($1, $2, 'standby', $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`, [courseId, newId(), d, from, to, players, contactName, m, notes, c.email, now]);
    await audit(q, courseId, c.email, 'standby.added', contactName, `${formatDay(d)}, ${players} players, ${range({ from, to })}`, null, now);
  });
  return { ok: true };
}

/** Takes a group off the standby list or a golfer off the app waitlist (an open offer is released). */
export async function removeWaiting(db: Db, c: Caller, courseId: string, wid: string, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.daily);
  const setup = await loadSetup(db, courseId);
  await db.tx(async (q) => {
    const [r] = await q.query("select * from waitlist where business_id = $1 and id = $2 and status in ('waiting', 'offered') for update", [courseId, wid]);
    if (!r) throw new NotFound('They’re no longer waiting.');
    const e = entryOf(r);
    if (e.bookingId && e.status === 'offered') await q.query("update bookings set status = 'expired', updated_at = $3 where business_id = $1 and id = $2 and status = 'held'", [courseId, e.bookingId, now]);
    await q.query("update waitlist set status = 'cancelled', updated_at = $3 where business_id = $1 and id = $2", [courseId, wid, now]);
    await audit(q, courseId, c.email, 'standby.removed', e.contactName, `${formatDay(e.day)}, ${e.kind === 'app' ? 'app waitlist' : 'standby'}`, null, now);
    if (e.kind === 'app' && e.golferId) {
      await tell(q, e.golferId, { businessId: courseId, kind: 'waitlist_removed', refId: `removed:${wid}`, title: 'You’re off the waitlist',
        body: `The course took you off the waitlist for ${formatDay(e.day)}. Call them if you still want to play.`, link: '/play/bookings' }, now);
    }
  });
  void setup;
  return { ok: true };
}

/** Everyone waiting on a day, in order: the counter's standby groups and the app's waitlist. For the tee sheet. */
export async function dayWaiting(db: Db, courseId: string, d: string) {
  const rows = await db.query("select * from waitlist where business_id = $1 and day = $2 and status in ('waiting', 'offered') order by created_at", [courseId, d]);
  const out = [];
  for (const r of rows) {
    const e = entryOf(r);
    const offer = e.status === 'offered' && e.bookingId ? await getBookingIn(db, courseId, e.bookingId).catch(() => null) : null;
    out.push({ id: e.id, kind: e.kind, contactName: e.contactName, mobile: e.mobile, notes: e.notes, players: e.players, from: e.from, to: e.to, layoutId: e.layoutId,
      status: e.status, since: e.createdAt, offer: offer ? { time: offer.time, startTee: offer.startTee, until: e.offerExpiresAt } : null });
  }
  return out;
}

// ---------------------------------------------------------------- golfers: the app waitlist

/** A golfer joins the waitlist for a range of times on a day, for a group of their size. */
export async function joinWaitlist(db: Db, c: Caller, slug: string, input: Record<string, unknown>, now = Date.now()) {
  const g = await needProfile(db, c);
  const courseId = await liveCourseId(db, slug);
  const setup = await loadSetup(db, courseId);
  const win = publicWindow(setup, now);
  const d = dayOf(input.day, 'the day');
  if (d < win.today || d > win.lastDay) throw new UserError('You can join the waitlist for the days open to booking in the app.');
  const players = int(input.players, 'the number of players', 1, setup.rules.maxPlayersPerBooking);
  const least = minPlayers(setup, d);
  if (players < least) throw new UserError(`The course asks for at least ${least} players on this day.`);
  const from = minutes(input.from, 'the earliest time'), to = minutes(input.to, 'the latest time');
  if (to < from) throw new UserError('The latest time must be after the earliest.');
  const layoutId = input.layoutId ? text(input.layoutId, 'the course', { max: 40 }) : null;
  if (teeMoment(setup, { day: d, time: to }) <= now) throw new UserError('Those times have already gone by today.');
  const [already] = await db.query("select 1 from waitlist where business_id = $1 and golfer_account = $2 and day = $3 and status in ('waiting', 'offered')", [courseId, c.accountId, d]);
  if (already) throw new UserError('You’re already on the waitlist for this day. Leave it first to change your times.');
  const open = (await publicSlots(db, courseId, setup, d, now)).flatMap((l) => l.slots).filter((s) => fits(setup, { layoutId, from, to, players }, s, now)).sort((a, b) => a.time - b.time);
  if (open.length) throw new UserError(`${formatTime(open[0].time)} is open for ${players}. Book it instead.`);
  const id = newId();
  await db.tx(async (q) => {
    await q.query(
      `insert into waitlist (business_id, id, kind, golfer_account, layout_id, day, from_min, to_min, players, contact_name, mobile, created_by, created_at, updated_at)
       values ($1, $2, 'app', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`, [courseId, id, c.accountId, layoutId, d, from, to, players, g.name, g.mobile, c.email, now]);
    await audit(q, courseId, c.email, 'waitlist.joined', g.name, `${formatDay(d)}, ${players} players, ${range({ from, to })}`, null, now);
  });
  return { ok: true, id };
}

/** The golfer's waitlist entries, with any time being offered to them. */
export async function myWaitlist(db: Db, c: Caller, now = Date.now()) {
  const since = localParts(now - 86_400_000, 'Asia/Manila').day;
  const rows = await db.query(
    `select w.*, b.name as course_name, b.slug as course_slug from waitlist w join businesses b on b.id = w.business_id
      where w.golfer_account = $1 and w.day >= $2 and w.status in ('waiting', 'offered', 'missed') order by w.day, w.from_min`, [c.accountId, since]);
  const out = [];
  for (const r of rows) {
    const e = entryOf(r);
    const held = e.status === 'offered' && e.bookingId ? await getBookingIn(db, e.businessId, e.bookingId).catch(() => null) : null;
    const offer = held && held.status === 'held' && (e.offerExpiresAt ?? 0) > now
      ? { layoutId: held.layoutId, startTee: held.startTee, time: held.time, free: held.players, until: e.offerExpiresAt } : null;
    out.push({ id: e.id, day: e.day, from: e.from, to: e.to, players: e.players, status: offer ? 'offered' : e.status === 'offered' ? 'waiting' : e.status,
      course: { name: r.course_name as string, slug: r.course_slug as string }, offer });
  }
  return out;
}

export async function leaveWaitlist(db: Db, c: Caller, wid: string, now = Date.now()) {
  await db.tx(async (q) => {
    const [r] = await q.query("select * from waitlist where id = $1 and golfer_account = $2 and status in ('waiting', 'offered', 'missed') for update", [wid, c.accountId]);
    if (!r) throw new NotFound('You’re not on this waitlist.');
    const e = entryOf(r);
    if (e.bookingId && e.status === 'offered') await q.query("update bookings set status = 'expired', updated_at = $3 where business_id = $1 and id = $2 and status = 'held'", [e.businessId, e.bookingId, now]);
    await q.query("update waitlist set status = 'cancelled', updated_at = $3 where business_id = $1 and id = $2", [e.businessId, wid, now]);
  });
  return { ok: true };
}

// ---------------------------------------------------------------- the server's round, every minute

/** Holds a time that opened for the first golfer in line, for the club's claim time, and tells them. */
async function makeOffer(db: Db, setup: CourseSetup, e: Entry, s: Slot, course: { name: string; slug: string }, now: number) {
  const [g] = await db.query<{ residency: 'local' | 'foreign' }>('select residency from golfers where account_id = $1', [e.golferId]);
  const type = typeFor(setup, g?.residency ?? 'local');
  const w = { layoutId: s.layoutId, startTee: s.startTee, day: e.day, time: s.time, players: e.players };
  const pick = pickOf(setup, { playerTypes: Array.from({ length: e.players }, () => type) }, e.players);
  const until = now + setup.rules.waitlistClaimMinutes * 60_000;
  await db.tx(async (q) => {
    await lockSlot(q, e.businessId, w.layoutId, w.startTee, w.day, w.time);
    await checkSlot(q, setup, e.businessId, w, now);
    const price = priceOf(setup, w, pick);
    const each = greenFees(setup, w, price, pick.types);
    const id = newId();
    const ref = await insertRef(q, e.businessId);
    await q.query(
      `insert into bookings (business_id, id, ref, layout_id, start_tee, day, time_min, players, status, channel, hold_expires_at, golfer_account, contact_name, mobile, email, notes,
        amount, created_by, created_at, updated_at, holes, carts, caddies, gallery, extras, quote, pay_in_app)
        values ($1, $2, $3, $4, $5, $6, $7, $8, 'held', 'app', $9, $10, $11, $12, '', 'Waitlist offer', $13, 'waitlist', $14, $14, $15, $16, $17, $18, '[]', $19, 0)`,
      [e.businessId, id, ref, w.layoutId, w.startTee, w.day, w.time, w.players, until, e.golferId, e.contactName, e.mobile, price.total, now,
        price.holes, price.carts, price.caddies, price.gallery, JSON.stringify(price.lines)]);
    for (let n = 1; n <= w.players; n++) {
      await q.query('insert into booking_players (business_id, booking_id, n, name, player_type_id, rate) values ($1, $2, $3, $4, $5, $6)',
        [e.businessId, id, n, n === 1 ? e.contactName : '', pick.types[n - 1], each[n - 1]]);
    }
    await q.query("update waitlist set status = 'offered', booking_id = $3, offer_expires_at = $4, updated_at = $5 where business_id = $1 and id = $2", [e.businessId, e.id, id, until, now]);
    await audit(q, e.businessId, 'MaisonFore', 'waitlist.offered', `${ref} · ${e.contactName}`, `${formatDay(w.day)} ${formatTime(w.time)} held for the waitlist until ${clockAt(setup, until)}`, null, now);
    await tell(q, e.golferId!, { businessId: e.businessId, kind: 'offer', refId: `offer:${e.id}:${id}`, title: `${formatTime(w.time)} opened up for you`,
      body: `${course.name}, ${formatDay(w.day)}: ${formatTime(w.time)} for ${w.players}. Book it by ${clockAt(setup, until)}, or it goes to the next golfer in line.`, link: '/play/bookings' }, now);
  });
}

/** Offers and alerts for the app waitlist; offers nobody claimed go to the next in line. */
export async function runWaitlist(db: Db, now = Date.now()) {
  // Offers that ran out: the hold is released and the golfer is off the list for that day.
  const missed = await db.query("update waitlist set status = 'missed', updated_at = $1 where status = 'offered' and offer_expires_at <= $1 returning business_id, id, golfer_account, booking_id, day", [now]);
  for (const m of missed) {
    await db.query("update bookings set status = 'expired', updated_at = $3 where business_id = $1 and id = $2 and status = 'held'", [m.business_id, m.booking_id, now]);
    if (m.golfer_account) await tell(db, m.golfer_account as string, { businessId: m.business_id as string, kind: 'offer_missed', refId: `missed:${m.id}`, title: 'The time went to the next golfer',
      body: `You didn’t book the time offered for ${formatDay(m.day as string)} in time, so it went to the next golfer in line.`, link: '/play/bookings' }, now);
  }
  const groups = await db.query<{ business_id: string; day: string; name: string; slug: string }>(
    `select distinct w.business_id, w.day, b.name, b.slug from waitlist w join businesses b on b.id = w.business_id where w.kind = 'app' and w.status = 'waiting'`);
  for (const gr of groups) {
    const setup = await loadSetup(db, gr.business_id);
    const today = localParts(now, setup.timeZone).day;
    if (gr.day < today) { await db.query("update waitlist set status = 'expired', updated_at = $3 where business_id = $1 and day = $2 and status = 'waiting'", [gr.business_id, gr.day, now]); continue; }
    const waiting = (await db.query("select * from waitlist where business_id = $1 and day = $2 and kind = 'app' and status = 'waiting' order by created_at", [gr.business_id, gr.day])).map(entryOf);
    const slots = (await publicSlots(db, gr.business_id, setup, gr.day, now)).flatMap((l) => l.slots.map((s) => ({ ...s })));
    for (const e of waiting) {
      if (teeMoment(setup, { day: e.day, time: e.to }) <= now) { await db.query("update waitlist set status = 'expired', updated_at = $3 where business_id = $1 and id = $2", [e.businessId, e.id, now]); continue; }
      const open = slots.filter((s) => fits(setup, e, s, now)).sort((a, b) => a.time - b.time);
      if (!open.length) continue;
      const later = open.find((s) => teeMoment(setup, s) - now > OFFER_AHEAD);
      if (later) {
        try { await makeOffer(db, setup, e, later, gr, now); later.free -= e.players; later.used += e.players; } catch { /* someone booked it first */ }
        continue;
      }
      // Under an hour to go: tell everyone who fits, once per time; the first to book gets it.
      const fresh = open.filter((s) => !e.toldTimes.includes(s.time));
      if (!fresh.length) continue;
      const s = fresh[0];
      await tell(db, e.golferId!, { businessId: e.businessId, kind: 'open_now', refId: `open:${e.id}:${s.time}`, title: `${formatTime(s.time)} is open now`,
        body: `${gr.name}, today: ${formatTime(s.time)} has room for ${e.players}. Others on the waitlist were told too, so book quickly. Pay at the counter before teeing off.`,
        link: `/play/c/${gr.slug}?day=${e.day}` }, now);
      await db.query('update waitlist set told_times = $3, last_told_at = $4, updated_at = $4 where business_id = $1 and id = $2', [e.businessId, e.id, JSON.stringify([...e.toldTimes, ...fresh.map((x) => x.time)]), now]);
    }
  }
  // Counter standby lists end with their day.
  await db.query(`update waitlist set status = 'expired', updated_at = $2 where kind = 'standby' and status = 'waiting' and day < $1`, [localParts(now, 'Asia/Manila').day, now]);
}

/** Reminds app golfers to pay before their deadline, and tells them when their time has opened to others. */
export async function payReminders(db: Db, now = Date.now()) {
  const rows = await db.query<{ business_id: string; id: string; golfer_account: string; day: string; time_min: number; pay_due_by: string; name: string; slug: string }>(
    `select bk.business_id, bk.id, bk.golfer_account, bk.day, bk.time_min, bk.pay_due_by, b.name, b.slug from bookings bk join businesses b on b.id = bk.business_id
      where bk.golfer_account is not null and bk.status = 'confirmed' and bk.pay_status = 'unpaid' and bk.pay_due_by is not null and bk.pay_due_by > $1 and bk.pay_due_by <= $2`,
    [now - HOUR, now + 2 * HOUR]);
  for (const r of rows) {
    const setup = await loadSetup(db, r.business_id);
    const due = Number(r.pay_due_by);
    const when = `${r.name}, ${formatDay(r.day)} ${formatTime(r.time_min)}`;
    // Clubs where golfers pay after playing ask them to arrive and register by the deadline instead.
    const after = setup.rules.payWhen === 'after';
    if (due > now) {
      await tell(db, r.golfer_account, { businessId: r.business_id, kind: 'pay_reminder', refId: `pay:${r.id}:${due}`, title: `Arrive and ${after ? 'register' : 'pay'} by ${clockAt(setup, due)}`,
        body: `${when}: ${after ? 'register' : 'pay'} at the counter by ${clockAt(setup, due)} to keep your tee time. After that it opens to other golfers.`, link: '/play/bookings' }, now);
    } else {
      await tell(db, r.golfer_account, { businessId: r.business_id, kind: 'lapsed', refId: `lapsed:${r.id}:${due}`, title: 'Your tee time is open to others',
        body: `${when}: you didn’t ${after ? 'register' : 'pay'} by ${clockAt(setup, due)}, so other golfers can book it now. If it’s still free when you arrive, ${after ? 'register' : 'pay'} at the counter and keep it.`, link: '/play/bookings' }, now);
    }
  }
}

/** Everything the server does on its own each minute. */
export async function everyMinute(db: Db, now = Date.now()) {
  await expireHolds(db, now);
  await runWaitlist(db, now);
  await payReminders(db, now);
  await sendAlerts(db, now);
}

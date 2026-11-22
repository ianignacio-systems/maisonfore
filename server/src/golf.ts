import { audit, NotFound, UserError, type Caller, type Db } from '@maison/core';
import {
  buildSheet, dayType, formatDay, formatTime, golferCanChange, isOpen, localParts, opensMessage, priceFor, publicWindow, STATUS_WORDS,
  type CourseSetup,
} from '@maison/engine';
import {
  BOOKING_COLS, bookingOf, checkSlot, getBookingIn, greenFees, insertRef, lockBooking, lockSlot, moveBooking, pickOf, playerNamesOf, priceOf, wanted,
  type BookingRow,
} from './bookings';
import { day as dayOf, mobile, oneOf, text } from './check';
import { getCourse, loadSetup } from './courses';
import { newId } from '@maison/core';

/**
 * The golfer app (APP-1, APP-2): a golfer's profile, finding partner courses, their open tee times, and
 * booking, cancelling and changing time within each course's rules. Golfers only ever see live courses and
 * open times, never who else is booked.
 */

export interface Golfer { name: string; mobile: string; residency: 'local' | 'foreign' }

export async function golferProfile(db: Db, c: Caller) {
  const [g] = await db.query<{ name: string; mobile: string; residency: 'local' | 'foreign' }>('select name, mobile, residency from golfers where account_id = $1', [c.accountId]);
  return { email: c.email, profile: g ?? null };
}

/** Sign-up's second step, and later edits: name, mobile, local or foreign, and the privacy notice. */
export async function saveProfile(db: Db, c: Caller, input: Record<string, unknown>, now = Date.now()) {
  const name = text(input.name, 'your name', { required: true, max: 80 });
  const m = mobile(input.mobile);
  if (!m) throw new UserError('Enter your mobile number, so the course can reach you about your booking.');
  const residency = oneOf(input.residency, 'local or foreign', ['local', 'foreign'] as const);
  const [had] = await db.query('select 1 from golfers where account_id = $1', [c.accountId]);
  if (!had && input.acceptPrivacy !== true) throw new UserError('Agree to the privacy notice to continue.');
  await db.query(
    `insert into golfers (account_id, name, mobile, residency, privacy_accepted_at, created_at, updated_at) values ($1, $2, $3, $4, $5, $5, $5)
     on conflict (account_id) do update set name = excluded.name, mobile = excluded.mobile, residency = excluded.residency, updated_at = excluded.updated_at`,
    [c.accountId, name, m, residency, now]);
  return golferProfile(db, c);
}

async function needProfile(db: Db, c: Caller): Promise<Golfer> {
  const { profile } = await golferProfile(db, c);
  if (!profile) throw new UserError('Finish your profile first: your name, mobile number, and whether you’re local or foreign.');
  return profile;
}

async function liveCourseId(db: Db, slug: string): Promise<string> {
  const [r] = await db.query<{ id: string }>(
    "select b.id from slugs s join businesses b on b.id = s.business_id join courses c on c.business_id = b.id where s.slug = $1 and c.status = 'live'", [slug.toLowerCase()]);
  if (!r) throw new NotFound('This course isn’t taking bookings in the app.');
  return r.id;
}

/** The public player types a golfer can book as, Local first for locals and Foreign first for foreigners. */
const publicTypes = (s: CourseSetup) => s.playerTypes.filter((t) => t.public && t.active && !t.member);

/** The lowest public 18-hole green fee on a day: "from ₱3,300". */
function fromPrice(s: CourseSetup, d: string): number | null {
  const prices = publicTypes(s).map((t) => priceFor(s, t.id, 18, d, 8 * 60)).filter((p): p is number => p !== null);
  return prices.length ? Math.min(...prices) : null;
}

async function publicSlots(db: Db, courseId: string, s: CourseSetup, d: string, now: number) {
  const bookings = (await db.query(`select ${BOOKING_COLS} from bookings where business_id = $1 and day = $2`, [courseId, d])).map(bookingOf);
  const blocks = (await db.query('select * from blocks where business_id = $1 and day = $2 and removed_at is null', [courseId, d])).map((r) => ({
    id: r.id as string, layoutId: (r.layout_id as string) ?? null, startTee: (r.start_tee as string) ?? null, day: r.day as string, from: r.from_min as number,
    to: r.to_min as number, kind: r.kind as 'walkin', reason: r.reason as string, releaseAt: (r.release_at as number) ?? null }));
  return s.layouts.filter((l) => l.active).map((l) => ({
    layout: { id: l.id, name: l.name, holes: l.holes, startTees: l.startTees },
    slots: buildSheet(s, { layoutId: l.id, day: d, bookings, blocks, now, audience: 'public' }),
  }));
}

/** Partner courses that are live, with their lowest price and open tee times on a day. */
export async function findCourses(db: Db, input: { q?: unknown; day?: unknown }, now = Date.now()) {
  const q = text(input.q, 'the search', { max: 80 }).toLowerCase();
  const rows = await db.query<{ id: string; slug: string; name: string; city: string; province: string; description: string; facilities: string[] }>(
    `select b.id, b.slug, b.name, c.city, c.province, c.description, c.facilities from courses c join businesses b on b.id = c.business_id
      where c.status = 'live' order by b.name`);
  const out = [];
  for (const r of rows) {
    if (q && ![r.name, r.city, r.province].some((x) => (x ?? '').toLowerCase().includes(q))) continue;
    const s = await loadSetup(db, r.id);
    const win = publicWindow(s, now);
    const d = input.day ? dayOf(input.day) : win.today;
    const layouts = d > win.lastDay ? [] : await publicSlots(db, r.id, s, d, now);
    const open = layouts.flatMap((l) => l.slots).filter((x) => (x.state === 'open' || x.state === 'partial') && x.free > 0).sort((a, b) => a.time - b.time);
    out.push({
      id: r.id, slug: r.slug, name: r.name, city: r.city, province: r.province, description: r.description, facilities: r.facilities ?? [],
      day: d, fromPrice: fromPrice(s, d), openSlots: open.length, nextTimes: [...new Set(open.map((x) => x.time))].slice(0, 5),
      notYet: d > win.lastDay ? opensMessage(s, d) : null, holes: [...new Set(s.layouts.filter((l) => l.active).map((l) => l.holes))],
    });
  }
  return out.sort((a, b) => Number(b.openSlots > 0) - Number(a.openSlots > 0) || a.name.localeCompare(b.name));
}

/** A course's page: details, and what the app needs to price a booking (public player types, rates, fees, rules). */
export async function coursePage(db: Db, slug: string, now = Date.now()) {
  const id = await liveCourseId(db, slug);
  const c = await getCourse(db, id);
  const s = await loadSetup(db, id);
  const types = publicTypes(s);
  const win = publicWindow(s, now);
  return {
    course: { id, slug: c.slug, name: c.name, address: c.address, city: c.city, province: c.province, phone: c.phone, description: c.description, facilities: c.facilities },
    window: { today: win.today, lastDay: win.lastDay },
    setup: {
      ...s,
      layouts: s.layouts.filter((l) => l.active),
      playerTypes: types,
      rates: s.rates.filter((r) => types.some((t) => t.id === r.playerTypeId)),
      fees: s.fees.filter((f) => f.active),
      settings: [],
    },
  };
}

/** Open tee times on a day, by course layout. Only times golfers can book; never who else is booked. */
export async function courseTimes(db: Db, slug: string, input: { day?: unknown }, now = Date.now()) {
  const id = await liveCourseId(db, slug);
  const s = await loadSetup(db, id);
  const win = publicWindow(s, now);
  const d = input.day ? dayOf(input.day) : win.today;
  if (d > win.lastDay) return { day: d, notYet: opensMessage(s, d), layouts: [] };
  if (d < win.today) return { day: d, notYet: 'That day has passed.', layouts: [] };
  const layouts = await publicSlots(db, id, s, d, now);
  return {
    day: d, notYet: null, dayType: dayType(d, s.holidays),
    layouts: layouts.map((l) => ({
      ...l.layout,
      slots: l.slots.filter((x) => (x.state === 'open' || x.state === 'partial') && x.free > 0).map((x) => ({ time: x.time, startTee: x.startTee, free: x.free, capacity: x.capacity })),
    })),
  };
}

async function golferCounts(db: Db, c: Caller, courseId: string, now: number) {
  const mine = (await db.query(`select ${BOOKING_COLS} from bookings where business_id = $1 and golfer_account = $2`, [courseId, c.accountId])).map(bookingOf);
  const since = localParts(now - 90 * 86_400_000, 'Asia/Manila').day;
  return { openBookings: mine.filter((b) => isOpen(b, now)).length, recentNoShows: mine.filter((b) => b.status === 'no_show' && b.day >= since).length };
}

/** A golfer books in the app: the app's rules apply (window, minimum players, open-bookings and no-show limits), paid at the course for now. */
export async function golferBook(db: Db, c: Caller, slug: string, input: Record<string, unknown>, now = Date.now()): Promise<BookingRow> {
  const g = await needProfile(db, c);
  const courseId = await liveCourseId(db, slug);
  const setup = await loadSetup(db, courseId);
  const w = wanted(input);
  const allowed = new Set(publicTypes(setup).map((t) => t.id));
  const pick = pickOf(setup, input, w.players);
  if (pick.types.some((t) => !allowed.has(t))) throw new UserError('Pick a player type you can book in the app.');
  const names = playerNamesOf(setup, input, w.players, g.name);
  const notes = text(input.notes, 'the note', { max: 300 });
  const counts = await golferCounts(db, c, courseId, now);
  return db.tx(async (q) => {
    await lockSlot(q, courseId, w.layoutId, w.startTee, w.day, w.time);
    await checkSlot(q, setup, courseId, w, now, undefined, counts);
    const price = priceOf(setup, w, pick);
    if (price.problems.length) throw new UserError(price.problems[0]);
    const each = greenFees(setup, w, price, pick.types);
    const id = newId();
    const ref = await insertRef(q, courseId);
    await q.query(
      `insert into bookings (business_id, id, ref, layout_id, start_tee, day, time_min, players, status, channel, golfer_account, contact_name, mobile, email, notes,
        amount, created_by, created_at, updated_at, holes, carts, caddies, gallery, extras, quote, pay_in_app)
        values ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', 'app', $9, $10, $11, $12, $13, $14, $15, $16, $16, $17, $18, $19, $20, $21, $22, 0)`,
      [courseId, id, ref, w.layoutId, w.startTee, w.day, w.time, w.players, c.accountId, g.name, g.mobile, c.email, notes, price.total, c.email, now,
        price.holes, price.carts, price.caddies, price.gallery, JSON.stringify(pick.extras), JSON.stringify(price.lines)]);
    for (let n = 1; n <= w.players; n++) {
      await q.query('insert into booking_players (business_id, booking_id, n, name, player_type_id, rate) values ($1, $2, $3, $4, $5, $6)',
        [courseId, id, n, names[n - 1], pick.types[n - 1], each[n - 1]]);
    }
    await audit(q, courseId, c.email, 'booking.app', `${ref} · ${g.name}`, `${formatDay(w.day)} ${formatTime(w.time)}, ${w.players} players, booked in the app`, null, now);
    return getBookingIn(q, courseId, id);
  });
}

/** The golfer's bookings at every course: coming up first, then the last 90 days. */
export async function myBookings(db: Db, c: Caller, now = Date.now()) {
  const since = localParts(now - 90 * 86_400_000, 'Asia/Manila').day;
  const rows = await db.query(
    `select ${BOOKING_COLS.split(',').map((x) => `bk.${x.trim()}`).join(', ')}, b.name as course_name, b.slug as course_slug, c.phone as course_phone, c.time_zone
       from bookings bk join businesses b on b.id = bk.business_id join courses c on c.business_id = bk.business_id
      where bk.golfer_account = $1 and bk.day >= $2 order by bk.day, bk.time_min`, [c.accountId, since]);
  const setups = new Map<string, CourseSetup>();
  const out = [];
  for (const r of rows) {
    const b = bookingOf(r);
    const courseId = (await db.query<{ business_id: string }>('select business_id from bookings where id = $1 and golfer_account = $2', [b.id, c.accountId]))[0].business_id;
    if (!setups.has(courseId)) setups.set(courseId, await loadSetup(db, courseId));
    const s = setups.get(courseId)!;
    const names = await db.query<{ n: number; name: string; player_type_id: string }>('select n, name, player_type_id from booking_players where business_id = $1 and booking_id = $2 order by n', [courseId, b.id]);
    const today = localParts(now, s.timeZone).day;
    out.push({
      id: b.id, ref: b.ref, day: b.day, time: b.time, players: b.players, holes: b.holes, status: b.status, statusWords: STATUS_WORDS[b.status],
      amount: b.amount, quote: b.quote, payStatus: b.payStatus, carts: b.carts, caddies: b.caddies, gallery: b.gallery,
      course: { slug: r.course_slug as string, name: r.course_name as string, phone: r.course_phone as string },
      layoutName: s.layouts.length > 1 ? s.layouts.find((l) => l.id === b.layoutId)?.name ?? '' : '', startTee: b.startTee,
      roster: names.map((p) => ({ name: p.name, type: s.playerTypes.find((t) => t.id === p.player_type_id)?.name ?? '' })),
      upcoming: b.day >= today && (b.status === 'confirmed' || b.status === 'held'),
      canChange: golferCanChange(s, b, now), cutoffHours: s.rules.cancelCutoffHours,
    });
  }
  return out.sort((a, b) => Number(b.upcoming) - Number(a.upcoming) || (a.upcoming ? a.day.localeCompare(b.day) || a.time - b.time : b.day.localeCompare(a.day)));
}

async function ownBooking(db: Db, c: Caller, id: string) {
  const [r] = await db.query<{ business_id: string }>('select business_id from bookings where id = $1 and golfer_account = $2', [id, c.accountId]);
  if (!r) throw new NotFound('Booking not found.');
  return r.business_id;
}

/** The golfer cancels, up to the course's cutoff. */
export async function golferCancel(db: Db, c: Caller, id: string, now = Date.now()) {
  const courseId = await ownBooking(db, c, id);
  const setup = await loadSetup(db, courseId);
  return db.tx(async (q) => {
    const b = await lockBooking(q, courseId, id);
    if (!golferCanChange(setup, b, now)) throw new UserError(`Bookings can be cancelled in the app up to ${setup.rules.cancelCutoffHours} hours before the tee time. Call the course.`);
    await q.query("update bookings set status = 'cancelled', cancel_reason = 'Cancelled by the golfer in the app', updated_at = $3 where business_id = $1 and id = $2", [courseId, id, now]);
    await audit(q, courseId, c.email, 'booking.cancelled', `${b.ref} · ${b.contactName}`, 'Cancelled by the golfer in the app', null, now);
    return { ok: true };
  });
}

/** The golfer changes the time (same course, any day the app allows), up to the course's cutoff. */
export async function golferMove(db: Db, c: Caller, id: string, input: Record<string, unknown>, now = Date.now()) {
  const courseId = await ownBooking(db, c, id);
  const counts = await golferCounts(db, c, courseId, now);
  const b = await moveBooking(db, c, courseId, id, { layoutId: input.layoutId, startTee: input.startTee, day: input.day, time: input.time }, now, counts);
  return { ok: true, ref: b.ref };
}

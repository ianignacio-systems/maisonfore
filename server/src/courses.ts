import {
  audit, COMMON_RESERVED, Forbidden, isPlatformAdmin, memberRole, newId, NotFound, platformLog, slugify, UserError, validSlug, type Caller, type Db,
} from '@maison/core';
import {
  checkSettings, DEFAULT_OPTIONS, DEFAULT_RULES, localParts, starterSetup, type BookingRules, type CourseOptions, type Fee, type FeeAmount, type CourseSetup, type DayType, type Layout, type PlayerType, type Rate, type SheetSettings, type TimeBand,
} from '@maison/engine';
import { day, int, minutes, oneOf, text } from './check';

export type Role = 'owner' | 'manager' | 'starter' | 'viewer';
export const ROLES: readonly Role[] = ['owner', 'manager', 'starter', 'viewer'];
/**
 * Who may do what. Viewers see the tee sheet and bookings but change nothing; starters run the day's
 * tee sheet; managers also set the course up; owners also manage staff.
 */
export const CAN = {
  view: ROLES,
  daily: ['owner', 'manager', 'starter'] as const,
  setup: ['owner', 'manager'] as const,
  records: ['owner', 'manager'] as const,
  staff: ['owner'] as const,
};

export const RESERVED = new Set([...COMMON_RESERVED, 'maisonfore', 'golf', 'golfer', 'golfers', 'courses', 'course', 'book', 'booking', 'bookings', 'teetime', 'teetimes', 'app', 'play', 'golf']);

export type CourseStatus = 'draft' | 'review' | 'live' | 'paused' | 'declined';

export interface CourseRow {
  id: string; name: string; slug: string; status: CourseStatus; address: string; city: string; province: string;
  lat: number | null; lng: number | null; timeZone: string; currency: string; phone: string; email: string; description: string;
  facilities: string[]; reviewNote: string; submittedAt: number | null; reviewedAt: number | null; maisonId: string;
}

const COURSE_SELECT = `select b.id, b.name, b.slug, b.maison_id, c.status, c.address, c.city, c.province, c.lat, c.lng, c.time_zone, c.currency, c.phone,
  c.email, c.description, c.facilities, c.review_note, c.submitted_at, c.reviewed_at from courses c join businesses b on b.id = c.business_id`;

function courseOf(r: Record<string, unknown>): CourseRow {
  return {
    id: r.id as string, name: r.name as string, slug: (r.slug as string) ?? '', status: r.status as CourseStatus, address: r.address as string,
    city: r.city as string, province: r.province as string, lat: (r.lat as number) ?? null, lng: (r.lng as number) ?? null, timeZone: r.time_zone as string,
    currency: r.currency as string, phone: r.phone as string, email: r.email as string, description: r.description as string,
    facilities: (r.facilities as string[]) ?? [], reviewNote: r.review_note as string, submittedAt: (r.submitted_at as number) ?? null,
    reviewedAt: (r.reviewed_at as number) ?? null, maisonId: r.maison_id as string,
  };
}

/** The caller's role at a course; a course they don't belong to looks like one that doesn't exist. */
export async function roleAt(db: Db, c: Caller, courseId: string, allowed?: readonly Role[]): Promise<Role> {
  try {
    return await memberRole<Role>(db, c, courseId, allowed);
  } catch (e) {
    if (e instanceof NotFound) throw new NotFound('Course not found.');
    if (e instanceof Forbidden) throw new Forbidden('Your role at this course can’t do this. Ask the owner.');
    throw e;
  }
}

export async function getCourse(db: Db, id: string): Promise<CourseRow> {
  const [r] = await db.query(`${COURSE_SELECT} where b.id = $1`, [id]);
  if (!r) throw new NotFound('Course not found.');
  return courseOf(r);
}

/** The account and the courses it can open. */
export async function me(db: Db, c: Caller) {
  const courses = await db.query<{ id: string; name: string; slug: string; role: Role; status: CourseStatus }>(
    `select b.id, b.name, coalesce(b.slug, '') as slug, m.role, c.status from members m join businesses b on b.id = m.business_id
       join courses c on c.business_id = b.id where m.account_id = $1 order by b.name`, [c.accountId]);
  return { account: { id: c.accountId, email: c.email }, courses, admin: await isPlatformAdmin(db, c) };
}

/** Public: a course's name at its address, for the sign-in page. */
export async function courseAtAddress(db: Db, slug: string) {
  const [r] = await db.query<{ id: string; name: string; slug: string }>(
    'select b.id, b.name, b.slug from slugs s join businesses b on b.id = s.business_id where s.slug = $1', [slug.toLowerCase()]);
  if (!r) throw new NotFound('No course at this address.');
  return r;
}

export interface NewPartner { name?: unknown; address?: unknown; city?: unknown; province?: unknown; phone?: unknown; email?: unknown }

/**
 * Become a partner (PTR-1): the course, as a Maison business, with the caller as its owner, its own
 * address, and a starter tee sheet (18 holes, 6:00 AM to 2:00 PM every 8 minutes) to change in Course setup.
 * It stays a draft until the owner submits it and Maison verifies it.
 */
export async function createPartner(db: Db, c: Caller, input: NewPartner, now = Date.now()): Promise<CourseRow> {
  const name = text(input.name, 'the course name', { required: true, max: 80 });
  const address = text(input.address, 'the address', { required: true, max: 200 });
  const city = text(input.city, 'the city or town', { required: true, max: 80 });
  const province = text(input.province, 'the province', { required: true, max: 80 });
  const phone = text(input.phone, 'the phone number', { required: true, max: 30 });
  const email = text(input.email, 'the email', { max: 120 }) || c.email;
  const owned = await db.query("select 1 from members where account_id = $1 and role = 'owner'", [c.accountId]);
  if (owned.length >= 5) throw new UserError('This account already owns 5 courses. Contact Maison to add more.');
  const id = newId();
  return db.tx(async (q) => {
    const base = slugify(name, RESERVED, 'golf');
    let slug = base;
    for (let i = 2; (await q.query('select 1 from slugs where slug = $1', [slug])).length; i++) slug = `${base.slice(0, 28)}${i}`;
    await q.query('insert into businesses (id, name, owner_account, slug, created_at) values ($1, $2, $3, $4, $5)', [id, name, c.accountId, slug, now]);
    await q.query('insert into slugs (slug, business_id, created_at) values ($1, $2, $3)', [slug, id, now]);
    await q.query("insert into members (business_id, account_id, email, role, added_at) values ($1, $2, $3, 'owner', $4)", [id, c.accountId, c.email, now]);
    await q.query(
      `insert into courses (business_id, address, city, province, phone, email, rules, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, address, city, province, phone, email, JSON.stringify(DEFAULT_RULES), now]);
    const today = localParts(now, 'Asia/Manila').day;
    const start = starterSetup({ layoutId: newId(), localTypeId: newId(), foreignTypeId: newId() }, today);
    await saveLayouts(q, id, start.layouts);
    for (const s of start.settings) await insertSettings(q, id, s);
    for (const [i, p] of start.playerTypes.entries()) {
      await q.query('insert into player_types (business_id, id, name, public, member, proof, sort) values ($1, $2, $3, $4, $5, $6, $7)', [id, p.id, p.name, p.public, p.member, p.proof, i]);
    }
    await audit(q, id, c.email, 'course.created', name, `Address maisonfore.com/${slug}`, null, now);
    return courseOf((await q.query(`${COURSE_SELECT} where b.id = $1`, [id]))[0]);
  });
}

/** The course page and contact details (owner and manager). */
export async function updateCourse(db: Db, c: Caller, id: string, input: Record<string, unknown>, now = Date.now()): Promise<CourseRow> {
  await roleAt(db, c, id, CAN.setup);
  const name = text(input.name, 'the course name', { required: true, max: 80 });
  const fields = {
    address: text(input.address, 'the address', { required: true, max: 200 }),
    city: text(input.city, 'the city or town', { required: true, max: 80 }),
    province: text(input.province, 'the province', { required: true, max: 80 }),
    phone: text(input.phone, 'the phone number', { required: true, max: 30 }),
    email: text(input.email, 'the email', { max: 120 }),
    description: text(input.description, 'the description', { max: 2000 }),
  };
  const facilities = Array.isArray(input.facilities) ? input.facilities.map((f) => text(f, 'a facility', { max: 60 })).filter(Boolean).slice(0, 30) : [];
  const lat = input.lat === null || input.lat === undefined || input.lat === '' ? null : Number(input.lat);
  const lng = input.lng === null || input.lng === undefined || input.lng === '' ? null : Number(input.lng);
  if ((lat !== null && !(lat >= 4 && lat <= 22)) || (lng !== null && !(lng >= 116 && lng <= 127))) throw new UserError('The map location should be in the Philippines.');
  await db.tx(async (q) => {
    await q.query('update businesses set name = $2 where id = $1', [id, name]);
    await q.query(
      `update courses set address = $2, city = $3, province = $4, phone = $5, email = $6, description = $7, facilities = $8, lat = $9, lng = $10 where business_id = $1`,
      [id, fields.address, fields.city, fields.province, fields.phone, fields.email, fields.description, JSON.stringify(facilities), lat, lng]);
    await audit(q, id, c.email, 'course.updated', name, '', null, now);
  });
  return getCourse(db, id);
}

// ---------------------------------------------------------------- tee-sheet setup

/** Everything the engine needs about a course, from the database. */
export async function loadSetup(db: Db, id: string): Promise<CourseSetup> {
  const [c] = await db.query<{ time_zone: string; rules: Partial<BookingRules>; options: Partial<CourseOptions>; member_features: boolean }>(
    'select time_zone, rules, options, member_features from courses where business_id = $1', [id]);
  if (!c) throw new NotFound('Course not found.');
  const layouts = await db.query<{ id: string; name: string; holes: 9 | 18; start_tees: string[]; active: boolean }>(
    'select id, name, holes, start_tees, active from layouts where business_id = $1 order by sort, name', [id]);
  const settings = await db.query<{ layout_id: string; effective_from: string; first_tee: number; last_tee: number; interval_min: number; max_players: number }>(
    'select layout_id, effective_from, first_tee, last_tee, interval_min, max_players from sheet_settings where business_id = $1 order by layout_id, effective_from', [id]);
  const holidays = await db.query<{ day: string }>('select day from holidays where business_id = $1 order by day', [id]);
  const types = await db.query<{ id: string; name: string; public: boolean; member: boolean; proof: string; days: number[]; earliest: number | null; active: boolean }>(
    'select id, name, public, member, proof, days, earliest, active from player_types where business_id = $1 order by sort, name', [id]);
  const fees = await db.query<{ id: string; name: string; kind: Fee['kind']; per: Fee['per']; required: boolean; paid_to: Fee['paidTo']; active: boolean; amounts: FeeAmount[] }>(
    'select id, name, kind, per, required, paid_to, active, amounts from fees where business_id = $1 order by sort, name', [id]);
  const rates = await db.query<{ player_type_id: string; day_type: DayType; holes: 9 | 18; band: TimeBand; effective_from: string; amount: number }>(
    'select player_type_id, day_type, holes, band, effective_from, amount from rates where business_id = $1', [id]);
  return {
    timeZone: c.time_zone,
    layouts: layouts.map((l) => ({ id: l.id, name: l.name, holes: l.holes, startTees: l.start_tees, active: l.active })),
    settings: settings.map((s) => ({ layoutId: s.layout_id, effectiveFrom: s.effective_from, firstTee: s.first_tee, lastTee: s.last_tee, interval: s.interval_min, maxPlayers: s.max_players })),
    holidays: holidays.map((h) => h.day),
    playerTypes: types.map((p) => ({ id: p.id, name: p.name, public: p.public, member: p.member, proof: p.proof, days: p.days ?? [], earliest: p.earliest ?? null, active: p.active })),
    rates: rates.map((r) => ({ playerTypeId: r.player_type_id, dayType: r.day_type, holes: r.holes, band: r.band, effectiveFrom: r.effective_from, amount: r.amount })),
    rules: { ...DEFAULT_RULES, ...c.rules },
    fees: fees.map((f) => ({ id: f.id, name: f.name, kind: f.kind, per: f.per, required: f.required, paidTo: f.paid_to, active: f.active, amounts: f.amounts ?? [] })),
    options: { ...DEFAULT_OPTIONS, ...c.options },
    memberFeatures: c.member_features,
  };
}

/** Marks the course as changed, so open tee sheets refresh. */
const touch = (q: Db, id: string) => q.query('update courses set business_id = business_id where business_id = $1', [id]);

async function saveLayouts(q: Db, id: string, layouts: Layout[]) {
  for (const [i, l] of layouts.entries()) {
    await q.query(
      `insert into layouts (business_id, id, name, holes, start_tees, active, sort) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (business_id, id) do update set name = excluded.name, holes = excluded.holes, start_tees = excluded.start_tees, active = excluded.active, sort = excluded.sort`,
      [id, l.id, l.name, l.holes, l.startTees, l.active, i]);
  }
}

async function insertSettings(q: Db, id: string, s: SheetSettings) {
  await q.query(
    `insert into sheet_settings (business_id, layout_id, effective_from, first_tee, last_tee, interval_min, max_players) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (business_id, layout_id, effective_from) do update set first_tee = excluded.first_tee, last_tee = excluded.last_tee,
       interval_min = excluded.interval_min, max_players = excluded.max_players`,
    [id, s.layoutId, s.effectiveFrom, s.firstTee, s.lastTee, s.interval, s.maxPlayers]);
}

/**
 * Layouts and their tee times. New tee-time settings take effect from a date, so bookings already on
 * the sheet before that date keep their times. Layouts are switched off, never deleted, once used.
 */
export async function saveSheet(db: Db, c: Caller, id: string, input: { layouts?: unknown; settings?: unknown }, now = Date.now()): Promise<CourseSetup> {
  await roleAt(db, c, id, CAN.setup);
  const layouts: Layout[] = (Array.isArray(input.layouts) ? input.layouts : []).map((l: Record<string, unknown>) => {
    const tees = Array.isArray(l.startTees) ? l.startTees.map((t) => text(t, 'a starting tee', { max: 4 })).filter(Boolean) : ['1'];
    if (!tees.length || tees.length > 2 || tees.some((t) => !/^\d{1,2}$/.test(t))) throw new UserError('Each course starts flights from one or two tees, e.g. 1, or 1 and 10.');
    return { id: text(l.id, 'the layout', { max: 40 }) || newId(), name: text(l.name, 'the course name', { required: true, max: 40 }), holes: Number(l.holes) === 9 ? 9 : 18, startTees: tees, active: l.active !== false };
  });
  if (layouts.length > 6) throw new UserError('A club can have up to 6 courses.');
  if (layouts.length && !layouts.some((l) => l.active)) throw new UserError('Keep at least one course open for booking.');
  const settings: SheetSettings[] = (Array.isArray(input.settings) ? input.settings : []).map((s: Record<string, unknown>) => {
    const v = {
      layoutId: text(s.layoutId, 'the layout', { required: true, max: 40 }), effectiveFrom: day(s.effectiveFrom, 'the date the tee time settings start'),
      firstTee: minutes(s.firstTee, 'the first tee time'), lastTee: minutes(s.lastTee, 'the last tee time'),
      interval: int(s.interval, 'the interval', 1, 60), maxPlayers: int(s.maxPlayers, 'players per flight', 1, 5),
    };
    const problems = checkSettings(v);
    if (problems.length) throw new UserError(problems[0]);
    return v;
  });
  await db.tx(async (q) => {
    await saveLayouts(q, id, layouts);
    const known = new Set((await q.query<{ id: string }>('select id from layouts where business_id = $1', [id])).map((r) => r.id));
    for (const s of settings) {
      if (!known.has(s.layoutId)) throw new UserError('Save the layout before its tee time settings.');
      await insertSettings(q, id, s);
    }
    await touch(q, id);
    await audit(q, id, c.email, 'setup.teetimes', 'Layouts and tee time', `${layouts.length} layouts, ${settings.length} tee time settings`, { layouts, settings }, now);
  });
  return loadSetup(db, id);
}

/** Player types and rates. A rate change takes effect from its date; earlier rates stay for earlier days. */
export async function saveRates(db: Db, c: Caller, id: string, input: { playerTypes?: unknown; rates?: unknown; holidays?: unknown }, now = Date.now()): Promise<CourseSetup> {
  await roleAt(db, c, id, CAN.setup);
  const types: PlayerType[] = (Array.isArray(input.playerTypes) ? input.playerTypes : []).map((p: Record<string, unknown>) => {
    const name = text(p.name, 'the player type name', { required: true, max: 40 });
    const days = Array.isArray(p.days) ? [...new Set(p.days.map((d) => int(d, `the days for ${name}`, 0, 6)))].sort() : [];
    return {
      id: text(p.id, 'the player type', { max: 40 }) || newId(), name, public: p.public === true, member: false,
      proof: text(p.proof, `what ${name} golfers show`, { max: 80 }), days: days.length === 7 ? [] : days,
      earliest: p.earliest === null || p.earliest === undefined || p.earliest === '' ? null : minutes(p.earliest, `the earliest tee time for ${name}`),
      active: p.active !== false,
    };
  });
  if (types.length > 20) throw new UserError('A course can have up to 20 player types.');
  if (new Set(types.map((t) => t.name.toLowerCase())).size !== types.length) throw new UserError('Give each player type its own name.');
  if (types.length && !types.some((p) => p.public && p.active)) throw new UserError('Let golfers book at least one player type in the app, e.g. Local.');
  const rates: Rate[] = (Array.isArray(input.rates) ? input.rates : []).map((r: Record<string, unknown>) => ({
    playerTypeId: text(r.playerTypeId, 'the player type', { required: true, max: 40 }),
    dayType: oneOf(r.dayType, 'weekday, weekend or holiday', ['weekday', 'weekend', 'holiday'] as const),
    holes: r.holes === 9 ? 9 : 18,
    band: oneOf(r.band ?? 'regular', 'regular or twilight', ['regular', 'twilight'] as const),
    effectiveFrom: day(r.effectiveFrom, 'the date the rate starts'),
    amount: int(r.amount, 'the rate (in centavos)', 0, 10_000_000),
  }));
  const holidays = (Array.isArray(input.holidays) ? input.holidays : []).map((h: Record<string, unknown>) => ({ day: day(h.day, 'the holiday date'), name: text(h.name, 'the holiday name', { max: 60 }) }));
  await db.tx(async (q) => {
    if (types.length) {
      for (const [i, p] of types.entries()) {
        await q.query(
          `insert into player_types (business_id, id, name, public, member, proof, days, earliest, active, sort) values ($1, $2, $3, $4, false, $5, $6, $7, $8, $9)
           on conflict (business_id, id) do update set name = excluded.name, public = excluded.public, proof = excluded.proof, days = excluded.days,
             earliest = excluded.earliest, active = excluded.active, sort = excluded.sort`, [id, p.id, p.name, p.public, p.proof, p.days, p.earliest, p.active, i]);
      }
    }
    const typeIds = new Set((await q.query<{ id: string }>('select id from player_types where business_id = $1', [id])).map((r) => r.id));
    for (const r of rates) {
      if (!typeIds.has(r.playerTypeId)) throw new UserError('Save the player type before its rates.');
      await q.query(
        `insert into rates (business_id, player_type_id, day_type, holes, band, effective_from, amount) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (business_id, player_type_id, day_type, holes, band, effective_from) do update set amount = excluded.amount`,
        [id, r.playerTypeId, r.dayType, r.holes, r.band, r.effectiveFrom, r.amount]);
    }
    if (Array.isArray(input.holidays)) {
      await q.query('delete from holidays where business_id = $1', [id]);
      for (const h of holidays) await q.query('insert into holidays (business_id, day, name) values ($1, $2, $3) on conflict do nothing', [id, h.day, h.name]);
    }
    await touch(q, id);
    await audit(q, id, c.email, 'setup.rates', 'Player types, rates and holidays', `${rates.length} rates`, { types, rates, holidays }, now);
  });
  return loadSetup(db, id);
}

/** Booking rules (PTR-3). */
export async function saveRules(db: Db, c: Caller, id: string, input: Record<string, unknown>, now = Date.now()): Promise<BookingRules> {
  await roleAt(db, c, id, CAN.setup);
  const r: BookingRules = {
    publicDaysAhead: int(input.publicDaysAhead, 'days ahead the public can book', 0, 60),
    releaseTime: minutes(input.releaseTime, 'the time a new day opens'),
    cancelCutoffHours: int(input.cancelCutoffHours, 'the cancellation cutoff (hours)', 0, 168),
    maxPlayersPerBooking: int(input.maxPlayersPerBooking, 'players per booking', 1, 5),
    maxOpenBookingsPerGolfer: int(input.maxOpenBookingsPerGolfer, 'open bookings per golfer', 1, 10),
    holdMinutes: int(input.holdMinutes, 'the pay-now window (minutes)', 3, 30),
    twilightFrom: input.twilightFrom === null || input.twilightFrom === '' || input.twilightFrom === undefined ? null : minutes(input.twilightFrom, 'the twilight start time'),
    noShowLimit: int(input.noShowLimit, 'the no-show limit', 0, 10),
    memberDaysAhead: null,
    minPlayersWeekday: int(input.minPlayersWeekday ?? 1, 'the fewest players on weekdays', 1, 5),
    minPlayersWeekend: int(input.minPlayersWeekend ?? 1, 'the fewest players on weekends', 1, 5),
    shareTeeTimes: input.shareTeeTimes !== false,
    playerNames: input.playerNames === 'required' ? 'required' : 'optional',
    payBeforeMinutes: input.payBeforeMinutes === null || input.payBeforeMinutes === undefined || input.payBeforeMinutes === '' ? null : int(input.payBeforeMinutes, 'how long before the tee time to pay (minutes)', 0, 7 * 24 * 60),
    payWithinDays: input.payWithinDays === null || input.payWithinDays === undefined || input.payWithinDays === '' ? null : int(input.payWithinDays, 'the days to pay after booking', 1, 60),
    waitlistClaimMinutes: int(input.waitlistClaimMinutes ?? 15, 'the time to claim a waitlist offer (minutes)', 3, 60),
  };
  await db.tx(async (q) => {
    await q.query('update courses set rules = $2 where business_id = $1', [id, JSON.stringify(r)]);
    await audit(q, id, c.email, 'setup.rules', 'Booking rules', '', r, now);
  });
  return r;
}

/**
 * Fees on top of the green fee (golf cart, caddie, gallery, insurance, development fee…). The list is
 * saved whole; bookings keep the price they were made at, so changing a fee never changes them.
 */
export async function saveFees(db: Db, c: Caller, id: string, input: { fees?: unknown }, now = Date.now()): Promise<CourseSetup> {
  await roleAt(db, c, id, CAN.setup);
  if (!Array.isArray(input.fees)) throw new UserError('Send the list of fees.');
  if (input.fees.length > 30) throw new UserError('A course can have up to 30 fees.');
  const typeIds = new Set((await db.query<{ id: string }>('select id from player_types where business_id = $1', [id])).map((r) => r.id));
  const fees: Fee[] = input.fees.map((f: Record<string, unknown>) => {
    const name = text(f.name, 'the fee name', { required: true, max: 40 });
    const kind = oneOf(f.kind, 'cart, caddie, gallery or other', ['cart', 'caddie', 'gallery', 'other'] as const);
    const per = kind === 'cart' ? 'cart' : kind === 'caddie' ? 'player' : kind === 'gallery' ? 'guest' : oneOf(f.per, 'per player or per booking', ['player', 'booking'] as const);
    const amounts = (Array.isArray(f.amounts) ? f.amounts : []).map((a: Record<string, unknown>) => {
      const t = a.playerTypeId === null || a.playerTypeId === undefined || a.playerTypeId === '' ? null : text(a.playerTypeId, 'the player type', { max: 40 });
      if (t !== null && !typeIds.has(t)) throw new UserError('Save the player type before giving it its own fee.');
      return { holes: a.holes === 9 ? 9 as const : 18 as const, dayType: oneOf(a.dayType, 'weekday or weekend', ['weekday', 'weekend'] as const), playerTypeId: t, amount: int(a.amount, `the amount of ${name} (in centavos)`, 0, 10_000_000) };
    });
    const keys = amounts.map((a) => `${a.holes}${a.dayType}${a.playerTypeId}`);
    if (new Set(keys).size !== keys.length) throw new UserError(`${name} has the same amount entered twice.`);
    const paidTo = oneOf(f.paidTo ?? 'booking', 'how it is paid', ['booking', 'counter', 'direct'] as const);
    if (paidTo === 'direct' && kind !== 'caddie') throw new UserError('Only the caddie fee can be paid straight to the caddie.');
    return { id: text(f.id, 'the fee', { max: 40 }) || newId(), name, kind, per, required: kind === 'caddie' ? f.active !== false : f.required === true, paidTo, active: f.active !== false, amounts };
  });
  for (const k of ['cart', 'caddie', 'gallery'] as const) {
    if (fees.filter((f) => f.kind === k && f.active).length > 1) throw new UserError(`Keep one ${k} fee. Use different amounts for 9 and 18 holes or weekends instead.`);
  }
  await db.tx(async (q) => {
    await q.query('delete from fees where business_id = $1', [id]);
    for (const [i, f] of fees.entries()) {
      await q.query('insert into fees (business_id, id, name, kind, per, required, paid_to, active, amounts, sort) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [id, f.id, f.name, f.kind, f.per, f.required, f.paidTo, f.active, JSON.stringify(f.amounts), i]);
    }
    await touch(q, id);
    await audit(q, id, c.email, 'setup.fees', 'Fees', fees.filter((f) => f.active).map((f) => f.name).join(', ') || 'No fees', fees, now);
  });
  return loadSetup(db, id);
}

/** Course options: players per cart, 9-hole rounds, gallery. */
export async function saveOptions(db: Db, c: Caller, id: string, input: Record<string, unknown>, now = Date.now()): Promise<CourseOptions> {
  await roleAt(db, c, id, CAN.setup);
  const o: CourseOptions = {
    cartSeats: int(input.cartSeats, 'players per cart', 1, 4),
    nineHoles: input.nineHoles === true,
    galleryMax: int(input.galleryMax, 'gallery guests per booking', 0, 8),
  };
  await db.tx(async (q) => {
    await q.query('update courses set options = $2 where business_id = $1', [id, JSON.stringify(o)]);
    await audit(q, id, c.email, 'setup.options', 'Course options', '', o, now);
  });
  return o;
}

// ---------------------------------------------------------------- going live

/** What still needs doing before the course can be sent to Maison for review. */
export async function readiness(db: Db, id: string): Promise<{ step: string; done: boolean }[]> {
  const c = await getCourse(db, id);
  const s = await loadSetup(db, id);
  const pub = s.playerTypes.filter((p) => p.public && p.active);
  const has = (dt: string) => s.rates.some((r) => pub.some((p) => p.id === r.playerTypeId) && r.dayType === dt);
  return [
    { step: 'Course details: address, phone and a short description', done: Boolean(c.address && c.phone && c.description) },
    { step: 'Tee time set for at least one course', done: s.layouts.some((l) => l.active && s.settings.some((x) => x.layoutId === l.id)) },
    { step: 'Weekday and weekend green fees for golfers booking in the app', done: has('weekday') && has('weekend') },
  ];
}

/** The owner sends the course to Maison for verification (PTR-1). */
export async function submitCourse(db: Db, c: Caller, id: string, now = Date.now()): Promise<CourseRow> {
  await roleAt(db, c, id, ['owner']);
  const course = await getCourse(db, id);
  if (course.status === 'review') throw new UserError('Your course is already with Maison for review.');
  if (course.status === 'live') throw new UserError('Your course is already live.');
  const missing = (await readiness(db, id)).filter((r) => !r.done);
  if (missing.length) throw new UserError(`Before sending it for review: ${missing.map((m) => m.step.toLowerCase()).join('; ')}.`);
  await db.tx(async (q) => {
    await q.query("update courses set status = 'review', submitted_at = $2, review_note = '' where business_id = $1", [id, now]);
    await audit(q, id, c.email, 'course.submitted', course.name, 'Sent to Maison for review', null, now);
    await platformLog(q, c.email, 'course.submitted', id, course.name, now);
  });
  return getCourse(db, id);
}

/** Maison admin: the partner applications and every course. */
export async function adminCourses(db: Db, c: Caller) {
  if (!(await isPlatformAdmin(db, c))) throw new NotFound();
  const rows = await db.query(`${COURSE_SELECT} order by case c.status when 'review' then 0 when 'draft' then 1 else 2 end, c.submitted_at desc nulls last, b.name`);
  return rows.map(courseOf);
}

/** Maison admin: approve (the course goes live), decline, or send back with a note. */
export async function reviewCourse(db: Db, c: Caller, id: string, input: { decision?: unknown; note?: unknown }, now = Date.now()): Promise<CourseRow> {
  if (!(await isPlatformAdmin(db, c))) throw new NotFound();
  const decision = oneOf(input.decision, 'approve, send back or decline', ['approve', 'send_back', 'decline', 'pause'] as const);
  const note = text(input.note, 'the note', { max: 1000 });
  if ((decision === 'send_back' || decision === 'decline') && !note) throw new UserError('Add a note telling the course what to fix or why.');
  const status: CourseStatus = decision === 'approve' ? 'live' : decision === 'send_back' ? 'draft' : decision === 'pause' ? 'paused' : 'declined';
  const course = await getCourse(db, id);
  await db.tx(async (q) => {
    await q.query('update courses set status = $2, reviewed_at = $3, reviewed_by = $4, review_note = $5 where business_id = $1', [id, status, now, c.email, note]);
    await audit(q, id, `Maison (${c.email})`, `course.${decision}`, course.name, note, null, now);
    await platformLog(q, c.email, `course.${decision}`, id, `${course.name}${note ? `: ${note}` : ''}`, now);
  });
  return getCourse(db, id);
}

export async function activity(db: Db, c: Caller, id: string, before?: number) {
  await roleAt(db, c, id, CAN.records);
  return db.query<{ id: string; at: number; by_name: string; action: string; subject: string; detail: string }>(
    'select id, at, by_name, action, subject, detail from audit where business_id = $1 and at < $2 order by at desc limit 200', [id, before ?? Number.MAX_SAFE_INTEGER]);
}

export function assertValidSlug(s: string) {
  const p = validSlug(s, RESERVED, 'MaisonFore');
  if (p) throw new UserError(p);
}

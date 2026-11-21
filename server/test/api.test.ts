import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { at, PARTNER, testServer } from './helpers';

const OWNER = 'owner@valley.ph', STARTER = 'starter@valley.ph', ADMIN = 'admin@maison.ph', OTHER = 'someone@else.ph';
let t: Awaited<ReturnType<typeof testServer>>;
let id = '', layoutId = '', publicType = '';
const MON = '2026-11-23';

beforeAll(async () => {
  t = await testServer();
});
afterAll(async () => t.close());

describe('becoming a partner', () => {
  it('refuses requests without a sign-in', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(r.statusCode).toBe(401);
  });
  it('creates the course as a draft, with its own address and a starter tee sheet', async () => {
    const r = await t.call(OWNER, 'POST', '/partners', PARTNER);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Valley Golf Club', slug: 'valleygolfclub', status: 'draft' });
    id = r.body.id;
    const me = await t.call(OWNER, 'GET', '/me');
    expect(me.body.courses).toEqual([expect.objectContaining({ id, role: 'owner', status: 'draft' })]);
    const c = await t.call(OWNER, 'GET', `/courses/${id}`);
    expect(c.body.setup.layouts).toHaveLength(1);
    expect(c.body.setup.settings[0]).toMatchObject({ firstTee: 360, lastTee: 840, interval: 8, maxPlayers: 4 });
    expect(c.body.setup.memberFeatures).toBe(false);
    layoutId = c.body.setup.layouts[0].id;
    publicType = c.body.setup.playerTypes.find((p: { public: boolean }) => p.public).id;
    const addr = await t.app.inject({ method: 'GET', url: '/api/v1/addresses/valleygolfclub' });
    expect(addr.json()).toMatchObject({ id, name: 'Valley Golf Club' });
  });
  it('gives a second course with the same name its own address', async () => {
    const r = await t.call(OTHER, 'POST', '/partners', PARTNER);
    expect(r.body.slug).toBe('valleygolfclub2');
  });
  it('asks for missing details in plain words', async () => {
    const r = await t.call(OWNER, 'POST', '/partners', { ...PARTNER, phone: '' });
    expect(r).toEqual({ status: 400, body: { error: 'Enter the phone number.' } });
  });
  it('hides a course from people who are not its staff', async () => {
    expect((await t.call(OTHER, 'GET', `/courses/${id}`)).status).toBe(404);
  });
});

describe('setting up and going live', () => {
  it('refuses to send an incomplete course for review, and says what is missing', async () => {
    const r = await t.call(OWNER, 'POST', `/courses/${id}/submit`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/description/);
    expect(r.body.error).toMatch(/green fees/);
  });
  it('saves tee times, rates and rules, refusing settings that make no sense', async () => {
    const bad = await t.call(OWNER, 'PUT', `/courses/${id}/teetimes`, { layouts: [{ id: layoutId, name: '18 holes', holes: 18, startTees: ['1'] }], settings: [{ layoutId, effectiveFrom: '2026-11-20', firstTee: 360, lastTee: 300, interval: 8, maxPlayers: 4 }] });
    expect(bad.body.error).toBe('The last tee time must be after the first.');
    const two = await t.call(OWNER, 'PUT', `/courses/${id}/teetimes`, {
      layouts: [{ id: layoutId, name: '18 holes', holes: 18, startTees: ['1', '10'] }],
      settings: [{ layoutId, effectiveFrom: '2026-11-20', firstTee: 360, lastTee: 480, interval: 10, maxPlayers: 4 }],
    });
    expect(two.status).toBe(200);
    const rates = await t.call(OWNER, 'PUT', `/courses/${id}/rates`, {
      rates: [
        { playerTypeId: publicType, dayType: 'weekday', holes: 18, band: 'regular', effectiveFrom: '2026-11-01', amount: 250000 },
        { playerTypeId: publicType, dayType: 'weekend', holes: 18, band: 'regular', effectiveFrom: '2026-11-01', amount: 350000 },
      ],
      holidays: [{ day: '2026-12-25', name: 'Christmas Day' }],
    });
    expect(rates.status).toBe(200);
    expect(rates.body.holidays).toEqual(['2026-12-25']);
    const rules = await t.call(OWNER, 'PUT', `/courses/${id}/rules`, { publicDaysAhead: 7, releaseTime: 420, cancelCutoffHours: 24, maxPlayersPerBooking: 4, maxOpenBookingsPerGolfer: 2, holdMinutes: 10, twilightFrom: null, noShowLimit: 2 });
    expect(rules.status).toBe(200);
    const page = await t.call(OWNER, 'PUT', `/courses/${id}`, { ...PARTNER, description: 'Hilly 18-hole course with views of Manila.', facilities: ['Driving range', 'Restaurant'] });
    expect(page.body.facilities).toEqual(['Driving range', 'Restaurant']);
  });
  it('sends the course to Maison, and only a Maison admin can approve it', async () => {
    expect((await t.call(OWNER, 'POST', `/courses/${id}/submit`)).body.status).toBe('review');
    expect((await t.call(OWNER, 'GET', '/admin/courses')).status).toBe(404);
    const list = await t.call(ADMIN, 'GET', '/admin/courses');
    expect(list.body[0]).toMatchObject({ id, status: 'review' });
    const noNote = await t.call(ADMIN, 'POST', `/admin/courses/${id}/review`, { decision: 'send_back' });
    expect(noNote.status).toBe(400);
    expect((await t.call(ADMIN, 'POST', `/admin/courses/${id}/review`, { decision: 'approve' })).body.status).toBe('live');
  });
});

describe('the tee sheet and bookings', () => {
  let a = '', b = '';
  it('shows the day with every slot on both starting tees', async () => {
    const r = await t.call(OWNER, 'GET', `/courses/${id}/sheet?day=${MON}`);
    expect(r.body.layouts[0].slots).toHaveLength(13 * 2);
    expect(r.body.layouts[0].slots[0]).toMatchObject({ time: 360, startTee: '1', state: 'open', free: 4 });
  });
  it('takes a phone booking, priced at the public rate', async () => {
    const r = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: MON, time: 360, players: 3, contactName: 'Juan dela Cruz', mobile: '0917 123 4567', channel: 'phone' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'confirmed', players: 3, amount: 750000, mobile: '+639171234567', channel: 'phone' });
    expect(r.body.ref).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    a = r.body.id;
  });
  it('refuses more players than the slot has room for', async () => {
    const r = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: MON, time: 360, players: 2, contactName: 'Pedro', channel: 'walkin' });
    expect(r.body.error).toBe('Only 1 spot is left at 6:00 AM (tee 1).');
  });
  it('lets a hold keep the slot until it runs out', async () => {
    const h = await t.call(OWNER, 'POST', `/courses/${id}/holds`, { layoutId, startTee: '1', day: MON, time: 370, players: 4, contactName: 'Ana', channel: 'viber' });
    expect(h.body).toMatchObject({ status: 'held' });
    const full = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: MON, time: 370, players: 1, contactName: 'Ben' });
    expect(full.body.error).toBe('6:10 AM (tee 1) is full.');
    t.clock.now += 11 * 60_000;
    const late = await t.call(OWNER, 'POST', `/courses/${id}/bookings/${h.body.id}/confirm`);
    expect(late.body.error).toMatch(/hold ran out/);
    expect((await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: MON, time: 370, players: 1, contactName: 'Ben' })).status).toBe(200);
  });
  it('holds slots for walk-ins and closes times, and reports bookings caught by a closure', async () => {
    const hold = await t.call(OWNER, 'POST', `/courses/${id}/blocks`, { kind: 'walkin', day: MON, from: 400, to: 430 });
    expect(hold.status).toBe(200);
    const close = await t.call(OWNER, 'POST', `/courses/${id}/blocks`, { kind: 'weather', day: MON, from: 360, to: 370, reason: 'Lightning' });
    expect(close.body.affected.map((x: { id: string }) => x.id)).toEqual([a]);
    const sheet = await t.call(OWNER, 'GET', `/courses/${id}/sheet?day=${MON}`);
    const slots = sheet.body.layouts[0].slots;
    expect(slots.find((s: { time: number; startTee: string }) => s.time === 400 && s.startTee === '1').state).toBe('held');
    expect(slots.find((s: { time: number; startTee: string }) => s.time === 360 && s.startTee === '1').state).toBe('closed');
    // Staff can still book a held slot for a walk-in.
    expect((await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: MON, time: 400, players: 2, contactName: 'Walk-in', channel: 'walkin' })).status).toBe(200);
    expect((await t.call(OWNER, 'DELETE', `/courses/${id}/blocks/${close.body.block.id}`)).status).toBe(200);
  });
  it('moves a booking, keeping its own spots', async () => {
    const r = await t.call(OWNER, 'POST', `/courses/${id}/bookings/${a}/move`, { layoutId, startTee: '10', day: MON, time: 380 });
    expect(r.body).toMatchObject({ startTee: '10', time: 380, players: 3 });
    const bigger = await t.call(OWNER, 'POST', `/courses/${id}/bookings/${a}/move`, { layoutId, startTee: '10', day: MON, time: 380, players: 4 });
    expect(bigger.body.players).toBe(4);
    b = (await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: MON, time: 450, players: 2, contactName: 'Carlo' })).body.id;
  });
  it('checks golfers in and out, and refuses changes that make no sense', async () => {
    expect((await t.call(OWNER, 'POST', `/courses/${id}/bookings/${a}/no-show`)).body.error).toBe('You can mark a no-show once the tee time has passed.');
    expect((await t.call(OWNER, 'POST', `/courses/${id}/bookings/${a}/played`)).body.error).toMatch(/can’t be changed to played/);
    t.clock.now = at(MON, '06:25');
    expect((await t.call(OWNER, 'POST', `/courses/${id}/bookings/${a}/check-in`)).body.status).toBe('checked_in');
    expect((await t.call(OWNER, 'POST', `/courses/${id}/bookings/${a}/played`)).body.status).toBe('played');
    expect((await t.call(OWNER, 'POST', `/courses/${id}/bookings/${b}/cancel`)).body.error).toBe('Add a reason for cancelling.');
    expect((await t.call(OWNER, 'POST', `/courses/${id}/bookings/${b}/cancel`, { reason: 'Called to cancel' })).body.status).toBe('cancelled');
  });
  it('records payment taken at the counter', async () => {
    const r = await t.call(OWNER, 'POST', `/courses/${id}/bookings/${a}/payment`, { amount: 1000000, method: 'gcash' });
    expect(r.body.error).toMatch(/reference number/);
    const ok = await t.call(OWNER, 'POST', `/courses/${id}/bookings/${a}/payment`, { amount: 1000000, method: 'gcash', ref: '1234567890' });
    expect(ok.body).toMatchObject({ payStatus: 'paid_course', paidAmount: 1000000, paidMethod: 'gcash' });
  });
  it('answers "unchanged" when nothing changed since the screen last asked', async () => {
    const first = await t.call(OWNER, 'GET', `/courses/${id}/sheet?day=${MON}`);
    const again = await t.call(OWNER, 'GET', `/courses/${id}/sheet?day=${MON}&since=${first.body.seq}`);
    expect(again.body).toEqual({ unchanged: true, seq: first.body.seq });
    await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: MON, time: 470, players: 1, contactName: 'Dina' });
    expect((await t.call(OWNER, 'GET', `/courses/${id}/sheet?day=${MON}&since=${first.body.seq}`)).body.unchanged).toBe(false);
  });
  it('logs every change with who made it', async () => {
    const log = await t.call(OWNER, 'GET', `/courses/${id}/activity`);
    const actions = log.body.map((x: { action: string }) => x.action);
    for (const a of ['course.created', 'setup.rates', 'course.approve', 'booking.created', 'booking.held', 'booking.moved', 'booking.checked_in', 'booking.cancelled', 'booking.paid', 'block.weather', 'block.removed']) {
      expect(actions).toContain(a);
    }
    expect(log.body.find((x: { action: string }) => x.action === 'booking.cancelled').by_name).toBe(OWNER);
  });
});

describe('roles', () => {
  it('lets a starter run the sheet but not change the setup', async () => {
    const [acc] = await t.db.query<{ id: string }>("insert into accounts (id, email, created_at) values ('00000000-0000-5000-8000-000000000001', $1, 0) returning id", [STARTER]);
    await t.db.query("insert into members (business_id, account_id, email, role, added_at) values ($1, $2, $3, 'starter', 0)", [id, acc.id, STARTER]);
    expect((await t.call(STARTER, 'GET', `/courses/${id}/sheet?day=${MON}`)).status).toBe(200);
    const r = await t.call(STARTER, 'PUT', `/courses/${id}/rules`, { publicDaysAhead: 30 });
    expect(r.status).toBe(403);
    expect((await t.call(STARTER, 'GET', `/courses/${id}/activity`)).status).toBe(403);
  });
});

describe('Philippine pricing: player types, 9 holes, carts, caddies, gallery and fees', () => {
  const TUE = '2026-11-24';
  let local = '', foreign = '', senior = '';
  it('saves player types with their days, hours and proof, and refuses a course nobody can book in the app', async () => {
    const c = await t.call(OWNER, 'GET', `/courses/${id}`);
    const types = c.body.setup.playerTypes as { id: string; name: string }[];
    local = types.find((x) => x.name === 'Local')!.id;
    foreign = types.find((x) => x.name === 'Foreign')!.id;
    const none = await t.call(OWNER, 'PUT', `/courses/${id}/rates`, { playerTypes: types.map((x) => ({ ...x, public: false })) });
    expect(none.body.error).toMatch(/at least one player type/);
    const r = await t.call(OWNER, 'PUT', `/courses/${id}/rates`, {
      playerTypes: [...types, { name: 'Senior', public: true, proof: 'Senior citizen ID', days: [3], earliest: null }],
      rates: [
        { playerTypeId: foreign, dayType: 'weekday', holes: 18, band: 'regular', effectiveFrom: '2026-11-01', amount: 360000 },
        { playerTypeId: local, dayType: 'weekday', holes: 9, band: 'regular', effectiveFrom: '2026-11-01', amount: 155000 },
      ],
    });
    expect(r.status).toBe(200);
    const s = r.body.playerTypes.find((x: { name: string }) => x.name === 'Senior');
    expect(s).toMatchObject({ proof: 'Senior citizen ID', days: [3], public: true, active: true });
    senior = s.id;
  });
  it('saves fees and options, keeping one cart, caddie and gallery fee', async () => {
    const two = await t.call(OWNER, 'PUT', `/courses/${id}/fees`, { fees: [
      { name: 'Cart', kind: 'cart', amounts: [] }, { name: 'Cart 2', kind: 'cart', amounts: [] }] });
    expect(two.body.error).toMatch(/Keep one cart fee/);
    const direct = await t.call(OWNER, 'PUT', `/courses/${id}/fees`, { fees: [{ name: 'Locker', kind: 'other', per: 'player', paidTo: 'direct', amounts: [] }] });
    expect(direct.body.error).toMatch(/Only the caddie fee/);
    const r = await t.call(OWNER, 'PUT', `/courses/${id}/fees`, { fees: [
      { name: 'Golf cart', kind: 'cart', required: false, paidTo: 'booking', amounts: [{ holes: 18, dayType: 'weekday', playerTypeId: null, amount: 120000 }] },
      { name: 'Caddie', kind: 'caddie', required: true, paidTo: 'direct', amounts: [{ holes: 18, dayType: 'weekday', playerTypeId: null, amount: 75000 }] },
      { name: 'Gallery', kind: 'gallery', paidTo: 'booking', amounts: [{ holes: 18, dayType: 'weekday', playerTypeId: null, amount: 200000 }] },
      { name: 'Development fee', kind: 'other', per: 'player', required: true, amounts: [
        { holes: 18, dayType: 'weekday', playerTypeId: local, amount: 4000 }, { holes: 18, dayType: 'weekday', playerTypeId: foreign, amount: 6000 }] },
    ] });
    expect(r.status).toBe(200);
    expect(r.body.fees).toHaveLength(4);
    const o = await t.call(OWNER, 'PUT', `/courses/${id}/options`, { cartSeats: 2, nineHoles: true, galleryMax: 2 });
    expect(o.body).toEqual({ cartSeats: 2, nineHoles: true, galleryMax: 2 });
  });
  it('prices a mixed flight line by line and keeps the price on the booking', async () => {
    const r = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, {
      layoutId, startTee: '1', day: TUE, time: 380, players: 3, playerTypes: [local, local, foreign], carts: 2, gallery: 1, contactName: 'Mr. Tanaka', channel: 'phone' });
    expect(r.status).toBe(200);
    expect(r.body.quote.map((l: { label: string; amount: number }) => [l.label, l.amount])).toEqual([
      ['Green fee, Local', 500000], ['Green fee, Foreign', 360000], ['Golf cart (2 carts)', 240000], ['Caddie (3 caddies)', 225000], ['Gallery', 200000], ['Development fee', 14000]]);
    expect(r.body).toMatchObject({ amount: 1539000, payInApp: 1314000, carts: 2, caddies: 3, gallery: 1, holes: 18 });
    const d = await t.call(OWNER, 'GET', `/courses/${id}/bookings/${r.body.id}`);
    expect(d.body.players.map((p: { player_type_id: string; rate: number }) => [p.player_type_id, Number(p.rate)])).toEqual([[local, 250000], [local, 250000], [foreign, 360000]]);
  });
  it('books 9 holes at the 9-hole rate, and reprices when moved', async () => {
    const r = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: TUE, time: 400, players: 1, playerTypes: [local], holes: 9, contactName: 'Ana', channel: 'walkin' });
    expect(r.body).toMatchObject({ holes: 9, caddies: 1 });
    expect(r.body.quote[0]).toMatchObject({ label: 'Green fee, Local', amount: 155000 });
    const m = await t.call(OWNER, 'POST', `/courses/${id}/bookings/${r.body.id}/move`, { layoutId, startTee: '1', day: '2026-11-28', time: 400 });
    expect(m.status).toBe(200);
    expect(m.body.holes).toBe(9);
    expect(m.body.quote[0].amount).toBe(0); // no weekend 9-hole rate set: staff see ₱0 and can fix the rate
  });
  it('refuses a player type the course does not offer', async () => {
    const r = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: TUE, time: 420, players: 1, playerTypes: ['nope'], contactName: 'X' });
    expect(r.body.error).toMatch(/player type/);
    expect(senior).not.toBe('');
  });
  it('takes a club with more than one course, each with its own holes and tee times', async () => {
    const c = await t.call(OWNER, 'GET', `/courses/${id}`);
    const r = await t.call(OWNER, 'PUT', `/courses/${id}/teetimes`, { layouts: [...c.body.setup.layouts, { id: 'east', name: 'East course', holes: 9, startTees: ['1'] }],
      settings: [{ layoutId: 'east', effectiveFrom: '2026-11-01', firstTee: 360, lastTee: 600, interval: 9, maxPlayers: 4 }] });
    expect(r.status).toBe(200);
    expect(r.body.layouts.find((l: { id: string }) => l.id === 'east')).toMatchObject({ name: 'East course', holes: 9 });
    const s = await t.call(OWNER, 'GET', `/courses/${id}/sheet?day=2026-11-24`);
    expect(s.body.layouts.map((l: { layout: { name: string } }) => l.layout.name)).toContain('East course');
  });
  it('sums each day for the date slider', async () => {
    const r = await t.call(OWNER, 'GET', `/courses/${id}/days?from=${TUE}&to=2026-11-25`);
    expect(r.body).toHaveLength(2);
    expect(r.body[0]).toMatchObject({ day: TUE, used: 3, bookings: 1, closed: false });
    expect(r.body[0].capacity).toBeGreaterThan(0);
    expect((await t.call(OWNER, 'GET', `/courses/${id}/days?from=2026-01-01&to=2026-12-31`)).body.error).toMatch(/120 days/);
  });
});

describe('staff', () => {
  const MANAGER = 'manager@valley.ph', NEWBIE = 'newbie@valley.ph', VIEWER = 'viewer@valley.ph';
  it('lets the owner add someone who already has a Maison account, and invite someone who does not', async () => {
    await t.call(MANAGER, 'GET', '/me'); // has an account now
    const a = await t.call(OWNER, 'POST', `/courses/${id}/staff`, { email: 'Manager@Valley.ph', role: 'manager' });
    expect(a.status).toBe(200);
    expect(a.body.staff).toContainEqual(expect.objectContaining({ email: MANAGER, role: 'manager' }));
    const b = await t.call(OWNER, 'POST', `/courses/${id}/staff`, { email: NEWBIE, role: 'starter' });
    expect(b.body.invites).toEqual([expect.objectContaining({ email: NEWBIE, role: 'starter', invitedBy: OWNER })]);
    expect((await t.call(OWNER, 'POST', `/courses/${id}/staff`, { email: MANAGER, role: 'starter' })).body.error).toMatch(/already on the staff/);
  });
  it('turns an invite into a membership the first time that person signs in', async () => {
    const me = await t.call(NEWBIE, 'GET', '/me');
    expect(me.body.courses).toEqual([expect.objectContaining({ id, role: 'starter' })]);
    const list = await t.call(OWNER, 'GET', `/courses/${id}/staff`);
    expect(list.body.invites).toEqual([]);
  });
  it('keeps staff management to owners', async () => {
    expect((await t.call(MANAGER, 'GET', `/courses/${id}/staff`)).status).toBe(403);
    expect((await t.call(MANAGER, 'POST', `/courses/${id}/staff`, { email: 'x@y.ph', role: 'owner' })).status).toBe(403);
  });
  it('lets a view-only member see the tee sheet but change nothing', async () => {
    await t.call(OWNER, 'POST', `/courses/${id}/staff`, { email: VIEWER, role: 'viewer' });
    expect((await t.call(VIEWER, 'GET', `/courses/${id}/sheet?day=${MON}`)).status).toBe(200);
    const r = await t.call(VIEWER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: MON, time: 480, players: 1, contactName: 'X' });
    expect(r.status).toBe(403);
  });
  it('changes roles and removes staff, but never the last owner', async () => {
    expect((await t.call(OWNER, 'PUT', `/courses/${id}/staff`, { email: OWNER, role: 'manager' })).body.error).toMatch(/at least one owner/);
    expect((await t.call(OWNER, 'DELETE', `/courses/${id}/staff/${encodeURIComponent(OWNER)}`)).status).toBe(403);
    const r = await t.call(OWNER, 'PUT', `/courses/${id}/staff`, { email: NEWBIE, role: 'manager' });
    expect(r.body.staff).toContainEqual(expect.objectContaining({ email: NEWBIE, role: 'manager' }));
    const d = await t.call(OWNER, 'DELETE', `/courses/${id}/staff/${encodeURIComponent(NEWBIE)}`);
    expect(d.body.staff.map((s: { email: string }) => s.email)).not.toContain(NEWBIE);
    expect((await t.call(NEWBIE, 'GET', `/courses/${id}`)).status).toBe(404);
  });
});

describe('overview', () => {
  it('gives owners and managers today, the week ahead, attention items and the last 30 days', async () => {
    const r = await t.call(OWNER, 'GET', `/courses/${id}/overview`);
    expect(r.status).toBe(200);
    expect(r.body.week).toHaveLength(7);
    expect(r.body.todayFigures).toEqual(expect.objectContaining({ players: expect.any(Number), capacity: expect.any(Number), booked: expect.any(Number), collected: expect.any(Number) }));
    expect(r.body.last30).toEqual(expect.objectContaining({ rounds: expect.any(Number), byChannel: expect.any(Array), byPlayerType: expect.any(Array) }));
    expect(Array.isArray(r.body.attention)).toBe(true);
  });
  it('is not for starters or view-only staff', async () => {
    expect((await t.call(STARTER, 'GET', `/courses/${id}/overview`)).status).toBe(403);
  });
});

describe('special bookings and player rules', () => {
  const SAT = '2026-11-28';
  it('lets the owner accept a VIP with no set time, outside the sheet, charged by player type', async () => {
    const c = await t.call(OWNER, 'GET', `/courses/${id}`);
    const foreign = c.body.setup.playerTypes.find((p: { name: string }) => p.name === 'Foreign').id;
    const r = await t.call(OWNER, 'POST', `/courses/${id}/specials`, { day: SAT, players: 2, playerTypes: [publicType, foreign], contactName: 'Gov. Santos', notes: 'Guest of the board' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ special: true, time: -1, status: 'confirmed', players: 2 });
    expect(r.body.quote.map((l: { label: string }) => l.label)).toEqual(expect.arrayContaining(['Green fee, Local', 'Green fee, Foreign']));
    expect(r.body.amount).toBeGreaterThan(0);
    const s = await t.call(OWNER, 'GET', `/courses/${id}/sheet?day=${SAT}`);
    expect(s.body.specials.map((b: { contactName: string }) => b.contactName)).toContain('Gov. Santos');
    expect(s.body.layouts[0].slots.every((x: { bookings: { special?: boolean }[] }) => x.bookings.every((b) => !b.special))).toBe(true);
  });
  it('accepts a special booking at a full time or between flights', async () => {
    const full = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: SAT, time: 410, players: 4, contactName: 'Full flight' });
    expect(full.body.error ?? 'ok').toBe('ok');
    const r = await t.call(OWNER, 'POST', `/courses/${id}/specials`, { day: SAT, time: 415, players: 2, contactName: 'Member squeeze' });
    expect(r.body).toMatchObject({ special: true, time: 415 });
    const again = await t.call(OWNER, 'POST', `/courses/${id}/specials`, { day: SAT, time: 410, players: 2, contactName: 'Over the top' });
    expect(again.status).toBe(200);
  });
  it('keeps special bookings to owners and managers', async () => {
    const [acc] = await t.db.query<{ id: string }>('select id from accounts where lower(email) = $1', ['starter@valley.ph']);
    if (acc) await t.db.query("insert into members (business_id, account_id, email, role, added_at) values ($1, $2, 'starter@valley.ph', 'starter', 0) on conflict (business_id, account_id) do update set role = 'starter'", [id, acc.id]);
    expect((await t.call('starter@valley.ph', 'POST', `/courses/${id}/specials`, { day: SAT, players: 1, contactName: 'X' })).status).toBe(403);
  });
  it('saves the minimum players and the one-group-per-tee-time rule', async () => {
    const c = await t.call(OWNER, 'GET', `/courses/${id}`);
    const r = await t.call(OWNER, 'PUT', `/courses/${id}/rules`, { ...c.body.setup.rules, minPlayersWeekday: 1, minPlayersWeekend: 2, shareTeeTimes: false });
    expect(r.body).toMatchObject({ minPlayersWeekday: 1, minPlayersWeekend: 2, shareTeeTimes: false });
    await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: SAT, time: 420, players: 2, contactName: 'Pair' });
    const second = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: SAT, time: 420, players: 1, contactName: 'Single' });
    expect(second.body.error).toMatch(/full/);
    await t.call(OWNER, 'PUT', `/courses/${id}/rules`, { ...c.body.setup.rules, shareTeeTimes: true });
  });
});

describe('player names', () => {
  const SUN = '2026-11-29';
  it('keeps every player’s name, the first defaulting to the name for the booking', async () => {
    const r = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: SUN, time: 360, players: 3, contactName: 'Ana Cruz', playerNames: ['', 'Ben Cruz', ''] });
    expect(r.status).toBe(200);
    const d = await t.call(OWNER, 'GET', `/courses/${id}/bookings/${r.body.id}`);
    expect(d.body.players.map((p: { name: string }) => p.name)).toEqual(['Ana Cruz', 'Ben Cruz', '']);
    const e = await t.call(OWNER, 'PATCH', `/courses/${id}/bookings/${r.body.id}`, { contactName: 'Ana Cruz', playerNames: ['Ana Cruz', 'Ben Cruz', 'Carlo Cruz'] });
    expect(e.status).toBe(200);
    const d2 = await t.call(OWNER, 'GET', `/courses/${id}/bookings/${r.body.id}`);
    expect(d2.body.players.map((p: { name: string }) => p.name)).toEqual(['Ana Cruz', 'Ben Cruz', 'Carlo Cruz']);
  });
  it('requires every name where the club says so', async () => {
    const c = await t.call(OWNER, 'GET', `/courses/${id}`);
    await t.call(OWNER, 'PUT', `/courses/${id}/rules`, { ...c.body.setup.rules, playerNames: 'required' });
    const r = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: SUN, time: 370, players: 2, contactName: 'Dan' });
    expect(r.body.error).toMatch(/name of every player/);
    const ok = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: SUN, time: 370, players: 2, contactName: 'Dan', playerNames: ['Dan', 'Eve'] });
    expect(ok.status).toBe(200);
    const sp = await t.call(OWNER, 'POST', `/courses/${id}/specials`, { day: SUN, players: 2, contactName: 'VIP' });
    expect(sp.body.error).toMatch(/name of every player/);
    await t.call(OWNER, 'PUT', `/courses/${id}/rules`, { ...c.body.setup.rules, playerNames: 'optional' });
  });
});

describe('time to pay and pencil bookings', () => {
  const DAY = '2026-12-01';
  it('turns an unpaid phone booking into a pencil booking when the time to pay runs out', async () => {
    const c = await t.call(OWNER, 'GET', `/courses/${id}`);
    await t.call(OWNER, 'PUT', `/courses/${id}/rules`, { ...c.body.setup.rules, paymentGraceHours: 2 });
    const start = t.clock.now;
    const b = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: DAY, time: 360, players: 4, contactName: 'Late payer', channel: 'phone' });
    expect(b.body.payDueBy).toBe(start + 2 * 3_600_000);
    const before = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: DAY, time: 360, players: 1, contactName: 'Hopeful' });
    expect(before.body.error).toMatch(/full/);
    t.clock.now = start + 2 * 3_600_000 + 1;
    const sheet = await t.call(OWNER, 'GET', `/courses/${id}/sheet?day=${DAY}`);
    const slot = sheet.body.layouts[0].slots.find((s: { time: number; startTee: string }) => s.time === 360 && s.startTee === '1');
    expect(slot).toMatchObject({ state: 'open', free: 4 });
    expect(slot.bookings.map((x: { contactName: string }) => x.contactName)).toEqual(['Late payer']);
    expect((await t.call(OWNER, 'POST', `/courses/${id}/bookings/${b.body.id}/check-in`)).body.error).toMatch(/pencil booking/);
    const other = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: DAY, time: 360, players: 2, contactName: 'Took the time' });
    expect(other.status).toBe(200);
    const pay = await t.call(OWNER, 'POST', `/courses/${id}/bookings/${b.body.id}/payment`, { amount: 100000, method: 'cash' });
    expect(pay.body.error).toMatch(/Someone else has booked/);
    t.clock.now = start;
    await t.call(OWNER, 'PUT', `/courses/${id}/rules`, { ...c.body.setup.rules, paymentGraceHours: null });
  });
  it('puts a pencil booking back on its time when it is paid and the time still has room', async () => {
    const c = await t.call(OWNER, 'GET', `/courses/${id}`);
    await t.call(OWNER, 'PUT', `/courses/${id}/rules`, { ...c.body.setup.rules, paymentGraceHours: 1 });
    const start = t.clock.now;
    const b = await t.call(OWNER, 'POST', `/courses/${id}/bookings`, { layoutId, startTee: '1', day: DAY, time: 380, players: 2, contactName: 'Pays late', channel: 'viber' });
    t.clock.now = start + 3_600_001;
    const pay = await t.call(OWNER, 'POST', `/courses/${id}/bookings/${b.body.id}/payment`, { amount: 100000, method: 'cash' });
    expect(pay.body).toMatchObject({ payStatus: 'paid_course', payDueBy: null });
    const sheet = await t.call(OWNER, 'GET', `/courses/${id}/sheet?day=${DAY}`);
    expect(sheet.body.layouts[0].slots.find((s: { time: number; startTee: string }) => s.time === 380 && s.startTee === '1')).toMatchObject({ used: 2 });
    t.clock.now = start;
    await t.call(OWNER, 'PUT', `/courses/${id}/rules`, { ...c.body.setup.rules, paymentGraceHours: null });
  });
});

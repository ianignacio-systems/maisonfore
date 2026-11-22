import { describe, expect, it } from 'vitest';
import { counterSplit, dueWithBooking, feeAmount, holesOffered, quote, type Fee } from '../src';
import { course, pt } from './helpers';

// A Philippine-style rate card: locals and foreigners, seniors on Wednesdays, juniors from 11:00 AM,
// required caddies paid at the course, optional twin-sharing carts, a gallery fee and a development fee.
const fees: Fee[] = [
  { id: 'CART', name: 'Golf cart', kind: 'cart', per: 'cart', required: false, paidTo: 'booking', active: true, amounts: [
    { holes: 18, dayType: 'weekday', playerTypeId: null, amount: 120000 }, { holes: 9, dayType: 'weekday', playerTypeId: null, amount: 60000 }] },
  { id: 'CAD', name: 'Caddie', kind: 'caddie', per: 'player', required: true, paidTo: 'direct', active: true, amounts: [
    { holes: 18, dayType: 'weekday', playerTypeId: null, amount: 75000 }] },
  { id: 'GAL', name: 'Gallery', kind: 'gallery', per: 'guest', required: false, paidTo: 'booking', active: true, amounts: [
    { holes: 18, dayType: 'weekday', playerTypeId: null, amount: 200000 }, { holes: 18, dayType: 'weekend', playerTypeId: null, amount: 285000 }] },
  { id: 'DEV', name: 'Development fee', kind: 'other', per: 'player', required: true, paidTo: 'booking', active: true, amounts: [
    { holes: 18, dayType: 'weekday', playerTypeId: 'LOC', amount: 4000 }, { holes: 18, dayType: 'weekday', playerTypeId: 'FOR', amount: 6000 }] },
  { id: 'LOCK', name: 'Locker', kind: 'other', per: 'player', required: false, paidTo: 'counter', active: true, amounts: [
    { holes: 18, dayType: 'weekday', playerTypeId: null, amount: 5000 }] },
];
const ph = course({
  playerTypes: [
    pt('LOC', 'Local', true), pt('FOR', 'Foreign', true, { proof: 'Passport' }),
    pt('SEN', 'Senior', true, { days: [3], proof: 'Senior citizen ID' }), pt('JUN', 'Junior', false, { earliest: 660 }),
  ],
  rates: [
    { playerTypeId: 'LOC', dayType: 'weekday', holes: 18, band: 'regular', amount: 330000, effectiveFrom: '2026-01-01' },
    { playerTypeId: 'LOC', dayType: 'weekend', holes: 18, band: 'regular', amount: 480000, effectiveFrom: '2026-01-01' },
    { playerTypeId: 'LOC', dayType: 'weekday', holes: 9, band: 'regular', amount: 155000, effectiveFrom: '2026-01-01' },
    { playerTypeId: 'FOR', dayType: 'weekday', holes: 18, band: 'regular', amount: 360000, effectiveFrom: '2026-01-01' },
    { playerTypeId: 'FOR', dayType: 'weekend', holes: 18, band: 'regular', amount: 570000, effectiveFrom: '2026-01-01' },
    { playerTypeId: 'SEN', dayType: 'weekday', holes: 18, band: 'regular', amount: 200000, effectiveFrom: '2026-01-01' },
    { playerTypeId: 'JUN', dayType: 'weekday', holes: 18, band: 'regular', amount: 200000, effectiveFrom: '2026-01-01' },
  ],
  fees,
});
const MON = '2026-11-23', WED = '2026-11-25', SAT = '2026-11-28';

describe('quote', () => {
  it('prices a mixed flight line by line, with caddies paid at the course', () => {
    const q = quote(ph, { layoutId: 'L18', day: MON, time: 420, holes: 18, players: ['LOC', 'LOC', 'FOR', 'FOR'], carts: 2 });
    expect(q.problems).toEqual([]);
    expect(q.lines.map((l) => [l.label, l.amount, l.payAt])).toEqual([
      ['Green fee, Local', 660000, 'booking'],
      ['Green fee, Foreign', 720000, 'booking'],
      ['Golf cart (2 carts)', 240000, 'booking'],
      ['Caddie (4 caddies)', 300000, 'direct'],
      ['Development fee', 20000, 'booking'],
    ]);
    expect(q.total).toBe(1940000);
    expect(q.payInApp).toBe(1640000);
  });

  it('charges each player type its own amount of a per-player fee', () => {
    const q = quote(ph, { layoutId: 'L18', day: MON, time: 420, holes: 18, players: ['LOC', 'FOR', 'FOR'] });
    expect(q.lines.find((l) => l.feeId === 'DEV')).toMatchObject({ amount: 4000 + 12000, detail: '1 × ₱40.00 + 2 × ₱60.00' });
  });

  it('uses weekend amounts on weekends and the weekday amount where no weekend one is set', () => {
    const q = quote(ph, { layoutId: 'L18', day: SAT, time: 420, holes: 18, players: ['LOC', 'LOC'], gallery: 1, carts: 1 });
    expect(q.lines.find((l) => l.feeId === 'GAL')!.amount).toBe(285000);
    expect(q.lines.find((l) => l.feeId === 'CART')!.amount).toBe(120000);
    expect(q.lines[0].amount).toBe(960000);
  });

  it('prices 9 holes, falling back to the 18-hole fee amount when no 9-hole amount is set', () => {
    expect(holesOffered(ph, 'L18')).toEqual([18, 9]);
    const q = quote(ph, { layoutId: 'L18', day: MON, time: 420, holes: 9, players: ['LOC'], carts: 1 });
    expect(q.holes).toBe(9);
    expect(q.lines.map((l) => l.amount)).toEqual([155000, 60000, 75000, 4000]);
    expect(feeAmount(fees[1], 9, 'weekday', null)).toBe(75000);
  });

  it('keeps 18 holes when 9-hole rounds are switched off', () => {
    const no9 = { ...ph, options: { ...ph.options, nineHoles: false } };
    expect(quote(no9, { layoutId: 'L18', day: MON, time: 420, holes: 9, players: ['LOC'] }).holes).toBe(18);
  });

  it('charges enough carts for everyone when carts are required', () => {
    const req = { ...ph, fees: ph.fees.map((f) => (f.id === 'CART' ? { ...f, required: true } : f)) };
    expect(quote(req, { layoutId: 'L18', day: MON, time: 420, holes: 18, players: ['LOC', 'LOC', 'LOC'] }).carts).toBe(2);
    expect(quote({ ...req, options: { ...req.options, cartSeats: 1 } }, { layoutId: 'L18', day: MON, time: 420, holes: 18, players: ['LOC', 'LOC', 'LOC'] }).carts).toBe(3);
  });

  it('adds optional fees only when chosen, and caps the gallery', () => {
    const q = quote(ph, { layoutId: 'L18', day: MON, time: 420, holes: 18, players: ['LOC'], extras: ['LOCK'], gallery: 9 });
    expect(q.lines.some((l) => l.feeId === 'LOCK')).toBe(true);
    expect(q.gallery).toBe(2);
    expect(quote(ph, { layoutId: 'L18', day: MON, time: 420, holes: 18, players: ['LOC'] }).lines.some((l) => l.feeId === 'LOCK')).toBe(false);
  });

  it('charges gallery guests whenever gallery is allowed, even if the fee was saved switched off', () => {
    const off = { ...ph, fees: ph.fees.map((f) => (f.kind === 'gallery' ? { ...f, active: false } : f)) };
    const q = quote(off, { layoutId: 'L18', day: MON, time: 420, holes: 18, players: ['LOC'], gallery: 2 });
    expect(q.lines.find((l) => l.feeId === 'GAL')?.qty).toBe(2);
    const none = quote({ ...off, options: { ...off.options, galleryMax: 0 } }, { layoutId: 'L18', day: MON, time: 420, holes: 18, players: ['LOC'], gallery: 2 });
    expect(none.gallery).toBe(0);
    expect(none.lines.some((l) => l.feeId === 'GAL')).toBe(false);
  });

  it('puts counter fees in the total when an app booking pays at the course, but never the caddie fee', () => {
    const counterGallery = { ...ph, fees: ph.fees.map((f) => (f.kind === 'gallery' ? { ...f, paidTo: 'counter' as const } : f.kind === 'caddie' ? { ...f, paidTo: 'counter' as const } : f)) };
    const q = quote(counterGallery, { layoutId: 'L18', day: MON, time: 420, holes: 18, players: ['LOC'], gallery: 1, extras: ['LOCK'] });
    const atCourse = counterSplit(q.lines, true), staff = counterSplit(q.lines, false);
    expect(atCourse.collect.map((l) => l.feeId)).toEqual(expect.arrayContaining(['GAL', 'LOCK']));
    expect(atCourse.separate.map((l) => l.feeId)).toEqual(['CAD']);
    expect(staff.separate.map((l) => l.feeId).sort()).toEqual(['CAD', 'GAL', 'LOCK']);
    expect(dueWithBooking({ quote: q.lines, amount: q.total, channel: 'app' })).toBe(atCourse.total);
    expect(dueWithBooking({ quote: q.lines, amount: q.total, channel: 'phone' })).toBe(staff.total);
    // Lines saved before they carried their kind: the caddie line is known by its label.
    const old = q.lines.map(({ kind: _k, ...l }) => l); // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(counterSplit(old, true).separate.map((l) => l.feeId)).toEqual(['CAD']);
  });

  it('flags player types outside their days or hours, and missing green fees', () => {
    expect(quote(ph, { layoutId: 'L18', day: WED, time: 420, holes: 18, players: ['SEN'] }).problems).toEqual([]);
    expect(quote(ph, { layoutId: 'L18', day: MON, time: 420, holes: 18, players: ['SEN'] }).problems).toContain('Senior rates are for Wednesdays only.');
    expect(quote(ph, { layoutId: 'L18', day: MON, time: 600, holes: 18, players: ['JUN'] }).problems).toContain('Junior tee time starts at 11:00 AM.');
    expect(quote(ph, { layoutId: 'L18', day: SAT, time: 700, holes: 18, players: ['JUN'] }).problems).toContain('There is no 18-hole weekend green fee for Junior yet.');
  });
});

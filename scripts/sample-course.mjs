// Fills a sample course (Valley Golf Club) with tee slots, Philippine-style green fees and fees, and a few weeks of bookings.
// Local trials only: needs the server running with MAISON_DEV_AUTH=1. Run: node scripts/sample-course.mjs
const B = 'http://localhost:8787/api/v1';
const OWNER = 'owner@valley.ph';
const call = async (method, path, body) => {
  const r = await fetch(B + path, { method, headers: { authorization: `Bearer dev:${OWNER}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${j.error}`);
  return j;
};
const c = await call('POST', '/partners', { name: 'Valley Golf Club', address: 'Don Celso Tuason Ave', city: 'Antipolo', province: 'Rizal', phone: '0917 555 0100' });
const id = c.id;
let d = await call('GET', `/courses/${id}`);
const layoutId = d.setup.layouts[0].id;
const [loc, forg] = d.setup.playerTypes.map((t) => t.id);
await call('PUT', `/courses/${id}`, { ...c, description: 'Two 18-hole courses in the hills of Antipolo.', facilities: ['Driving range', 'Restaurant'] });
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
await call('PUT', `/courses/${id}/teetimes`, { layouts: [{ id: layoutId, name: 'North course', holes: 18, startTees: ['1', '10'] }], settings: [{ layoutId, effectiveFrom: today, firstTee: 330, lastTee: 780, interval: 8, maxPlayers: 4 }] });
const R = (t, dt, holes, amount, band = 'regular') => ({ playerTypeId: t, dayType: dt, holes, band, effectiveFrom: today, amount });
const r = await call('PUT', `/courses/${id}/rates`, {
  playerTypes: [
    { id: loc, name: 'Local', public: true, proof: '' }, { id: forg, name: 'Foreign', public: true, proof: 'Passport' },
    { id: 'senior', name: 'Senior', public: true, proof: 'Senior citizen ID', days: [3] }, { id: 'junior', name: 'Junior', public: false, proof: 'School ID', earliest: 660 },
  ],
  rates: [
    R(loc, 'weekday', 18, 330000), R(loc, 'weekend', 18, 480000), R(loc, 'weekday', 9, 155000), R(loc, 'weekend', 9, 230000),
    R(forg, 'weekday', 18, 360000), R(forg, 'weekend', 18, 570000), R(forg, 'weekday', 9, 165000), R(forg, 'weekend', 9, 270000),
    R('senior', 'weekday', 18, 200000), R('junior', 'weekday', 18, 200000), R('junior', 'weekend', 18, 345000),
  ],
});
await call('PUT', `/courses/${id}/fees`, { fees: [
  { name: 'Golf cart', kind: 'cart', required: false, paidTo: 'booking', amounts: [{ holes: 18, dayType: 'weekday', playerTypeId: null, amount: 120000 }, { holes: 9, dayType: 'weekday', playerTypeId: null, amount: 60000 }] },
  { name: 'Caddie', kind: 'caddie', required: true, paidTo: 'direct', amounts: [{ holes: 18, dayType: 'weekday', playerTypeId: null, amount: 75000 }, { holes: 9, dayType: 'weekday', playerTypeId: null, amount: 40000 }] },
  { name: 'Gallery', kind: 'gallery', paidTo: 'booking', amounts: [{ holes: 18, dayType: 'weekday', playerTypeId: null, amount: 200000 }, { holes: 18, dayType: 'weekend', playerTypeId: null, amount: 285000 }] },
  { name: 'Development fee', kind: 'other', per: 'player', required: true, amounts: [{ holes: 18, dayType: 'weekday', playerTypeId: loc, amount: 4000 }, { holes: 18, dayType: 'weekday', playerTypeId: forg, amount: 6000 }] },
  { name: 'Hole-in-one insurance', kind: 'other', per: 'player', required: true, amounts: [{ holes: 18, dayType: 'weekday', playerTypeId: null, amount: 3000 }] },
  { name: 'Golf club rental', kind: 'other', per: 'player', required: false, paidTo: 'counter', amounts: [{ holes: 18, dayType: 'weekday', playerTypeId: null, amount: 150000 }] },
] });
await call('PUT', `/courses/${id}/options`, { cartSeats: 2, nineHoles: true, galleryMax: 2 });
await call('PUT', `/courses/${id}/rates`, { holidays: [{ day: '2026-11-30', name: 'Bonifacio Day' }, { day: '2026-12-08', name: 'Immaculate Conception' }, { day: '2026-12-25', name: 'Christmas Day' }] });

// Bookings across the next weeks so the strip shows fill.
const names = ['Reyes', 'Santos', 'Tanaka', 'Kim', 'Cruz', 'Lim', 'Garcia', 'Park', 'Dizon', 'Uy', 'Mendoza', 'Ramos'];
let k = 0;
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
for (let i = -6; i < 40; i++) {
  const day = addDays(today, i);
  const wk = new Date(day + 'T00:00:00Z').getUTCDay();
  const many = (wk === 0 || wk === 6 ? 26 : 9) - Math.max(0, i - 10) / 3;
  for (let j = 0; j < many; j++) {
    const time = 330 + 8 * ((j * 7 + i * 3) % 57);
    const tee = j % 2 ? '10' : '1';
    const players = 2 + ((j + i) % 3);
    const types = Array.from({ length: players }, (_, p) => (p === 0 && j % 4 === 1 ? forg : loc));
    try { await call('POST', `/courses/${id}/bookings`, { layoutId, startTee: tee, day, time, players, playerTypes: types, carts: Math.ceil(players / 2), contactName: `${names[k++ % names.length]} party`, channel: j % 3 ? 'phone' : 'walkin' }); } catch { /* slot taken */ }
  }
}
console.log(JSON.stringify({ id, slug: c.slug }));

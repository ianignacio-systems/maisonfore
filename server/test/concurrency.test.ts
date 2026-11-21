import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PARTNER, testServer } from './helpers';

/**
 * Many people booking the same slot at the same moment, on a real PostgreSQL server (PGlite has a single
 * connection, so it can't show this). Runs when TEST_DATABASE_URL is set.
 */
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('booking the same slot at the same time', () => {
  let t: Awaited<ReturnType<typeof testServer>>;
  beforeAll(async () => { t = await testServer({ url }); });
  afterAll(async () => t?.close());

  it('never puts more players on a slot than it holds', async () => {
    const c = await t.call('owner@valley.ph', 'POST', '/partners', PARTNER);
    const setup = (await t.call('owner@valley.ph', 'GET', `/courses/${c.body.id}`)).body.setup;
    const layoutId = setup.layouts[0].id;
    const tries = await Promise.all(Array.from({ length: 30 }, (_, i) =>
      t.call('owner@valley.ph', 'POST', `/courses/${c.body.id}/bookings`, { layoutId, startTee: '1', day: '2026-11-23', time: 360, players: 2, contactName: `Golfer ${i}` })));
    const ok = tries.filter((r) => r.status === 200);
    expect(ok).toHaveLength(2);
    expect(tries.filter((r) => r.status === 400).every((r) => /full|left/.test(r.body.error))).toBe(true);
    const [{ n }] = await t.db.query<{ n: number }>("select sum(players)::int as n from bookings where business_id = $1 and time_min = 360 and status = 'confirmed'", [c.body.id]);
    expect(n).toBe(4);
  });
});

import { devVerifier, pgDb, type Db } from '@maison/core';
import { pgliteDb } from '@maison/core/pglite';
import { zonedEpoch } from '@maison/engine';
import { buildApp } from '../src/app';
import { prepareDatabase } from '../src/schema';

/** A server on a fresh database (PGlite in memory, or TEST_DATABASE_URL), with a clock the test controls. */
export async function testServer(o: { url?: string } = {}) {
  let db: Db;
  if (o.url) {
    db = pgDb(o.url);
    await db.exec('drop schema public cascade; create schema public;');
  } else db = await pgliteDb();
  await prepareDatabase(db);
  const clock = { now: at('2026-11-20', '12:00') };
  const app = buildApp({ db, verify: devVerifier(), adminEmails: ['admin@maison.ph'], now: () => clock.now });
  const call = async (who: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) => {
    const r = await app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer dev:${who}` }, payload: body as object });
    return { status: r.statusCode, body: r.json() as any };
  };
  return { db, app, clock, call, close: async () => { await app.close(); await db.close(); } };
}

export const at = (day: string, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return zonedEpoch(day, h * 60 + m, 'Asia/Manila'); };

export const PARTNER = { name: 'Valley Golf Club', address: 'Don Mariano Marcos Ave', city: 'Antipolo', province: 'Rizal', phone: '02 8658 4901' };

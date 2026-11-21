process.env.TZ ||= 'Asia/Manila';
import { devVerifier, pgDb, supabaseVerifier, type Db } from '@maison/core';
import { buildApp } from './app';
import { expireHolds } from './bookings';
import { loadConfig } from './config';
import { prepareDatabase } from './schema';

/** Starts the MaisonFore server: brings the database up to date, then listens. */
const cfg = loadConfig();
let db: Db;
if (cfg.databaseUrl) db = pgDb(cfg.databaseUrl);
else {
  // Local trials without a database server: PostgreSQL in memory (everything is lost when it stops).
  const { pgliteDb } = await import('@maison/core/pglite');
  db = await pgliteDb();
  console.log('No DATABASE_URL: using an in-memory database (local trials only).');
}
const applied = await prepareDatabase(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
const verify = cfg.devAuth ? devVerifier() : supabaseVerifier(cfg.supabaseUrl, cfg.jwtSecret);
if (cfg.devAuth) console.log('Local sign-in (MAISON_DEV_AUTH=1): any email signs in without a password. Never use this online.');
const app = buildApp({ db, verify, corsOrigins: cfg.corsOrigins, logger: cfg.production, adminEmails: cfg.adminEmails, portalDir: cfg.portalDir || undefined });
if (cfg.portalDir) console.log(`Serving the portal from ${cfg.portalDir}.`);
await app.listen({ port: cfg.port, host: '0.0.0.0' });
console.log(`MaisonFore server on port ${cfg.port}. Maison admins by email: ${cfg.adminEmails.length}.`);
const tidy = setInterval(() => { expireHolds(db).catch((e) => console.error('Expiring holds failed', e)); }, 60_000);
const stop = async () => { clearInterval(tidy); await app.close(); await db.close(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

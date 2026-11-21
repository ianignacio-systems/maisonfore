import { pgDb } from '@maison/core';
import { prepareDatabase } from './schema';

/** npm run migrate: brings the database in DATABASE_URL up to date without starting the server. */
const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL first.'); process.exit(1); }
const db = pgDb(url);
const applied = await prepareDatabase(db);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
await db.close();

import { PGlite, types } from '@electric-sql/pglite';
import type { Db } from './db';

/** PostgreSQL in memory, for tests and local trials without Supabase. */
export async function pgliteDb(): Promise<Db> {
  const pg = new PGlite({ parsers: { [types.INT8]: (v: string) => Number(v), [types.NUMERIC]: (v: string) => Number(v) } });
  await pg.query("create extension if not exists pgcrypto").catch(() => {});
  let chain: Promise<unknown> = Promise.resolve();
  type Q = { query: PGlite['query']; exec: PGlite['exec'] };
  const wrap = (q: Q): Db => ({
    query: async <T,>(sql: string, params: unknown[] = []) => (await q.query<T>(sql, params)).rows,
    exec: async (sql: string) => { await q.exec(sql); },
    tx: async () => { throw new Error('Nested transactions are not supported.'); },
    close: async () => {},
  });
  return {
    query: wrap(pg).query,
    exec: wrap(pg).exec,
    // PGlite has one connection: transactions run one after another.
    tx: async (fn) => {
      const run = chain.then(() => pg.transaction((t) => fn(wrap(t as unknown as Q))));
      chain = run.catch(() => {});
      return run;
    },
    close: () => pg.close(),
  };
}

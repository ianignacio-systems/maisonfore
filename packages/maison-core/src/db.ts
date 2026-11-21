import pg from 'pg';

/**
 * The database, as the rest of the server sees it: queries with $1, $2 … parameters, and
 * transactions. Two adapters: node-postgres for Supabase, and PGlite (PostgreSQL in memory) for tests.
 * Big integers (money, times) and numerics (quantities, costs) come back as JavaScript numbers.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs a script of several statements (no parameters): migrations. */
  exec(sql: string): Promise<void>;
  /** Runs `fn` in one transaction: everything is saved, or nothing. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const INT8 = 20, NUMERIC = 1700;
pg.types.setTypeParser(INT8, (v) => Number(v));
pg.types.setTypeParser(NUMERIC, (v) => Number(v));

/**
 * The connection string without ssl settings: they would override ours, and Supabase's certificate
 * isn't signed by a public authority, so a strict check would refuse it. The connection is still encrypted.
 */
export function cleanUrl(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    for (const k of ['sslmode', 'ssl', 'sslrootcert', 'uselibpqcompat']) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return connectionString;
  }
}

export function pgDb(connectionString: string): Db {
  // No TLS to this machine, or to a host on the same private network (Render's internal address has no dots).
  let host = '';
  try { host = new URL(connectionString).hostname; } catch { /* leave it to pg */ }
  const local = /localhost|127\.0\.0\.1/.test(connectionString) || (host !== '' && !host.includes('.'));
  const pool = new pg.Pool({ connectionString: cleanUrl(connectionString), max: 10, ssl: local ? undefined : { rejectUnauthorized: false } });
  const wrap = (client: pg.Pool | pg.PoolClient): Db => ({
    query: async <T,>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[],
    exec: async (sql: string) => { await client.query(sql); },
    tx: async () => { throw new Error('Nested transactions are not supported.'); },
    close: async () => {},
  });
  return {
    query: wrap(pool).query,
    exec: wrap(pool).exec,
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(wrap(client));
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

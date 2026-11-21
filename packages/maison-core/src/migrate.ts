import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db';

/** Where a set of migrations lives: the shared core's, then the product's own. */
export interface MigrationSource { name: string; dir: string }

export const CORE_MIGRATIONS: MigrationSource = { name: 'core', dir: join(import.meta.dirname, '..', 'migrations') };

/**
 * Brings the database up to date: runs each NNN_name.sql of each source not yet applied, in order,
 * each in its own transaction, and records it in schema_migrations as "<source>:<NNN>".
 */
export async function migrate(db: Db, sources: MigrationSource[]): Promise<string[]> {
  await db.query('create table if not exists schema_migrations (id text primary key, applied_at bigint not null)');
  const done = new Set((await db.query<{ id: string }>('select id from schema_migrations')).map((r) => r.id));
  const applied: string[] = [];
  for (const src of sources) {
    const files = readdirSync(src.dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      const id = `${src.name}:${f.slice(0, 3)}`;
      if (done.has(id)) continue;
      const sql = readFileSync(join(src.dir, f), 'utf8');
      await db.tx(async (t) => {
        await t.exec(sql);
        await t.query('insert into schema_migrations (id, applied_at) values ($1, $2) on conflict do nothing', [id, Date.now()]);
      });
      applied.push(id);
    }
  }
  return applied;
}

/** Turns row-level security on for every table, with no policies: browser keys can't read or write anything. */
export async function lockOutBrowserKeys(db: Db): Promise<void> {
  await db.exec(`do $$ declare t record; begin
    for t in select tablename from pg_tables where schemaname = current_schema() loop
      execute format('alter table %I enable row level security', t.tablename);
    end loop; end $$;`);
}

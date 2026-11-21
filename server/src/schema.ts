import { join } from 'node:path';
import { CORE_MIGRATIONS, lockOutBrowserKeys, migrate, type Db } from '@maison/core';

export const FORE_MIGRATIONS = { name: 'fore', dir: join(import.meta.dirname, '..', 'migrations') };

/** Brings MaisonFore's database up to date: the Maison core foundation, then MaisonFore's own tables. */
export async function prepareDatabase(db: Db): Promise<string[]> {
  const applied = await migrate(db, [CORE_MIGRATIONS, FORE_MIGRATIONS]);
  await lockOutBrowserKeys(db);
  return applied;
}

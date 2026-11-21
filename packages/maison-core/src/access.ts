import type { Caller } from './auth';
import type { Db } from './db';
import { Forbidden, NotFound } from './errors';
import { newId } from './ids';

/**
 * The caller's Maison account, created the first time they reach this product's server. A Supabase
 * sign-in is the account with the same (confirmed) email, whatever its id, so one person stays one account.
 */
export async function ensureAccount(db: Db, c: Caller, now = Date.now()): Promise<Caller> {
  const [a] = await db.query<{ id: string }>('select id from accounts where lower(email) = $1', [c.email]);
  if (a) return { ...c, accountId: a.id };
  await db.query(
    `insert into accounts (id, email, created_at) values ($1, $2, $3) on conflict (id) do update set email = excluded.email`,
    [c.accountId, c.email, now],
  );
  return c;
}

/**
 * The caller's role in a business. A business they don't belong to looks the same as one that doesn't
 * exist. `allowed`: the roles that may do this.
 */
export async function memberRole<R extends string>(db: Db, c: Caller, businessId: string, allowed?: readonly R[]): Promise<R> {
  const [m] = await db.query<{ role: R }>('select role from members where business_id = $1 and account_id = $2', [businessId, c.accountId]);
  const role = m?.role;
  if (!role) throw new NotFound('Not found.');
  if (allowed && !allowed.includes(role)) throw new Forbidden();
  return role;
}

export async function isPlatformAdmin(db: Db, c: Caller): Promise<boolean> {
  return (await db.query('select 1 from platform_admins where account_id = $1', [c.accountId])).length > 0;
}

/** Makes the accounts with these emails platform admins once they have signed in (PLATFORM_ADMIN_EMAILS). */
export async function syncAdminEmails(db: Db, c: Caller, emails: string[], now = Date.now()): Promise<void> {
  if (!emails.includes(c.email)) return;
  await db.query('insert into platform_admins (account_id, email, added_at) values ($1, $2, $3) on conflict do nothing', [c.accountId, c.email, now]);
}

/** Records who changed what (the business's activity log). Append-only. */
export async function audit(db: Db, businessId: string, by: string, action: string, subject: string, detail = '', data: unknown = null, at = Date.now()): Promise<void> {
  await db.query('insert into audit (business_id, id, at, by_name, action, subject, detail, data) values ($1, $2, $3, $4, $5, $6, $7, $8)',
    [businessId, newId(), at, by, action, subject, detail, data === null ? null : JSON.stringify(data)]);
}

export async function platformLog(db: Db, by: string, action: string, businessId: string | null, detail = '', at = Date.now()): Promise<void> {
  await db.query('insert into platform_log (at, by_name, action, business_id, detail) values ($1, $2, $3, $4, $5)', [at, by, action, businessId, detail]);
}

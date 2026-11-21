import { audit, Forbidden, UserError, type Caller, type Db } from '@maison/core';
import { oneOf, text } from './check';
import { CAN, roleAt, ROLES, type Role } from './courses';

const ROLE_WORDS: Record<Role, string> = { owner: 'Owner', manager: 'Manager', starter: 'Starter', viewer: 'View only' };
const email = (v: unknown) => {
  const e = text(v, 'the email', { required: true, max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new UserError('Enter a valid email address.');
  return e;
};

/** The course's staff and the invites not yet taken up (owners only). */
export async function listStaff(db: Db, c: Caller, courseId: string) {
  await roleAt(db, c, courseId, CAN.staff);
  const members = await db.query<{ email: string; role: Role; added_at: number }>(
    'select email, role, added_at from members where business_id = $1 order by case role when \'owner\' then 0 when \'manager\' then 1 when \'starter\' then 2 else 3 end, email', [courseId]);
  const invites = await db.query<{ email: string; role: Role; invited_by: string; created_at: number }>(
    'select email, role, invited_by, created_at from invites where business_id = $1 order by created_at desc', [courseId]);
  return {
    staff: members.map((m) => ({ email: m.email, role: m.role, since: Number(m.added_at), you: m.email.toLowerCase() === c.email.toLowerCase() })),
    invites: invites.map((i) => ({ email: i.email, role: i.role, invitedBy: i.invited_by, at: Number(i.created_at) })),
  };
}

/**
 * Adds someone by email. If they already have a Maison account they join straight away; otherwise the
 * invite waits and they join the first time they sign in with that email.
 */
export async function inviteStaff(db: Db, c: Caller, courseId: string, input: Record<string, unknown>, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.staff);
  const e = email(input.email);
  const role = oneOf(input.role, 'owner, manager, starter or view only', ROLES);
  await db.tx(async (q) => {
    if ((await q.query('select 1 from members where business_id = $1 and lower(email) = $2', [courseId, e])).length) throw new UserError(`${e} is already on the staff. Change their role instead.`);
    const [a] = await q.query<{ id: string }>('select id from accounts where lower(email) = $1', [e]);
    if (a) {
      await q.query('insert into members (business_id, account_id, email, role, added_at) values ($1, $2, $3, $4, $5)', [courseId, a.id, e, role, now]);
    } else {
      await q.query(`insert into invites (business_id, email, role, invited_by, created_at) values ($1, $2, $3, $4, $5)
        on conflict (business_id, email) do update set role = excluded.role, invited_by = excluded.invited_by, created_at = excluded.created_at`, [courseId, e, role, c.email, now]);
    }
    await audit(q, courseId, c.email, a ? 'staff.added' : 'staff.invited', e, ROLE_WORDS[role], null, now);
  });
  return listStaff(db, c, courseId);
}

/** Changes a staff member's role, or an invite's. A course always keeps at least one owner. */
export async function changeRole(db: Db, c: Caller, courseId: string, input: Record<string, unknown>, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.staff);
  const e = email(input.email);
  const role = oneOf(input.role, 'owner, manager, starter or view only', ROLES);
  await db.tx(async (q) => {
    const [m] = await q.query<{ role: Role }>('select role from members where business_id = $1 and lower(email) = $2 for update', [courseId, e]);
    if (!m) {
      const r = await q.query('update invites set role = $3 where business_id = $1 and email = $2 returning email', [courseId, e, role]);
      if (!r.length) throw new UserError(`${e} isn’t on the staff.`);
    } else {
      if (m.role === 'owner' && role !== 'owner') await keepAnOwner(q, courseId);
      await q.query('update members set role = $3 where business_id = $1 and lower(email) = $2', [courseId, e, role]);
    }
    await audit(q, courseId, c.email, 'staff.role', e, ROLE_WORDS[role], null, now);
  });
  return listStaff(db, c, courseId);
}

/** Removes a staff member or cancels an invite. */
export async function removeStaff(db: Db, c: Caller, courseId: string, who: string, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.staff);
  const e = email(who);
  await db.tx(async (q) => {
    const [m] = await q.query<{ role: Role }>('select role from members where business_id = $1 and lower(email) = $2 for update', [courseId, e]);
    if (m) {
      if (m.role === 'owner') await keepAnOwner(q, courseId);
      await q.query('delete from members where business_id = $1 and lower(email) = $2', [courseId, e]);
    } else if (!(await q.query('delete from invites where business_id = $1 and email = $2 returning email', [courseId, e])).length) {
      throw new UserError(`${e} isn’t on the staff.`);
    }
    await audit(q, courseId, c.email, 'staff.removed', e, '', null, now);
  });
  return listStaff(db, c, courseId);
}

async function keepAnOwner(q: Db, courseId: string) {
  const owners = await q.query("select 1 from members where business_id = $1 and role = 'owner'", [courseId]);
  if (owners.length <= 1) throw new Forbidden('A course needs at least one owner. Make someone else an owner first.');
}

/** On sign-in: invites waiting for this email become memberships. */
export async function claimInvites(db: Db, c: Caller, now = Date.now()) {
  const waiting = await db.query<{ business_id: string; role: Role }>('select business_id, role from invites where email = $1', [c.email.toLowerCase()]);
  for (const w of waiting) {
    await db.tx(async (q) => {
      await q.query('insert into members (business_id, account_id, email, role, added_at) values ($1, $2, $3, $4, $5) on conflict do nothing', [w.business_id, c.accountId, c.email, w.role, now]);
      await q.query('delete from invites where business_id = $1 and email = $2', [w.business_id, c.email.toLowerCase()]);
      await audit(q, w.business_id, c.email, 'staff.joined', c.email, ROLE_WORDS[w.role], null, now);
    });
  }
}

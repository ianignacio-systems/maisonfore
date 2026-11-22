import webpush from 'web-push';
import { UserError, type Caller, type Db } from '@maison/core';

/**
 * Telling golfers: a message in the app's inbox, and a phone alert (Web Push) on every phone or browser where
 * they turned alerts on. Alerts need the server's VAPID keys (see SETUP.md); without them golfers still get
 * the message in the app.
 */

let vapid: { publicKey: string } | null = null;
export function configurePush(env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string }) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:support@maisonfore.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    vapid = { publicKey: env.VAPID_PUBLIC_KEY };
  } else vapid = null;
}
export const pushKey = () => ({ key: vapid?.publicKey ?? null });

export interface Message { businessId?: string | null; kind: string; title: string; body: string; link?: string; refId?: string }

/** Saves a message for a golfer. With a refId, the same message is never saved twice. Returns whether it was new. */
export async function tell(q: Db, accountId: string, m: Message, now: number): Promise<boolean> {
  const r = await q.query(
    `insert into golfer_messages (account_id, business_id, kind, title, body, link, ref_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (account_id, kind, ref_id) where ref_id <> '' do nothing returning id`,
    [accountId, m.businessId ?? null, m.kind, m.title, m.body, m.link ?? '', m.refId ?? '', now]);
  return r.length > 0;
}

/** Sends phone alerts for messages not yet sent (from the last hour; older news isn't worth a buzz). */
export async function sendAlerts(db: Db, now = Date.now()): Promise<number> {
  const due = await db.query<{ id: string; account_id: string; title: string; body: string; link: string }>(
    'select id, account_id, title, body, link from golfer_messages where pushed_at is null and created_at > $1 order by id limit 200', [now - 3_600_000]);
  let sent = 0;
  for (const m of due) {
    await db.query('update golfer_messages set pushed_at = $2 where id = $1', [m.id, now]);
    if (!vapid) continue;
    const subs = await db.query<{ endpoint: string; keys: { p256dh: string; auth: string } }>('select endpoint, keys from push_subs where account_id = $1', [m.account_id]);
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: m.title, body: m.body, link: m.link || '/play/' }), { TTL: 3600, urgency: 'high' });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.query('delete from push_subs where endpoint = $1', [s.endpoint]); // that phone turned alerts off
      }
    }
  }
  return sent;
}

/** A golfer turns phone alerts on (or the browser renewed its subscription). */
export async function savePushSub(db: Db, c: Caller, input: Record<string, unknown>, now = Date.now()) {
  const sub = input.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') {
    throw new UserError('This phone didn’t give a way to send alerts. Try again.');
  }
  await db.query(
    `insert into push_subs (endpoint, account_id, keys, created_at) values ($1, $2, $3, $4)
     on conflict (endpoint) do update set account_id = excluded.account_id, keys = excluded.keys`,
    [sub.endpoint.slice(0, 1000), c.accountId, JSON.stringify({ p256dh: sub.keys.p256dh, auth: sub.keys.auth }), now]);
  return { ok: true };
}

export async function dropPushSub(db: Db, c: Caller, input: Record<string, unknown>) {
  await db.query('delete from push_subs where endpoint = $1 and account_id = $2', [String(input.endpoint ?? ''), c.accountId]);
  return { ok: true };
}

/** The golfer's inbox: newest first, with how many are unread. */
export async function myMessages(db: Db, c: Caller) {
  const list = await db.query<{ id: string; kind: string; title: string; body: string; link: string; created_at: number; read_at: number | null }>(
    'select id, kind, title, body, link, created_at, read_at from golfer_messages where account_id = $1 order by created_at desc, id desc limit 40', [c.accountId]);
  return {
    unread: list.filter((m) => m.read_at === null).length,
    messages: list.map((m) => ({ id: String(m.id), kind: m.kind, title: m.title, body: m.body, link: m.link, at: Number(m.created_at), read: m.read_at !== null })),
  };
}

export async function readMessages(db: Db, c: Caller, now = Date.now()) {
  await db.query('update golfer_messages set read_at = $2 where account_id = $1 and read_at is null', [c.accountId, now]);
  return { ok: true };
}

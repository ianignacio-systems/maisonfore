import type { Caller, Db } from '@maison/core';
import { addDays, buildSheet, localParts, takesSlot, type QuoteLine } from '@maison/engine';
import { BOOKING_COLS, bookingOf, daySummary, type BookingRow } from './bookings';
import { CAN, loadSetup, roleAt } from './courses';

/** What the course collects for a booking: its price less fees paid straight to the caddie. */
const collectable = (b: BookingRow) => (b.quote.length ? b.quote.filter((l: QuoteLine) => (l.payAt as string) !== 'direct').reduce((s, l) => s + l.amount, 0) : b.amount);
const paid = (b: BookingRow) => (b.payStatus === 'unpaid' ? 0 : b.payStatus === 'paid_online' ? b.payInApp || collectable(b) : b.paidAmount);

/**
 * The owner's and manager's overview: today at a glance, what is still to collect, the next flights,
 * the week ahead, what needs attention, and the last 30 days by channel and player type.
 */
export async function overview(db: Db, c: Caller, courseId: string, now = Date.now()) {
  await roleAt(db, c, courseId, CAN.setup);
  const setup = await loadSetup(db, courseId);
  const { day: today, minutes: nowMin } = localParts(now, setup.timeZone);
  const since = addDays(today, -30), weekEnd = addDays(today, 6);
  const rows = (await db.query(`select ${BOOKING_COLS} from bookings where business_id = $1 and day between $2 and $3`, [courseId, since, weekEnd])).map(bookingOf);
  const blocks = await db.query('select * from blocks where business_id = $1 and day = $2 and removed_at is null', [courseId, today]);

  // Today
  const todays = rows.filter((b) => b.day === today);
  const live = todays.filter((b) => takesSlot(b, now) || b.status === 'checked_in' || b.status === 'played');
  const sum = (await daySummary(db, c, courseId, { from: today, to: weekEnd }, now));
  const t = sum[0];
  const todayFigures = {
    players: live.reduce((n, b) => n + b.players, 0), capacity: t?.capacity ?? 0, bookings: live.length,
    checkedIn: live.filter((b) => b.status === 'checked_in' || b.status === 'played').reduce((n, b) => n + b.players, 0),
    noShows: todays.filter((b) => b.status === 'no_show').length,
    booked: live.reduce((n, b) => n + collectable(b), 0),
    collected: live.reduce((n, b) => n + paid(b), 0),
    closedNote: blocks.some((b) => b.kind === 'weather' || b.kind === 'maintenance') ? 'Some times are closed today.' : null,
  };

  // The next flights from now
  const next = live.filter((b) => b.status !== 'played' && (b.special || b.time >= nowMin - 10)).sort((a, b) => a.time - b.time).slice(0, 6)
    .map((b) => ({ id: b.id, time: b.time, special: b.special === true, layoutId: b.layoutId, startTee: b.startTee, name: b.contactName, players: b.players, status: b.status, paid: b.payStatus !== 'unpaid' }));

  // Needs attention
  const attention: { kind: string; text: string; day: string }[] = [];
  const unpaidPlayed = rows.filter((b) => b.day >= addDays(today, -7) && b.day <= today && (b.status === 'played' || b.status === 'checked_in') && b.payStatus === 'unpaid');
  if (unpaidPlayed.length) {
    attention.push({ kind: 'unpaid', day: unpaidPlayed[0].day,
      text: `${unpaidPlayed.length} ${unpaidPlayed.length === 1 ? 'round' : 'rounds'} played in the last 7 days with no payment recorded: ₱${(unpaidPlayed.reduce((n, b) => n + collectable(b), 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}.` });
  }
  const heldOpen = rows.filter((b) => b.status === 'held' && takesSlot(b, now));
  if (heldOpen.length) attention.push({ kind: 'held', day: heldOpen[0].day, text: `${heldOpen.length} ${heldOpen.length === 1 ? 'booking is' : 'bookings are'} on hold, waiting to be confirmed.` });
  for (const d of sum.slice(0, 7)) {
    const dayRows = rows.filter((b) => b.day === d.day && takesSlot(b, now));
    if (!dayRows.length) continue;
    const dayBlocks = (await db.query('select * from blocks where business_id = $1 and day = $2 and removed_at is null', [courseId, d.day])).map((r) => ({
      id: r.id as string, layoutId: (r.layout_id as string) ?? null, startTee: (r.start_tee as string) ?? null, day: r.day as string, from: r.from_min as number,
      to: r.to_min as number, kind: r.kind as 'walkin', reason: r.reason as string, releaseAt: (r.release_at as number) ?? null }));
    const onSheet = new Set<string>();
    let blocked = 0;
    for (const l of setup.layouts.filter((x) => x.active)) {
      for (const s of buildSheet(setup, { layoutId: l.id, day: d.day, bookings: dayRows, blocks: dayBlocks, now, audience: 'staff' })) {
        onSheet.add(`${s.layoutId}|${s.startTee}|${s.time}`);
        if (s.state === 'closed') blocked += s.bookings.length;
      }
    }
    const loose = dayRows.filter((b) => !b.special && !onSheet.has(`${b.layoutId}|${b.startTee}|${b.time}`)).length;
    if (loose + blocked) attention.push({ kind: 'move', day: d.day, text: `${loose + blocked} ${loose + blocked === 1 ? 'booking' : 'bookings'} on ${d.day === today ? 'today’s' : 'a'} closed or removed tee time. Call to move or cancel.` });
  }
  if (c && (await db.query("select 1 from members where business_id = $1 and account_id = $2 and role = 'owner'", [courseId, c.accountId])).length) {
    const invites = await db.query('select email from invites where business_id = $1', [courseId]);
    if (invites.length) attention.push({ kind: 'staff', day: today, text: `${invites.length} staff ${invites.length === 1 ? 'hasn’t' : 'haven’t'} signed in yet: ${invites.map((i) => i.email).join(', ')}.` });
  }

  // Last 30 days, rounds that happened (or should have)
  const past = rows.filter((b) => b.day >= since && b.day < today && (b.status === 'played' || b.status === 'checked_in' || b.status === 'no_show'));
  const played = past.filter((b) => b.status !== 'no_show');
  const byChannel: Record<string, { rounds: number; players: number; revenue: number }> = {};
  for (const b of played) {
    const k = byChannel[b.channel] ??= { rounds: 0, players: 0, revenue: 0 };
    k.rounds++; k.players += b.players; k.revenue += collectable(b);
  }
  const typeRows = played.length ? await db.query<{ player_type_id: string; n: number; rate: number }>(
    `select p.player_type_id, count(*)::int as n, sum(p.rate)::bigint as rate from booking_players p join bookings b on b.business_id = p.business_id and b.id = p.booking_id
      where b.business_id = $1 and b.day >= $2 and b.day < $3 and b.status in ('played', 'checked_in') group by p.player_type_id`, [courseId, since, today]) : [];
  const typeName = new Map(setup.playerTypes.map((p) => [p.id, p.name]));
  const last30 = {
    rounds: played.length, players: played.reduce((n, b) => n + b.players, 0), revenue: played.reduce((n, b) => n + collectable(b), 0),
    noShows: past.length - played.length, noShowRate: past.length ? (past.length - played.length) / past.length : 0,
    byChannel: Object.entries(byChannel).map(([channel, v]) => ({ channel, ...v })).sort((a, b) => b.players - a.players),
    byPlayerType: typeRows.map((r) => ({ name: typeName.get(r.player_type_id) ?? 'Other', players: Number(r.n), greenFees: Number(r.rate) })).sort((a, b) => b.players - a.players),
  };

  return { today, nowMin, todayFigures, next, week: sum, attention, last30 };
}

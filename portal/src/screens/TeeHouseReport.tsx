import { useCallback, useEffect, useState } from 'react';
import { Btn, Field } from '@maison/core/ui/kit';
import { addDays, formatDay, formatTime, localParts, peso } from '@maison/engine';
import { api } from '../api';

interface DayRow { day: string; orders: number; sales: number; share: number; due: number; collected: number; uncollected: number; remitted: { amount: number; note: string; by: string; at: number } | null }
interface HouseRow {
  id: string; name: string; concessionaire: string; sharePercent: number; rentAmount: number; rentNote: string; receipts: 'club' | 'tee_house';
  days: DayRow[]; orders: number; sales: number; share: number; due: number; collected: number; uncollected: number; remitted: number;
  lines: { id: string; day: string; at: number; ref: string; player: string; label: string; qty: number; amount: number; settled: boolean }[];
}
interface Report { from: string; to: string; teeHouses: HouseRow[]; unsettled: { bookingId: string; ref: string; day: string; time: number; contactName: string; teeHouseCharges: number }[] }

/**
 * What the club owes each tee house: their sales charged to passports, the club's share, what's due, what
 * the counter has collected so far, and which days have been paid out. The club owes every order charged
 * to a passport; groups who haven't settled are listed to follow up.
 */
export function TeeHouseReport({ courseId, timeZone, openDay, openScreen }: { courseId: string; timeZone: string; openDay: (day: string) => void; openScreen: () => void }) {
  const today = localParts(Date.now(), timeZone).day;
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [r, setR] = useState<Report | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api<Report>(`/courses/${courseId}/teehouse-report?from=${from}&to=${to}`).then(setR).catch((e) => setMsg((e as Error).message)), [courseId, from, to]);
  useEffect(() => { void load(); }, [load]);
  const remit = async (h: HouseRow, d: DayRow, undo = false) => {
    const note = undo ? '' : prompt(`Paid ${peso(d.due)} to ${h.concessionaire || h.name} for ${formatDay(d.day)}. Add a note (optional), e.g. “cash, received by Nena”:`, '');
    if (note === null) return;
    try { await api(`/courses/${courseId}/teehouse-remits`, { method: 'POST', body: { teeHouseId: h.id, day: d.day, amount: undo ? null : d.due, note } }); void load(); } catch (e) { setMsg((e as Error).message); }
  };
  const range = (n: number) => { setTo(today); setFrom(addDays(today, -n)); };
  return (
    <div className="page fore-thr">
      <header className="fore-set-head">
        <h2>Tee houses</h2>
        <p>What each tee house sold on golfers’ passports, the club’s share, and what’s due to them. The club owes every order on a passport, whether or not the golfer has settled.</p>
      </header>
      <div className="fore-thr-bar">
        <Field label="From" type="date" value={from} onChange={(v) => v && setFrom(v)} sm />
        <Field label="To" type="date" value={to} onChange={(v) => v && setTo(v)} sm />
        <Btn size="sm" onClick={() => { setFrom(today); setTo(today); }}>Today</Btn>
        <Btn size="sm" onClick={() => range(6)}>Last 7 days</Btn>
        <Btn size="sm" onClick={() => range(29)}>Last 30 days</Btn>
        <span className="grow" />
        <Btn size="sm" kind="ghost" onClick={openScreen}>Open the tee house screen</Btn>
      </div>
      {msg ? <p className="fore-error">{msg}</p> : null}
      {!r ? <p className="muted">Loading…</p> : !r.teeHouses.length ? <p className="fore-empty-line">No tee houses yet. Add them in Settings → Tee houses.</p> : r.teeHouses.map((h) => (
        <section key={h.id} className="fore-panel fore-thr-house">
          <div className="fore-thr-top">
            <div><h3>{h.name}</h3><span className="muted small">{[h.concessionaire && `Run by ${h.concessionaire}`, `club keeps ${h.sharePercent}%`, h.rentAmount ? `rent ${peso(h.rentAmount)}${h.rentNote ? ` ${h.rentNote}` : ' (settled separately)'}` : '', h.receipts === 'tee_house' ? 'the tee house issues its own receipts' : 'the club issues receipts'].filter(Boolean).join(', ')}</span></div>
          </div>
          <div className="fore-thr-figs">
            <div><small>Sales</small><b>{peso(h.sales)}</b><span>{h.orders} {h.orders === 1 ? 'order' : 'orders'}</span></div>
            <div><small>Club’s share</small><b>{peso(h.share)}</b><span>{h.sharePercent}%</span></div>
            <div className="due"><small>Due to the tee house</small><b>{peso(h.due)}</b><span>{h.remitted ? `${peso(h.remitted)} paid out` : 'Nothing paid out yet'}</span></div>
            <div><small>Collected at the counter</small><b>{peso(h.collected)}</b><span>{h.uncollected ? `${peso(h.uncollected)} not settled yet` : 'All settled'}</span></div>
          </div>
          {h.days.length ? (
            <table className="fore-ov-table fore-thr-days">
              <thead><tr><th>Day</th><th>Orders</th><th>Sales</th><th>Share</th><th>Due</th><th>Paid out</th><th /></tr></thead>
              <tbody>{h.days.map((d) => (
                <tr key={d.day}><td>{formatDay(d.day)}</td><td>{d.orders}</td><td>{peso(d.sales)}</td><td>{peso(d.share)}</td><td><b>{peso(d.due)}</b></td>
                  <td>{d.remitted ? <span className="fore-ok">{peso(d.remitted.amount)}{d.remitted.note ? `, ${d.remitted.note}` : ''}</span> : <span className="muted">Not yet</span>}</td>
                  <td>{d.remitted ? <button className="fore-link" onClick={() => void remit(h, d, true)}>Undo</button> : <Btn size="sm" onClick={() => void remit(h, d)}>Mark paid out</Btn>}</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="fore-empty-line">No orders in these days.</p>}
          {h.lines.length ? <button className="fore-link" onClick={() => setOpen(open === h.id ? null : h.id)}>{open === h.id ? 'Hide the orders' : `Show the ${h.lines.length} orders`}</button> : null}
          {open === h.id ? (
            <table className="fore-ov-table">
              <thead><tr><th>When</th><th>Booking</th><th>Player</th><th>Item</th><th>Amount</th><th>Settled</th></tr></thead>
              <tbody>{h.lines.map((l) => <tr key={l.id}><td>{formatDay(l.day).replace(/^\w+, /, '')} {new Date(l.at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</td><td>{l.ref}</td><td>{l.player}</td><td>{l.qty > 1 ? `${l.qty} × ` : ''}{l.label}</td><td>{peso(l.amount)}</td><td>{l.settled ? 'Yes' : 'Not yet'}</td></tr>)}</tbody>
            </table>
          ) : null}
        </section>
      ))}
      {r?.unsettled.length ? (
        <section className="fore-panel">
          <h3>Not settled yet</h3>
          <p className="muted small">These groups have tee house orders on their passports and haven’t settled at the counter. The club still owes the tee houses for them.</p>
          <ul className="fore-ov-attn">{r.unsettled.map((u) => <li key={u.bookingId}><span>{formatDay(u.day)}, {u.time >= 0 ? formatTime(u.time) : 'no set time'}: {u.contactName} ({u.ref}), {peso(u.teeHouseCharges)} in tee house orders</span><button className="fore-link" onClick={() => openDay(u.day)}>Open the day</button></li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}

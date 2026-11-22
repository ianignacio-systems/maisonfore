import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Btn, Field, Seg, Select } from '@maison/core/ui/kit';
import { formatDay, formatTime, peso, type CourseSetup } from '@maison/engine';
import { api, type StaffBooking } from '../api';

export interface PassportLine { label: string; amount: number; unit: string | null }
export interface Passport {
  n: number; name: string; mobile: string; type: string; lines: PassportLine[]; total: number; paid: number; balance: number;
  charges: { id: string; label: string; qty: number; unit: number; amount: number; teeHouseId: string | null; teeHouse: string; at: number; by: string }[];
}
export interface PassportsData { players: Passport[]; total: number; paid: number; balance: number; settled: boolean; payments: { n: number | null; amount: number; method: string; ref: string; at: number }[] }
interface TeeHouseLite { id: string; name: string; items: { id: string; name: string; price: number }[] }

const METHODS = [{ value: 'cash', label: 'Cash' }, { value: 'gcash', label: 'GCash' }, { value: 'maya', label: 'Maya' }, { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank' }];
const newClientId = () => `counter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Registration on arrival: each player's name and mobile, then their passports open. */
export function RegisterForm({ courseId, b, roster, required, onBack, onDone }: {
  courseId: string; b: StaffBooking; roster: { n: number; name: string }[]; required: boolean; onBack: () => void; onDone: (p: PassportsData) => void;
}) {
  const [rows, setRows] = useState(() => Array.from({ length: b.players }, (_, i) => ({ name: roster.find((r) => r.n === i + 1)?.name || (i === 0 ? b.contactName : ''), mobile: i === 0 ? b.mobile : '' })));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setMsg(null);
    try { onDone(await api<PassportsData>(`/courses/${courseId}/bookings/${b.id}/register`, { method: 'POST', body: { players: rows } })); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="fore-subform">
      <b>Register {b.players} {b.players === 1 ? 'player' : 'players'}</b>
      <p className="muted small">Each player gets a passport. Nothing is paid now: they settle at the counter after the round. Caddie fees are paid separately.</p>
      {rows.map((r, i) => (
        <div key={i} className="grid fore-2">
          <Field label={`Player ${i + 1}${required ? '' : ' (name optional)'}`} value={r.name} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, name: v } : x)))} autoFocus={i === 0} />
          <Field label="Mobile" type="tel" value={r.mobile} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, mobile: v } : x)))} placeholder="0917 123 4567" />
        </div>
      ))}
      {msg ? <p className="fore-error">{msg}</p> : null}
      <div className="row"><Btn kind="primary" disabled={busy} onClick={() => void go()}>{busy ? 'Registering…' : 'Register and open passports'}</Btn><Btn kind="ghost" onClick={onBack}>Back</Btn></div>
    </div>
  );
}

/**
 * The group's passports at the counter: each player's share of the booking, the tee houses' orders, what's
 * paid and what's left. Settle one player or the whole group; move a cart to whoever pays it; type in an
 * order from a paper passport; print the passports.
 */
export function PassportsPanel({ courseId, b, setup, courseName, data, readOnly, onChange }: {
  courseId: string; b: StaffBooking; setup: CourseSetup; courseName: string; data: PassportsData; readOnly?: boolean; onChange: (p: PassportsData) => void;
}) {
  const [paying, setPaying] = useState<number | 'all' | null>(null);
  const [method, setMethod] = useState('cash');
  const [ref, setRef] = useState('');
  const [adding, setAdding] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = () => api<PassportsData>(`/courses/${courseId}/bookings/${b.id}/passports`).then(onChange);
  const settle = async () => {
    setBusy(true); setMsg(null);
    try {
      onChange(await api<PassportsData>(`/courses/${courseId}/bookings/${b.id}/settle`, { method: 'POST', body: { player: paying === 'all' ? null : paying, method, ref } }));
      setPaying(null); setRef('');
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const move = async (unit: string, to: number) => {
    setMsg(null);
    try { onChange(await api<PassportsData>(`/courses/${courseId}/bookings/${b.id}/passport-move`, { method: 'POST', body: { unit, to } })); } catch (e) { setMsg((e as Error).message); }
  };
  const voidOne = async (id: string) => {
    if (!confirm('Take this order off the passport?')) return;
    try { await api(`/courses/${courseId}/teehouse/charges/${id}/void`, { method: 'POST', body: { reason: 'Taken off at the counter' } }); await reload(); } catch (e) { setMsg((e as Error).message); }
  };
  const due = paying === 'all' ? data.balance : data.players.find((p) => p.n === paying)?.balance ?? 0;
  const others = (n: number) => data.players.filter((p) => p.n !== n).map((p) => ({ value: String(p.n), label: `Move to ${p.name || `player ${p.n}`}` }));
  return (
    <div className="fore-passports">
      <div className="fore-pp-head">
        <b>Passports</b>
        <span className={data.settled ? 'fore-ok' : 'muted small'}>{data.settled ? 'All settled' : `${peso(data.balance)} to settle of ${peso(data.total)}`}</span>
        <Btn size="sm" onClick={() => printPassports(b, data, setup, courseName)}>Print passports</Btn>
      </div>
      {data.players.map((p) => (
        <div key={p.n} className={`fore-pp${p.balance <= 0 ? ' settled' : ''}`}>
          <div className="fore-pp-top"><span className="fore-wait-n">{p.n}</span><span className="grow"><b>{p.name || `Player ${p.n}`}</b><small>{[p.type, p.mobile].filter(Boolean).join(', ')}</small></span>
            <span className="fore-pp-bal">{p.balance <= 0 ? <em>Settled</em> : <><small>To pay</small><b>{peso(p.balance)}</b></>}</span></div>
          <dl className="fore-pp-lines">
            {p.lines.map((l, i) => (
              <div key={`l${i}`}><dt>{l.label}{l.unit && !readOnly && !data.settled && data.players.length > 1 ? <select className="fore-pp-move" aria-label={`Move ${l.label}`} value="" onChange={(e) => void move(l.unit!, Number(e.target.value))}><option value="">Move…</option>{others(p.n).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : null}</dt><dd>{peso(l.amount)}</dd></div>
            ))}
            {p.charges.map((c) => (
              <div key={c.id} className="fb"><dt>{c.qty > 1 ? `${c.qty} × ` : ''}{c.label}<small>{c.teeHouse}, {new Date(c.at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</small>{!readOnly && !data.settled ? <button className="fore-remove" onClick={() => void voidOne(c.id)}>Remove</button> : null}</dt><dd>{peso(c.amount)}</dd></div>
            ))}
            <div className="tot"><dt>Total{p.paid ? <small>{peso(p.paid)} paid</small> : null}</dt><dd>{peso(p.total)}</dd></div>
          </dl>
          {readOnly || data.settled ? null : adding === p.n ? <AddOrder courseId={courseId} b={b} player={p} onDone={() => { setAdding(null); void reload(); }} onBack={() => setAdding(null)} /> : (
            <div className="row wrap">
              {p.balance > 0 ? <Btn size="sm" kind={paying === p.n ? 'primary' : undefined} onClick={() => setPaying(paying === p.n ? null : p.n)}>Settle {p.name ? p.name.split(' ')[0] : `player ${p.n}`}</Btn> : null}
              <Btn size="sm" kind="ghost" onClick={() => setAdding(p.n)}>Add an order</Btn>
            </div>
          )}
        </div>
      ))}
      {readOnly || data.settled ? null : (
        <div className="fore-pp-settle">
          {paying === null ? <Btn kind="primary" onClick={() => setPaying('all')}>Settle the whole group · {peso(data.balance)}</Btn> : (
            <>
              <b>{paying === 'all' ? 'Settle the whole group' : `Settle ${data.players.find((p) => p.n === paying)?.name || `player ${paying}`}`}: {peso(due)}</b>
              <Seg value={method} onChange={setMethod} options={METHODS} />
              {method !== 'cash' ? <Field label="Reference number" value={ref} onChange={setRef} placeholder="From the receipt or app" /> : null}
              <div className="row"><Btn kind="primary" disabled={busy} onClick={() => void settle()}>{busy ? 'Saving…' : `Record ${METHODS.find((m) => m.value === method)?.label.toLowerCase()} payment`}</Btn><Btn kind="ghost" onClick={() => setPaying(null)}>Back</Btn></div>
            </>
          )}
        </div>
      )}
      {msg ? <p className="fore-error">{msg}</p> : null}
    </div>
  );
}

/** An order typed in at the counter (from a paper passport, or something sold at the counter). */
function AddOrder({ courseId, b, player, onDone, onBack }: { courseId: string; b: StaffBooking; player: Passport; onDone: () => void; onBack: () => void }) {
  const [houses, setHouses] = useState<TeeHouseLite[]>([]);
  const [house, setHouse] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [qty, setQty] = useState('1');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { void api<{ teeHouses: TeeHouseLite[] }>(`/courses/${courseId}/teehouse`).then((r) => { setHouses(r.teeHouses); setHouse(r.teeHouses[0]?.id ?? ''); }).catch(() => { /* counter only */ }); }, [courseId]);
  const menu = houses.find((h) => h.id === house)?.items ?? [];
  const add = async (item?: { id: string }) => {
    setMsg(null);
    try {
      const n = Math.max(1, Number(qty) || 1);
      const it = item ? { itemId: item.id, qty: n } : { label, unit: Math.round(Number(amount.replace(/[₱,\s]/g, '')) * 100), qty: n };
      await api(`/courses/${courseId}/teehouse/charges`, { method: 'POST', body: { clientId: newClientId(), teeHouseId: house || null, bookingId: b.id, playerN: player.n, items: [it] } });
      onDone();
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="fore-subform">
      <b>Add an order for {player.name || `player ${player.n}`}</b>
      <div className="grid fore-2">
        <Select label="From" value={house} onChange={setHouse} options={[...houses.map((h) => ({ value: h.id, label: h.name })), { value: '', label: 'The counter (the club)' }]} />
        <Field label="Quantity" inputMode="numeric" value={qty} onChange={setQty} sm />
      </div>
      {menu.length ? <div className="fore-times">{menu.map((m) => <button key={m.id} onClick={() => void add(m)}><b>{m.name}</b><span>{peso(m.price)}</span></button>)}</div> : null}
      <div className="grid fore-2">
        <Field label="Or type the item" value={label} onChange={setLabel} placeholder="e.g. Halo-halo" />
        <Field label="Price (₱)" inputMode="decimal" value={amount} onChange={setAmount} />
      </div>
      {msg ? <p className="fore-error">{msg}</p> : null}
      <div className="row"><Btn kind="primary" disabled={!label.trim() || !amount} onClick={() => void add()}>Add to passport</Btn><Btn kind="ghost" onClick={onBack}>Back</Btn></div>
    </div>
  );
}

/**
 * Prints one passport per player (A6, four to a page): who, when, their charges, a QR code the tee houses
 * scan, and blank rows for orders written by hand if a phone isn't at hand.
 */
export async function printPassports(b: StaffBooking, data: PassportsData, setup: CourseSetup, courseName: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  const cards = await Promise.all(data.players.map(async (p) => {
    const qr = await QRCode.toString(`MAISONFORE-P:${b.ref}-${p.n}`, { type: 'svg', margin: 0 });
    const lines = p.lines.map((l) => `<tr><td>${esc(l.label)}</td><td>${peso(l.amount)}</td></tr>`).join('');
    const blank = Array.from({ length: 6 }, () => '<tr class="blank"><td></td><td></td><td></td></tr>').join('');
    return `<section class="pp"><header><div><small>${esc(courseName)}</small><h1>${esc(p.name || `Player ${p.n}`)}</h1><p>${esc(formatDay(b.day))}, ${b.time >= 0 ? formatTime(b.time) : 'no set time'}${b.startTee !== '1' ? `, tee ${esc(b.startTee)}` : ''}</p>
      <p>Player ${p.n} of ${data.players.length}, ${esc(b.ref)}${p.mobile ? `, ${esc(p.mobile)}` : ''}</p></div><div class="qr">${qr}</div></header>
      <table>${lines}<tr class="tot"><td>Course charges</td><td>${peso(p.lines.reduce((s, l) => s + l.amount, 0))}</td></tr></table>
      <h2>Tee house orders</h2><table class="orders"><tr><th>Item</th><th>Amount</th><th>Initials</th></tr>${blank}</table>
      <footer>Settle at the counter after your round. Caddie fees are paid separately.</footer></section>`;
  }));
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { alert('Allow pop-ups for this site to print the passports.'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Passports ${esc(b.ref)}</title><style>
    @page { size: A4; margin: 10mm; } body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #15241d; margin: 0; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
    .pp { border: 1.5px solid #1f3b33; border-radius: 4mm; padding: 5mm; break-inside: avoid; font-size: 10pt; }
    header { display: flex; justify-content: space-between; gap: 4mm; } h1 { font-size: 15pt; margin: 1mm 0; } header p { margin: 0; color: #4d5e55; } small { color: #b08d57; font-weight: 700; }
    .qr { width: 26mm; height: 26mm; flex: none; } .qr svg { width: 100%; height: 100%; }
    table { width: 100%; border-collapse: collapse; margin-top: 3mm; } td, th { padding: 1.2mm 0; border-bottom: 0.3mm solid #dfe6e0; text-align: left; } td:last-child, th:nth-child(2) { text-align: right; }
    .orders td, .orders th { text-align: left; } .orders th:nth-child(2) { width: 22mm; } .orders th:nth-child(3) { width: 16mm; } .blank td { height: 6mm; }
    .tot td { font-weight: 700; border-bottom: 0.5mm solid #15241d; } h2 { font-size: 10pt; margin: 4mm 0 0; } footer { margin-top: 3mm; font-size: 8.5pt; color: #4d5e55; }
  </style></head><body><div class="grid">${cards.join('')}</div><script>window.onload = () => { window.print(); };</script></body></html>`);
  w.document.close();
  void setup;
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Btn } from '@maison/core/ui/kit';
import { formatTime, peso } from '@maison/engine';
import { api, ApiError } from '../api';

interface Item { id: string; name: string; price: number }
interface House { id: string; name: string; items: Item[] }
interface Group { id: string; ref: string; time: number; startTee: string; contactName: string; players: { n: number; name: string }[] }
interface Order { id: string; bookingId: string; ref: string; playerN: number; player: string; label: string; qty: number; amount: number; teeHouseId: string | null; at: number; voided: boolean }
interface DayData { today: string; role: string; teeHouseId: string | null; teeHouses: House[]; courseName: string; onCourse: Group[]; orders: Order[] }
interface Line { itemId?: string; label: string; unit: number; qty: number }
interface Queued { clientId: string; teeHouseId: string | null; bookingId: string; ref: string; playerN: number; player: string; items: Line[]; at: number; problem?: string }

const read = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: works while open */ } };
const newId = () => `th-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const total = (items: Line[]) => items.reduce((s, l) => s + l.unit * l.qty, 0);

/**
 * The tee house screen, for the phone at a tee house: find the group (scan a passport's QR code, or pick
 * from who's on the course), pick the player, tap what they ordered, charge it to their passport. Orders
 * are kept on the phone and sent when there's signal, so a weak connection on the course never loses one.
 */
export function TeeHouseScreen({ courseId, signOut }: { courseId: string; signOut?: () => void }) {
  const cacheKey = `fore.th.day.${courseId}`, queueKey = `fore.th.queue.${courseId}`;
  const [data, setData] = useState<DayData | null>(() => read<DayData | null>(cacheKey, null));
  const [queue, setQueue] = useState<Queued[]>(() => read<Queued[]>(queueKey, []));
  const [online, setOnline] = useState(navigator.onLine);
  const [houseId, setHouseId] = useState<string | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [player, setPlayer] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [other, setOther] = useState({ label: '', price: '' });
  const [q, setQ] = useState('');
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const sending = useRef(false);

  const load = useCallback(async () => {
    try { const d = await api<DayData>(`/courses/${courseId}/teehouse`); setData(d); write(cacheKey, d); setOnline(true); setProblem(null); }
    catch (e) { if (e instanceof ApiError && e.status === 0) setOnline(false); else setProblem((e as Error).message); }
  }, [courseId, cacheKey]);

  /** Sends waiting orders in order; keeps them on the phone while there's no signal. */
  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      let list = read<Queued[]>(queueKey, []);
      for (const o of list.filter((x) => !x.problem)) {
        try {
          await api(`/courses/${courseId}/teehouse/charges`, { method: 'POST', body: { clientId: o.clientId, teeHouseId: o.teeHouseId, bookingId: o.bookingId, playerN: o.playerN, at: o.at,
            items: o.items.map((l) => (l.itemId ? { itemId: l.itemId, qty: l.qty } : { label: l.label, unit: l.unit, qty: l.qty })) } });
          list = list.filter((x) => x.clientId !== o.clientId);
          setOnline(true);
        } catch (e) {
          const err = e as ApiError;
          if (err.status === 0 || err.status >= 500) { setOnline(false); break; } // no signal: try again later
          list = list.map((x) => (x.clientId === o.clientId ? { ...x, problem: err.message } : x)); // refused: show why
        }
        write(queueKey, list); setQueue(list);
      }
      write(queueKey, list); setQueue(list);
    } finally { sending.current = false; }
    void load();
  }, [courseId, queueKey, load]);

  useEffect(() => {
    void load(); void flush();
    const t = setInterval(() => { void flush(); }, 15_000);
    const on = () => { setOnline(true); void flush(); };
    const off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { clearInterval(t); removeEventListener('online', on); removeEventListener('offline', off); };
  }, [load, flush]);

  const houses = data?.teeHouses ?? [];
  const house = houses.find((h) => h.id === (data?.teeHouseId ?? houseId)) ?? (data?.teeHouseId ? undefined : houses.length === 1 ? houses[0] : undefined);
  const groups = useMemo(() => (data?.onCourse ?? []).filter((g) => !q.trim() || `${g.ref} ${g.contactName} ${g.players.map((p) => p.name).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())), [data, q]);

  const pickCode = (text: string) => {
    const m = /^MAISONFORE(?:-P)?:([A-Z0-9]+)(?:-(\d))?$/i.exec(text.trim());
    const g = m ? data?.onCourse.find((x) => x.ref.toUpperCase() === m[1].toUpperCase()) : undefined;
    if (!g) { setToast(m ? 'That group isn’t registered on the course today.' : 'That isn’t a MaisonFore passport.'); return; }
    setGroup(g); setPlayer(m![2] ? Number(m![2]) : g.players.length === 1 ? 1 : null); setLines([]); setScanning(false);
  };
  const addItem = (it: Item) => setLines((ls) => { const i = ls.findIndex((l) => l.itemId === it.id); return i < 0 ? [...ls, { itemId: it.id, label: it.name, unit: it.price, qty: 1 }] : ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l)); });
  const addOther = () => {
    const unit = Math.round(Number(other.price.replace(/[₱,\s]/g, '')) * 100);
    if (!other.label.trim() || !(unit >= 0)) return;
    setLines([...lines, { label: other.label.trim(), unit, qty: 1 }]); setOther({ label: '', price: '' });
  };
  const charge = () => {
    if (!group || !player || !lines.length) return;
    const who = group.players.find((p) => p.n === player)?.name ?? `Player ${player}`;
    const o: Queued = { clientId: newId(), teeHouseId: house?.id ?? null, bookingId: group.id, ref: group.ref, playerN: player, player: who, items: lines, at: Date.now() };
    const list = [...read<Queued[]>(queueKey, []), o];
    write(queueKey, list); setQueue(list);
    setToast(`${peso(total(lines))} charged to ${who}’s passport${online ? '' : '. Saved on this phone; it sends when there’s signal'}.`);
    setGroup(null); setPlayer(null); setLines([]); setQ('');
    void flush();
  };
  const voidOrder = async (o: Order) => {
    if (!confirm(`Take ${o.label} off ${o.player}’s passport?`)) return;
    try { await api(`/courses/${courseId}/teehouse/charges/${o.id}/void`, { method: 'POST', body: { reason: 'Taken off by the tee house' } }); void load(); }
    catch (e) { setToast((e as Error).message); }
  };
  const dropQueued = (o: Queued) => { const list = read<Queued[]>(queueKey, []).filter((x) => x.clientId !== o.clientId); write(queueKey, list); setQueue(list); };
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);

  if (!data) return <div className="center muted">{online ? 'Loading…' : 'No signal. Open this screen once with signal to start.'}</div>;
  const waiting = queue.filter((x) => !x.problem), refused = queue.filter((x) => x.problem);
  return (
    <div className="fore-th">
      <header className="fore-th-head">
        <div><small>{data.courseName}</small><h1>{house?.name ?? 'Tee house'}</h1></div>
        <span className={`fore-th-sync${!online ? ' off' : waiting.length ? ' wait' : ''}`}>{!online ? `No signal${waiting.length ? `: ${waiting.length} waiting` : ''}` : waiting.length ? `Sending ${waiting.length}…` : 'All sent'}</span>
        {signOut ? <button className="fore-link" onClick={signOut}>Sign out</button> : null}
      </header>
      {!data.teeHouseId && houses.length > 1 ? (
        <div className="fore-th-houses">{houses.map((h) => <button key={h.id} className={house?.id === h.id ? 'on' : ''} onClick={() => setHouseId(h.id)}>{h.name}</button>)}</div>
      ) : null}
      {problem ? <p className="fore-error">{problem}</p> : null}
      {refused.map((o) => (
        <div key={o.clientId} className="fore-alert crit"><p><b>Not added: {o.player}, {peso(total(o.items))}.</b> {o.problem}</p><button onClick={() => dropQueued(o)}>OK</button></div>
      ))}

      {!group ? (
        <>
          <Btn kind="primary" onClick={() => setScanning(true)}>Scan a passport</Btn>
          <input className="input fore-th-search" placeholder="Or search: name or booking code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search groups" />
          <ul className="fore-th-groups">
            {groups.map((g) => (
              <li key={g.id}><button onClick={() => { setGroup(g); setPlayer(g.players.length === 1 ? 1 : null); }}>
                <span className="tm">{formatTime(g.time)}</span><span className="grow"><b>{g.players.map((p) => p.name).join(', ')}</b><small>{g.ref}{g.startTee !== '1' ? `, tee ${g.startTee}` : ''}</small></span>
              </button></li>
            ))}
            {!groups.length ? <li className="muted small">{data.onCourse.length ? 'No group matches.' : 'Nobody has registered yet today.'}</li> : null}
          </ul>
        </>
      ) : (
        <div className="fore-th-order">
          <div className="fore-th-group"><span><small>{formatTime(group.time)}, {group.ref}</small><b>Who ordered?</b></span><button className="fore-link" onClick={() => { setGroup(null); setPlayer(null); setLines([]); }}>Change group</button></div>
          <div className="fore-th-players">{group.players.map((p) => <button key={p.n} className={player === p.n ? 'on' : ''} onClick={() => setPlayer(p.n)}>{p.name}</button>)}</div>
          {player ? (
            <>
              <div className="fore-th-menu">{(house?.items ?? []).map((it) => {
                const n = lines.find((l) => l.itemId === it.id)?.qty ?? 0;
                return <button key={it.id} className={n ? 'on' : ''} onClick={() => addItem(it)}><b>{it.name}</b><span>{peso(it.price)}</span>{n ? <i>{n}</i> : null}</button>;
              })}</div>
              <div className="fore-th-other">
                <input className="input" placeholder="Other item" value={other.label} onChange={(e) => setOther({ ...other, label: e.target.value })} aria-label="Other item" />
                <input className="input" placeholder="₱" inputMode="decimal" value={other.price} onChange={(e) => setOther({ ...other, price: e.target.value })} aria-label="Price" />
                <Btn onClick={addOther} disabled={!other.label.trim() || !other.price}>Add</Btn>
              </div>
              {lines.length ? (
                <ul className="fore-th-lines">
                  {lines.map((l, i) => <li key={i}><span>{l.qty} × {l.label}</span><b>{peso(l.unit * l.qty)}</b><button aria-label={`Remove ${l.label}`} onClick={() => setLines(lines.flatMap((x, j) => (j !== i ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : [])))}>−</button></li>)}
                </ul>
              ) : null}
              <Btn kind="primary" disabled={!lines.length} onClick={charge}>{lines.length ? `Charge ${peso(total(lines))} to ${group.players.find((p) => p.n === player)?.name}` : 'Tap what they ordered'}</Btn>
            </>
          ) : null}
        </div>
      )}

      <section className="fore-th-today">
        <h2>Today’s orders</h2>
        <ul>
          {waiting.map((o) => <li key={o.clientId} className="wait"><span><b>{o.player}</b><small>{o.items.map((l) => `${l.qty} × ${l.label}`).join(', ')}</small></span><b>{peso(total(o.items))}</b><em>Waiting to send</em></li>)}
          {data.orders.filter((o) => o.at >= Date.now() - 18 * 3_600_000).map((o) => (
            <li key={o.id} className={o.voided ? 'void' : ''}><span><b>{o.player}</b><small>{o.qty > 1 ? `${o.qty} × ` : ''}{o.label}, {new Date(o.at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</small></span><b>{peso(o.amount)}</b>
              {o.voided ? <em>Removed</em> : <button className="fore-remove" onClick={() => void voidOrder(o)}>Remove</button>}</li>
          ))}
          {!waiting.length && !data.orders.length ? <li className="muted small">No orders yet today.</li> : null}
        </ul>
        <p className="muted small">Day total: <b>{peso(data.orders.filter((o) => !o.voided).reduce((s, o) => s + o.amount, 0) + waiting.reduce((s, o) => s + total(o.items), 0))}</b></p>
      </section>
      {toast ? <div className="fore-th-toast" role="status">{toast}</div> : null}
      {scanning ? <Scanner onCode={pickCode} onClose={() => setScanning(false)} /> : null}
    </div>
  );
}

/** Reads a passport's QR code with the phone's camera. */
function Scanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState('Point the camera at the QR code on the passport.');
  useEffect(() => {
    let stream: MediaStream | null = null, stop = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current) return;
        video.current.srcObject = stream; await video.current.play();
        const tick = () => {
          if (stop || !video.current || !ctx) return;
          const v = video.current;
          if (v.videoWidth) {
            canvas.width = v.videoWidth; canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (found?.data) { onCode(found.data); return; }
          }
          setTimeout(tick, 200);
        };
        tick();
      } catch { setMsg('The camera isn’t available. Allow camera access for this site, or search by name instead.'); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);
  return (
    <div className="fore-th-scan" role="dialog" aria-label="Scan a passport">
      <video ref={video} playsInline muted />
      <p>{msg}</p>
      <Btn onClick={onClose}>Cancel</Btn>
    </div>
  );
}

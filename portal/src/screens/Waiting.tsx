import { useCallback, useEffect, useState } from 'react';
import { Btn, Field, Sheet, Stepper } from '@maison/core/ui/kit';
import { formatTime, localParts } from '@maison/engine';
import { api, type StaffSlot } from '../api';

export interface WaitingEntry {
  id: string; kind: 'app' | 'standby'; contactName: string; mobile: string; notes: string; players: number; from: number; to: number;
  layoutId: string | null; status: 'waiting' | 'offered'; since: number; offer: { time: number; startTee: string; until: number | null } | null;
}

const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const range = (w: Pick<WaitingEntry, 'from' | 'to'>) => (w.from <= 0 && w.to >= 24 * 60 - 1 ? 'Any time' : `${formatTime(w.from)} to ${formatTime(w.to)}`);

/** Everyone waiting on a day, reloaded whenever the tee sheet changes. */
export function useWaiting(courseId: string, day: string, seq: number | undefined) {
  const [list, setList] = useState<WaitingEntry[]>([]);
  const load = useCallback(() => api<WaitingEntry[]>(`/courses/${courseId}/waiting?day=${day}`).then(setList).catch(() => { /* the sheet shows problems */ }), [courseId, day]);
  useEffect(() => { void load(); }, [load, seq]);
  return { list, reload: load };
}

/**
 * Who's waiting for a time: the counter's standby list (staff add groups, then seat them in a time that
 * fits) and golfers on the app waitlist (offered times open up to them automatically, in order).
 */
export function Waiting({ courseId, day, today, list, slots, timeZone, readOnly, onSeat, onClose, onChanged }: {
  courseId: string; day: string; today: string; list: WaitingEntry[]; slots: StaffSlot[]; timeZone: string; readOnly?: boolean;
  onSeat: (cell: StaffSlot, w: WaitingEntry) => void; onClose: () => void; onChanged: () => void;
}) {
  const [f, setF] = useState({ contactName: '', mobile: '', notes: '', from: '', to: '' });
  const [players, setPlayers] = useState(4);
  const [seating, setSeating] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const standby = list.filter((w) => w.kind === 'standby');
  const app = list.filter((w) => w.kind === 'app');
  const clockAt = (ms: number) => formatTime(localParts(ms, timeZone).minutes);
  const nowMin = day === today ? localParts(Date.now(), timeZone).minutes : -1;
  const fitting = (w: WaitingEntry) => slots.filter((s) => s.state !== 'past' && s.state !== 'closed' && s.free >= w.players && s.time >= w.from && s.time <= w.to
    && s.time > nowMin && (!w.layoutId || s.layoutId === w.layoutId));

  const add = async () => {
    setBusy(true); setMsg(null);
    try {
      await api(`/courses/${courseId}/standby`, { method: 'POST', body: { day, players, contactName: f.contactName, mobile: f.mobile, notes: f.notes, from: f.from ? toMin(f.from) : '', to: f.to ? toMin(f.to) : '' } });
      setF({ contactName: '', mobile: '', notes: '', from: '', to: '' }); setPlayers(4); onChanged();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (w: WaitingEntry) => {
    if (w.kind === 'app' && !confirm(`Take ${w.contactName} off the app waitlist? They’ll be told in the app.`)) return;
    try { await api(`/courses/${courseId}/waiting/${w.id}`, { method: 'DELETE' }); onChanged(); } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <Sheet open title="Waiting for a tee time" eyebrow={day === today ? 'Today' : day} onClose={onClose} width={620}>
      <p className="muted small">Groups at the counter wait on the standby list until you seat them. Golfers on the app waitlist are offered times automatically, in the order they joined.</p>

      <div className="fore-bk-group">
        <div className="fore-bk-head"><b>Counter standby list</b><span className="muted small">{standby.length ? `${standby.length} waiting` : 'Nobody waiting'}</span></div>
        {standby.map((w, i) => {
          const open = fitting(w);
          return (
            <div key={w.id} className="fore-wait">
              <div className="fore-wait-row">
                <span className="fore-wait-n">{i + 1}</span>
                <span className="grow"><b>{w.contactName}</b><small>{w.players} {w.players === 1 ? 'player' : 'players'}, {range(w).toLowerCase()}{w.mobile ? `, ${w.mobile}` : ''}{w.notes ? `. ${w.notes}` : ''}</small><small>Waiting since {clockAt(w.since)}</small></span>
                {readOnly ? null : <>
                  <Btn size="sm" kind={open.length ? 'primary' : undefined} disabled={!open.length} onClick={() => setSeating(seating === w.id ? null : w.id)}>{open.length ? `Seat (${open.length} open)` : 'No time fits yet'}</Btn>
                  <button className="fore-remove" onClick={() => void remove(w)}>Remove</button>
                </>}
              </div>
              {seating === w.id ? (
                <div className="fore-times" role="listbox" aria-label={`Open times for ${w.contactName}`}>
                  {open.map((s) => <button key={`${s.layoutId}-${s.startTee}-${s.time}`} role="option" aria-selected={false} onClick={() => onSeat(s, w)}><b>{formatTime(s.time)}</b><span>Tee {s.startTee}, {s.free} free</span></button>)}
                </div>
              ) : null}
            </div>
          );
        })}
        {readOnly ? null : (
          <div className="fore-wait-add">
            <div className="grid fore-2">
              <Field label="Name" value={f.contactName} onChange={(v) => setF({ ...f, contactName: v })} placeholder="Who’s waiting" />
              <Field label="Mobile" type="tel" value={f.mobile} onChange={(v) => setF({ ...f, mobile: v })} placeholder="To call them back" />
            </div>
            <div className="fore-wait-line">
              <span><b>Players</b></span><Stepper value={players} onChange={setPlayers} min={1} max={5} />
              <Field label="Earliest (optional)" type="time" value={f.from} onChange={(v) => setF({ ...f, from: v })} sm />
              <Field label="Latest (optional)" type="time" value={f.to} onChange={(v) => setF({ ...f, to: v })} sm />
            </div>
            <Field label="Note" value={f.notes} onChange={(v) => setF({ ...f, notes: v })} placeholder="e.g. at the café, needs carts" />
            <Btn kind="primary" disabled={busy || !f.contactName.trim()} onClick={() => void add()}>Add to standby list</Btn>
          </div>
        )}
      </div>

      <div className="fore-bk-group">
        <div className="fore-bk-head"><b>App waitlist</b><span className="muted small">{app.length ? `${app.length} waiting` : 'Nobody waiting'}</span></div>
        {app.map((w, i) => (
          <div key={w.id} className="fore-wait-row">
            <span className="fore-wait-n">{i + 1}</span>
            <span className="grow"><b>{w.contactName}</b><small>{w.players} {w.players === 1 ? 'player' : 'players'}, {range(w).toLowerCase()}{w.mobile ? `, ${w.mobile}` : ''}</small>
              {w.offer ? <small className="fore-wait-offer">Offered {formatTime(w.offer.time)}{w.offer.startTee !== '1' ? ` (tee ${w.offer.startTee})` : ''} until {w.offer.until ? clockAt(w.offer.until) : '—'}</small> : <small>Joined at {clockAt(w.since)}</small>}</span>
            {readOnly ? null : <button className="fore-remove" onClick={() => void remove(w)}>Remove</button>}
          </div>
        ))}
        {!app.length ? <p className="muted small">Golfers join from the app when the times they want are full. When a time opens, the first in line is offered it.</p> : null}
      </div>
      {msg ? <p className="fore-error">{msg}</p> : null}
    </Sheet>
  );
}

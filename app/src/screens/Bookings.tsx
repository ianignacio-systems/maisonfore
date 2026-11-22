import { useCallback, useEffect, useState } from 'react';
import { counterSplit, formatDay, localParts, peso, weekday } from '@maison/engine';
import { api, teeFor, teeTimes, type MyBooking, type Times, type WaitEntry } from '../api';
import { Button, clock, Days, go, Pass, PriceList, Sheet, SHORT, shortDay } from '../ui';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** My bookings at every course: coming up first (with the QR code to show at the counter), then past ones. */
export function Bookings() {
  const [list, setList] = useState<MyBooking[] | null>(null);
  const [open, setOpen] = useState<MyBooking | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [waits, setWaits] = useState<WaitEntry[]>([]);
  const load = useCallback(() => Promise.all([
    api<MyBooking[]>('/bookings').then((r) => { setList(r); setProblem(null); }),
    api<WaitEntry[]>('/waitlist').then(setWaits),
  ]).catch((e) => setProblem((e as Error).message)), []);
  // Offers come and go by the minute: check again every half minute while this screen is open.
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30_000); return () => clearInterval(t); }, [load]);
  const leave = async (w: WaitEntry) => { try { await api(`/waitlist/${w.id}/leave`, { method: 'POST' }); void load(); } catch (e) { setProblem((e as Error).message); } };
  const upcoming = list?.filter((b) => b.upcoming) ?? [];
  const past = list?.filter((b) => !b.upcoming) ?? [];

  return (
    <div className="pl-page">
      <header className="pl-head"><p className="pl-kicker">Your rounds</p><h1>Bookings</h1></header>
      {problem ? <p className="pl-err">{problem}</p> : null}
      {waits.length ? (
        <>
          <h2 className="pl-section">Waitlist</h2>
          <ul className="pl-waits">
            {waits.map((w) => (
              <li key={w.id} className={`pl-wait s-${w.status}`}>
                {w.offer ? (
                  <>
                    <span className="pl-wait-top"><b>{clock(w.offer.time)} opened up for you</b><Countdown until={w.offer.until} /></span>
                    <span className="pl-muted">{w.course.name}, {shortDay(w.day)}, {w.offer.free} {w.offer.free === 1 ? 'player' : 'players'}. It’s held for you; if you don’t book it, it goes to the next golfer.</span>
                    <span className="pl-actions"><Button onClick={() => go(`/c/${w.course.slug}?day=${w.day}&offer=${w.id}`)}>Book it</Button><Button kind="quiet" onClick={() => void leave(w)}>No thanks</Button></span>
                  </>
                ) : (
                  <>
                    <span className="pl-wait-top"><b>{w.course.name}</b><span className="pl-wait-tag">{w.status === 'missed' ? 'Offer passed' : 'Waiting'}</span></span>
                    <span className="pl-muted">{shortDay(w.day)}, {clock(w.from)} to {clock(w.to)}, {w.players} {w.players === 1 ? 'player' : 'players'}</span>
                    {w.status === 'missed' ? <span className="pl-muted small">You didn’t book the time offered in time, so it went to the next golfer.</span> : null}
                    <span className="pl-actions"><Button kind="quiet" onClick={() => void leave(w)}>{w.status === 'missed' ? 'Clear' : 'Leave the waitlist'}</Button></span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {!list ? <p className="pl-muted pl-pad">Loading…</p> : !list.length ? (
        waits.length ? null : <div className="pl-empty"><b>No bookings yet</b><p>Find a course and book your first tee time.</p><Button onClick={() => go('/')}>Find a course</Button></div>
      ) : (
        <>
          {upcoming.length ? <h2 className="pl-section">Coming up</h2> : null}
          <ul className="pl-tickets">
            {upcoming.map((b) => (
              <li key={b.id}>
                <button className="pl-ticket" onClick={() => setOpen(b)}>
                  <span className="stub"><small>{SHORT[weekday(b.day)]}</small><b>{Number(b.day.slice(8))}</b><small>{MON[Number(b.day.slice(5, 7)) - 1]}</small></span>
                  <span className="what"><span className="tm">{clock(b.time)}</span><b>{b.course.name}</b><small>{b.players} {b.players === 1 ? 'player' : 'players'}, {b.holes} holes{b.layoutName ? `, ${b.layoutName}` : ''}</small>
                    {b.lapsed ? <small className="pl-lapsed">Not paid in time: open to others</small> : b.payBy ? <small className="pl-due">Pay by {b.payBy}{b.payByDay !== b.day && b.payByDay ? `, ${shortDay(b.payByDay)}` : ''}</small> : null}</span>
                  <span className="ref">{b.ref}</span>
                </button>
              </li>
            ))}
          </ul>
          {past.length ? <h2 className="pl-section">Past and cancelled</h2> : null}
          <ul className="pl-tickets past">
            {past.map((b) => (
              <li key={b.id}>
                <button className="pl-ticket" onClick={() => setOpen(b)}>
                  <span className="stub"><small>{SHORT[weekday(b.day)]}</small><b>{Number(b.day.slice(8))}</b><small>{MON[Number(b.day.slice(5, 7)) - 1]}</small></span>
                  <span className="what"><span className="tm">{clock(b.time)}</span><b>{b.course.name}</b><small>{b.statusWords}</small></span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {open ? <Ticket b={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); void load(); }} /> : null}
    </div>
  );
}

function Ticket({ b, onClose, onChanged }: { b: MyBooking; onClose: () => void; onChanged: () => void }) {
  const [mode, setMode] = useState<'view' | 'move' | 'cancel'>('view');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    setBusy(true); setMsg(null);
    try { await api(`/bookings/${b.id}/cancel`, { method: 'POST', body: {} }); onChanged(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={b.upcoming ? 'Your booking' : b.course.name} sub={b.upcoming ? undefined : `${formatDay(b.day)}, ${clock(b.time)}`} onClose={onClose}>
      {b.upcoming && mode === 'view' ? (
        <Pass code={b.ref} course={b.course.name} when={`${shortDay(b.day)}, ${clock(b.time)}`}
          detail={`${b.players} ${b.players === 1 ? 'player' : 'players'}, ${b.holes} holes${b.startTee !== '1' ? `, from tee ${b.startTee}` : ''}`} />
      ) : null}
      {b.upcoming && mode === 'view' && b.lapsed ? (
        <p className="pl-lapsed-box"><b>Not paid in time.</b> Your tee time is open to other golfers now. If it’s still free when you arrive, pay at the counter to keep it.</p>
      ) : b.upcoming && mode === 'view' && b.payBy ? (
        <p className="pl-payby"><b>Arrive and pay {peso(counterSplit(b.quote, true).total)} by {b.payBy}{b.payByDay !== b.day && b.payByDay ? `, ${shortDay(b.payByDay)}` : ''}.</b> After that your tee time opens to other golfers.</p>
      ) : !(b.upcoming && mode === 'view') ? <p className={`pl-status s-${b.status}`}>{b.statusWords}</p> : null}
      {mode === 'view' ? (
        <>
          <dl className="pl-facts">
            <div><dt>Players</dt><dd>{b.players}, {b.holes} holes</dd></div>
            {b.carts || b.caddies || b.gallery ? <div><dt>With</dt><dd>{[b.carts ? `${b.carts} ${b.carts === 1 ? 'cart' : 'carts'}` : '', b.caddies ? `${b.caddies} ${b.caddies === 1 ? 'caddie' : 'caddies'}` : '', b.gallery ? `${b.gallery} gallery` : ''].filter(Boolean).join(', ')}</dd></div> : null}
            {b.layoutName || b.startTee !== '1' ? <div><dt>Starts</dt><dd>{[b.layoutName, b.startTee !== '1' ? `tee ${b.startTee}` : ''].filter(Boolean).join(', ')}</dd></div> : null}
            <div><dt>Payment</dt><dd>{b.payStatus === 'unpaid' ? `Pay ${peso(counterSplit(b.quote, true).total)} at the course` : 'Paid'}</dd></div>
          </dl>
          <ol className="pl-roster">{b.roster.map((p, i) => <li key={i}><span>{p.name || `Player ${i + 1}`}</span><small>{p.type}</small></li>)}</ol>
          <PriceList lines={b.quote} payWord={b.payStatus === 'unpaid' ? 'Pay at the course' : 'Total'} />
          {b.upcoming ? (b.canChange ? (
            <div className="pl-actions">
              <Button kind="line" onClick={() => setMode('move')}>Change time</Button>
              <Button kind="quiet" onClick={() => setMode('cancel')}>Cancel booking</Button>
            </div>
          ) : <p className="pl-muted small">Changes within {b.cutoffHours} hours of the tee time go through the course.{b.course.phone ? <> <a href={`tel:${b.course.phone.replace(/\s/g, '')}`}>Call {b.course.phone}</a></> : null}</p>) : null}
        </>
      ) : mode === 'cancel' ? (
        <div className="pl-confirm">
          <p>Cancel your tee time at <b>{clock(b.time)}</b> on <b>{formatDay(b.day)}</b>?</p>
          <div className="pl-actions"><Button kind="danger" disabled={busy} onClick={() => void cancel()}>Yes, cancel it</Button><Button kind="line" onClick={() => setMode('view')}>Keep it</Button></div>
        </div>
      ) : <MoveTime b={b} onBack={() => setMode('view')} onDone={onChanged} />}
      {msg ? <p className="pl-err">{msg}</p> : null}
    </Sheet>
  );
}

/** Pick another open time at the same course, for the same players. */
function MoveTime({ b, onBack, onDone }: { b: MyBooking; onBack: () => void; onDone: () => void }) {
  const today = localParts(Date.now(), 'Asia/Manila').day;
  const [day, setDay] = useState(b.day);
  const [times, setTimes] = useState<Times | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setTimes(null); api<Times>(`/courses/${b.course.slug}/times?day=${day}`).then(setTimes).catch((e) => setMsg((e as Error).message)); }, [b.course.slug, day]);
  const move = async (layoutId: string, startTee: string, time: number) => {
    setMsg(null);
    try { await api(`/bookings/${b.id}/move`, { method: 'POST', body: { layoutId, startTee, day, time } }); onDone(); } catch (e) { setMsg((e as Error).message); }
  };
  // Each time once, on the first tee with room for this group.
  const slots = (times?.layouts ?? []).flatMap((l) => teeTimes(l.slots, l.startTees).filter((t) => t.free >= b.players && !(day === b.day && t.time === b.time))
    .map((t) => ({ ...teeFor(t, b.players), free: t.free, layoutId: l.id, name: l.name, many: (times?.layouts.length ?? 1) > 1 })));
  return (
    <div className="pl-move">
      <p><b>Choose a new time</b> for {b.players} {b.players === 1 ? 'player' : 'players'}. The price may change with the day and time.</p>
      <Days from={today} count={14} value={day} onPick={setDay} />
      {!times ? <p className="pl-muted">Loading…</p> : times.notYet ? <p className="pl-muted">{times.notYet}</p> : !slots.length ? <p className="pl-muted">No times with room for {b.players} on this day.</p> : (
        <div className="pl-slots">
          {slots.map((s) => (
            <button key={`${s.layoutId}-${s.startTee}-${s.time}`} className="pl-slot" onClick={() => void move(s.layoutId, s.startTee, s.time)}>
              <b>{clock(s.time)}</b><span>{s.many ? s.name : `${s.free} ${s.free === 1 ? 'spot' : 'spots'}`}</span>
            </button>
          ))}
        </div>
      )}
      {msg ? <p className="pl-err">{msg}</p> : null}
      <Button kind="line" onClick={onBack}>Back</Button>
    </div>
  );
}

/** Minutes and seconds left on an offer. */
function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, until - now);
  const m = Math.floor(left / 60_000), sec = Math.floor((left % 60_000) / 1000);
  return <span className="pl-countdown" aria-label={`${m} minutes left`}>{left ? `${m}:${String(sec).padStart(2, '0')} left` : 'Ended'}</span>;
}

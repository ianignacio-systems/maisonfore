import { useEffect, useMemo, useState } from 'react';
import { holesOffered, minPlayers, peso, priceFor, quote, type CourseSetup, type PlayerType } from '@maison/engine';
import { api, teeFor, teeTimes, type CoursePage, type Me, type MyBooking, type TeeTime, type Times } from '../api';
import { Button, clock, CourseArt, DayPart, Days, go, Pass, PriceList, Sheet, shortDay, Spots, Stepper } from '../ui';

const PERIODS: ['Morning' | 'Midday' | 'Afternoon', number, number][] = [['Morning', 0, 720], ['Midday', 720, 900], ['Afternoon', 900, 1440]];

/** The player type a golfer books as by default: Local or Foreign, by what they told us. */
export function myType(setup: CourseSetup, me: Me): PlayerType | undefined {
  const want = me.profile?.residency === 'foreign' ? /foreign|non.?resident|tourist/i : /local|resident|filipino/i;
  return setup.playerTypes.find((t) => want.test(t.name)) ?? setup.playerTypes[0];
}

/** A course: its details, then its open tee slots by day; tap a time to book it. */
export function Course({ slug, me }: { slug: string; me: Me }) {
  const [page, setPage] = useState<CoursePage | null>(null);
  const [day, setDay] = useState(() => new URLSearchParams(location.search).get('day') ?? '');
  const [times, setTimes] = useState<Times | null>(null);
  const [layoutIx, setLayoutIx] = useState(0);
  const [booking, setBooking] = useState<{ slot: TeeTime; layoutId: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [n, setN] = useState(0);

  useEffect(() => { api<CoursePage>(`/courses/${slug}`).then((p) => { setPage(p); if (!day || day < p.window.today) setDay(p.window.today); }).catch((e) => setProblem((e as Error).message)); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!day) return;
    let live = true;
    setTimes(null);
    api<Times>(`/courses/${slug}/times?day=${day}`).then((t) => { if (live) setTimes(t); }).catch((e) => setProblem((e as Error).message));
    return () => { live = false; };
  }, [slug, day, n]);

  if (problem && !page) return <div className="pl-page"><button className="pl-back" onClick={() => go('/')}>‹ Courses</button><p className="pl-err">{problem}</p></div>;
  if (!page) return <div className="pl-page"><p className="pl-muted pl-pad">Loading…</p></div>;
  const c = page.course, s = page.setup;
  const mine = myType(s, me);
  const layouts = times?.layouts ?? [];
  const L = layouts[Math.min(layoutIx, Math.max(0, layouts.length - 1))];
  const all = L ? teeTimes(L.slots, L.startTees) : [];

  return (
    <div className="pl-course-page">
      <header className="pl-hero">
        <CourseArt seed={c.slug} className="pl-hero-art" />
        <button className="pl-round-back" aria-label="Back to courses" onClick={() => go('/')}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div className="pl-hero-text">
          <h1>{c.name}</h1>
          <p>{[c.address, c.city, c.province].filter(Boolean).join(', ')}</p>
        </div>
      </header>
      <div className="pl-page">
        <div className="pl-hero-links">
          {c.phone ? <a className="pl-pill-link" href={`tel:${c.phone.replace(/\s/g, '')}`}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>Call</a> : null}
          <a className="pl-pill-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.name} ${c.city} ${c.province}`)}`} target="_blank" rel="noreferrer"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>Directions</a>
        </div>
        {c.description ? <p className="pl-about">{c.description}</p> : null}
        {c.facilities.length ? <ul className="pl-chips">{c.facilities.map((f) => <li key={f}>{f}</li>)}</ul> : null}

        <h2 className="pl-section">Tee slots</h2>
        <Days from={page.window.today} count={14} value={day} onPick={setDay} lastBookable={page.window.lastDay} />
        {layouts.length > 1 ? <div className="pl-seg">{layouts.map((l, i) => <button key={l.id} className={i === layoutIx ? 'on' : ''} onClick={() => setLayoutIx(i)}>{l.name}</button>)}</div> : null}
        {!times ? <p className="pl-muted pl-pad">Loading tee slots…</p>
          : times.notYet ? <div className="pl-empty"><b>Not open yet</b><p>{times.notYet}</p></div>
            : !L || !L.slots.length ? <div className="pl-empty"><b>No open tee slots</b><p>Try another day, or call the course.</p></div> : (
              <>
                {mine ? <p className="pl-muted small">Prices are per player for {mine.name}, 18 holes. Carts, caddies and fees are shown before you book.</p> : null}
                {PERIODS.map(([label, from, to]) => {
                  const slots = all.filter((x) => x.time >= from && x.time < to);
                  if (!slots.length) return null;
                  return (
                    <section key={label} className={`pl-period p-${label.toLowerCase()}`}>
                      <h3><DayPart part={label} />{label}</h3>
                      <div className="pl-slots">
                        {slots.map((x) => {
                          const each = mine ? priceFor(s, mine.id, 18, day, x.time) : null;
                          return (
                            <button key={x.time} className="pl-slot" onClick={() => setBooking({ slot: x, layoutId: L.id })}>
                              <b>{clock(x.time).replace(/ (AM|PM)$/, '')}<small>{x.time < 720 ? 'AM' : 'PM'}</small></b>
                              <Spots free={x.free} capacity={Math.max(...x.tees.map((t) => t.capacity))} />
                              {each !== null ? <em>{peso(each).replace(/\.00$/, '')}</em> : null}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </>
            )}
      </div>
      {booking ? <Book page={page} me={me} day={day} layoutId={booking.layoutId} slot={booking.slot} onClose={() => { setBooking(null); setN(n + 1); }} /> : null}
    </div>
  );
}

/** Booking one tee slot: who's playing, holes, carts and extras, the price, then paying at the course. */
function Book({ page, me, day, layoutId, slot, onClose }: { page: CoursePage; me: Me; day: string; layoutId: string; slot: TeeTime; onClose: () => void }) {
  const s = page.setup;
  const mine = myType(s, me);
  const least = minPlayers(s, day);
  const most = Math.min(slot.free, s.rules.maxPlayersPerBooking);
  const [count, setCount] = useState(Math.max(least, Math.min(most, 4)));
  const [types, setTypes] = useState<string[]>(() => Array.from({ length: 5 }, () => mine?.id ?? ''));
  const [names, setNames] = useState<string[]>(['', '', '', '', '']);
  const offered = holesOffered(s, layoutId);
  const [holes, setHoles] = useState<9 | 18>(offered[0]);
  const cart = s.fees.find((f) => f.kind === 'cart');
  const caddie = s.fees.find((f) => f.kind === 'caddie');
  const optional = s.fees.filter((f) => f.kind === 'other' && !f.required);
  const [carts, setCarts] = useState(0);
  const [gallery, setGallery] = useState(0);
  const [extras, setExtras] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ref: string; id: string } | null>(null);
  const players = types.slice(0, count);
  const tee = teeFor(slot, count);
  const q = useMemo(() => quote(s, { layoutId, day, time: slot.time, holes, players, carts, caddies: 0, gallery, extras }), [s, layoutId, day, slot.time, holes, players.join(), carts, gallery, extras.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = q.lines.filter((l) => l.payAt === 'booking').reduce((t, l) => t + l.amount, 0);
  const required = s.rules.playerNames === 'required';
  const missingName = required && names.slice(1, count).some((x) => !x.trim());

  const book = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ id: string; ref: string }>(`/courses/${page.course.slug}/bookings`, {
        method: 'POST',
        body: { layoutId, startTee: tee.startTee, day, time: slot.time, players: count, playerTypes: players, playerNames: ['', ...names.slice(1, count)], holes: q.holes, carts: q.carts, gallery: q.gallery, extras, notes },
      });
      setDone(r);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Sheet key="done" title="You’re booked" sub={page.course.name} onClose={onClose} footer={<><Button kind="line" onClick={onClose}>Done</Button><Button onClick={() => go('/bookings')}>My bookings</Button></>}>
        <div className="pl-done">
          <Pass code={done.ref} course={page.course.name} when={`${shortDay(day)}, ${clock(slot.time)}`}
            detail={`${count} ${count === 1 ? 'player' : 'players'}, ${q.holes} holes${slot.tees.length > 1 || tee.startTee !== '1' ? `, from tee ${tee.startTee}` : ''}`} />
          <p className="pl-muted">Pay <b>{peso(total)}</b> at the course. We’ve saved this in Bookings.</p>
        </div>
      </Sheet>
    );
  }

  const typeOptions = s.playerTypes;
  return (
    <Sheet key="book" title={clock(slot.time)} sub={`${page.course.name}, ${shortDay(day)}`} onClose={onClose}
      footer={<>
        <span className="pl-foot-total"><small>Pay at the course</small><b>{peso(total)}</b></span>
        <Button disabled={busy || q.problems.length > 0 || count < least || missingName} onClick={() => void book()}>{busy ? 'Booking…' : `Book ${count} ${count === 1 ? 'player' : 'players'}`}</Button>
      </>}>
      <section className="pl-group">
        <div className="pl-row"><span><b>Players</b><small>{slot.free} {slot.free === 1 ? 'spot' : 'spots'} open{least > 1 ? `, at least ${least} on this day` : ''}</small></span><Stepper label="Players" value={count} min={least} max={most} onChange={setCount} /></div>
        {players.map((t, i) => (
          <div key={i} className="pl-player">
            {i === 0 ? <span className="pl-player-name"><b>{me.profile!.name}</b><small>You</small></span>
              : <input aria-label={`Name of player ${i + 1}`} value={names[i]} placeholder={required ? `Player ${i + 1}’s name` : `Player ${i + 1}’s name (optional)`} onChange={(e) => { const x = [...names]; x[i] = e.target.value; setNames(x); }} />}
            {typeOptions.length > 1 ? (
              <select aria-label={`Player ${i + 1} type`} value={t} onChange={(e) => { const x = [...types]; x[i] = e.target.value; setTypes(x); }}>
                {typeOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ) : null}
          </div>
        ))}
        {offered.length > 1 ? (
          <div className="pl-row"><span><b>Holes</b></span><span className="pl-seg small">{offered.map((h) => <button key={h} className={holes === h ? 'on' : ''} onClick={() => setHoles(h)}>{h}</button>)}</span></div>
        ) : null}
      </section>

      {cart || caddie || s.options.galleryMax > 0 || optional.length ? (
        <section className="pl-group">
          {cart ? <div className="pl-row"><span><b>Golf carts</b><small>{cart.required ? `Required, ${s.options.cartSeats} players per cart` : `${s.options.cartSeats} players per cart`}</small></span>
            {cart.required ? <b>{q.carts}</b> : <Stepper label="Carts" value={q.carts} min={0} max={count} onChange={setCarts} />}</div> : null}
          {caddie ? <div className="pl-row"><span><b>Caddies</b><small>One for every player{caddie.paidTo === 'direct' ? ', paid to the caddie' : ''}</small></span><b>{q.caddies}</b></div> : null}
          {s.options.galleryMax > 0 ? <div className="pl-row"><span><b>Gallery</b><small>Guests who aren’t playing</small></span><Stepper label="Gallery guests" value={gallery} min={0} max={s.options.galleryMax} onChange={setGallery} /></div> : null}
          {optional.map((o) => (
            <label key={o.id} className="pl-row pl-tick">
              <span><b>{o.name}</b><small>{o.per === 'booking' ? 'Once per booking' : 'Per player'}</small></span>
              <input type="checkbox" checked={extras.includes(o.id)} onChange={(e) => setExtras(e.target.checked ? [...extras, o.id] : extras.filter((x) => x !== o.id))} />
            </label>
          ))}
        </section>
      ) : null}

      <PriceList lines={q.lines} payWord="Pay at the course" />
      {q.problems.length ? <ul className="pl-warn">{q.problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}

      <section className="pl-pay">
        <label className="on"><input type="radio" checked readOnly /><span><b>Pay at the course</b><small>Pay {peso(total)} at the counter when you arrive.</small></span></label>
        <label className="off"><input type="radio" disabled /><span><b>GCash, Maya or QR Ph</b><small>Coming soon</small></span></label>
      </section>
      <label className="pl-field"><span>Note for the course (optional)</span><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. need club rental" /></label>
      <p className="pl-muted small">You can cancel or change the time in the app up to {s.rules.cancelCutoffHours} hours before your tee slot.</p>
      {msg ? <p className="pl-err" role="status">{msg}</p> : null}
    </Sheet>
  );
}

export type { MyBooking };

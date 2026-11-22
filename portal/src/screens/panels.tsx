import { useEffect, useState } from 'react';
import { Btn, Field, Seg, Select, Sheet, Stepper } from '@maison/core/ui/kit';
import { addDays, counterSplit, dueWithBooking, localParts, mustPayNow, payDeadline, formatDay, formatTime, holesOffered, isPencil, minPlayers, paidForCheckIn, peso, quote, STATUS_WORDS, type CourseSetup, type QuoteLine } from '@maison/engine';
import { api, type SheetData, type StaffBooking, type StaffSlot } from '../api';
import { PassportsPanel, RegisterForm, type PassportsData } from './Passports';

const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const CHANNEL: Record<string, string> = { phone: 'Phone', viber: 'Viber', walkin: 'Walk-in', app: 'App', staff: 'Staff' };

/**
 * Book a phone, Viber or walk-in golfer into an open time: who's playing, holes, carts, caddies, gallery, and
 * the price. With `special` (owners and managers), a VIP, member or favour accepted outside the sheet: any
 * time or none, never refused for a full or held time, charged like any booking by each player's type.
 */
export function NewBooking({ courseId, cell, special, setup, prefill, onClose, onDone }: {
  courseId: string; cell?: StaffSlot; special?: { day: string }; setup: CourseSetup; onClose: () => void; onDone: (made?: StaffBooking) => void;
  /** Seating a group from the counter's standby list: their details, booked as a walk-in. */
  prefill?: { contactName: string; mobile: string; notes: string; players: number; standbyId: string };
}) {
  const types = setup.playerTypes.filter((t) => t.active && !t.member);
  const first = (types.find((t) => t.public) ?? types[0])?.id ?? '';
  const open = setup.layouts.filter((l) => l.active);
  const [layoutId, setLayoutId] = useState(cell?.layoutId ?? open[0]?.id ?? '');
  const [timeText, setTimeText] = useState('');
  const day = cell?.day ?? special?.day ?? '';
  const time = cell ? cell.time : timeText ? toMin(timeText) : null;
  const room = cell ? cell.free : 5;
  const offered = holesOffered(setup, layoutId);
  const [f, setF] = useState({ contactName: prefill?.contactName ?? '', mobile: prefill?.mobile ?? '', channel: prefill ? 'walkin' : 'phone', notes: prefill?.notes ?? '' });
  const [names, setNames] = useState<string[]>([]);
  const namesRequired = setup.rules.playerNames === 'required';
  const [counts, setCounts] = useState<Record<string, number>>({ [first]: Math.min(room, prefill?.players ?? 4) });
  const [holes, setHoles] = useState<9 | 18>(offered[0]);
  const [carts, setCarts] = useState(0);
  const [caddies, setCaddies] = useState(0);
  const [gallery, setGallery] = useState(0);
  const [extras, setExtras] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const layout = setup.layouts.find((l) => l.id === layoutId);
  const players = types.flatMap((t) => Array.from({ length: counts[t.id] ?? 0 }, () => t.id));
  const n = players.length;
  const fee = (k: string) => setup.fees.find((x) => x.active && x.kind === k);
  const cart = fee('cart'), caddie = fee('caddie');
  const q = quote(setup, { layoutId, day, time: time ?? 0, holes, players, carts, caddies, gallery, extras });
  const least = minPlayers(setup, day);
  const withBooking = q.lines.filter((l) => l.payAt === 'booking').reduce((s, l) => s + l.amount, 0);
  const optional = setup.fees.filter((x) => x.active && x.kind === 'other' && !x.required);
  const setCount = (id: string, v: number) => {
    const others = n - (counts[id] ?? 0);
    const next = { ...counts, [id]: Math.max(0, Math.min(v, room - others)) };
    setCounts(next);
    const total = Object.values(next).reduce((a, b) => a + b, 0);
    setCarts((c) => Math.min(c, total)); setCaddies((c) => Math.min(c, total));
  };
  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      const playerNames = players.map((_, i) => (names[i] ?? '').trim() || (i === 0 ? f.contactName.trim() : ''));
      if (namesRequired && playerNames.some((x) => !x)) throw new Error('Enter the name of every player. The club asks for all names.');
      const body = { ...f, playerNames, players: n, playerTypes: players, holes: q.holes, carts: q.carts, caddies: q.caddies, gallery: q.gallery, extras, layoutId, day, standbyId: prefill?.standbyId };
      const made = cell ? await api<StaffBooking>(`/courses/${courseId}/bookings`, { method: 'POST', body: { ...body, startTee: cell.startTee, time: cell.time } })
        : await api<StaffBooking>(`/courses/${courseId}/specials`, { method: 'POST', body: { ...body, time } });
      onDone(made);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open title={cell ? `${formatTime(cell.time)}${(layout?.startTees.length ?? 1) > 1 ? ` from tee ${cell.startTee}` : ''}` : 'Special booking'} eyebrow={formatDay(day)} onClose={onClose} watch={{ f, counts }} width={600}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={busy || !n} onClick={() => void go()}>{busy ? 'Booking…' : `${cell ? 'Book' : 'Accept'} ${n} ${n === 1 ? 'player' : 'players'} · ${peso(withBooking)}`}</Btn></>}>
      {cell?.block ? <p className="fore-note held">This time is held for {cell.block.reason.toLowerCase()}. You can still book it here.</p> : null}
      {!cell ? (
        <>
          <p className="fore-kind-note">For a VIP, a member or a special case. It doesn’t take any tee time’s spots, so you can accept it even when the sheet is full or held. It’s charged like any booking, by each player’s type.</p>
          <div className={`grid ${open.length > 1 ? 'fore-2' : ''}`}>
            <Field label="Tee time (optional)" type="time" value={timeText} onChange={setTimeText} hint="Leave empty if there’s no set time. Any time works, even between flights." />
            {open.length > 1 ? <Select label="Course" value={layoutId} onChange={setLayoutId} options={open.map((l) => ({ value: l.id, label: l.name }))} /> : null}
          </div>
        </>
      ) : null}
      <Seg value={f.channel} onChange={(v) => setF({ ...f, channel: v })} options={[{ value: 'phone', label: 'Phone' }, { value: 'viber', label: 'Viber' }, { value: 'walkin', label: 'Walk-in' }]} />
      {cell ? <PayNote setup={setup} day={day} time={cell.time} channel={f.channel} /> : null}
      <div className="grid fore-2">
        <Field label="Name" value={f.contactName} onChange={(v) => setF({ ...f, contactName: v })} autoFocus />
        <Field label="Mobile" type="tel" value={f.mobile} onChange={(v) => setF({ ...f, mobile: v })} placeholder="0917 123 4567" />
      </div>

      <div className="fore-bk-group">
        <div className="fore-bk-head">
          <b>Who’s playing</b>
          {cell ? <><Balls capacity={cell.capacity} used={cell.used} adding={n} /><span className="muted small">{cell.free - n} of {cell.free} {cell.free === 1 ? 'spot' : 'spots'} left</span></> : <span className="muted small">Up to 5 players</span>}
        </div>
        {types.map((t) => (
          <div key={t.id} className="fore-bk-line">
            <span><b>{t.name}</b>{t.days.length || t.earliest !== null ? <small>{[t.days.length ? `${t.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')} only` : '', t.earliest !== null ? `from ${formatTime(t.earliest)}` : ''].filter(Boolean).join(', ')}</small> : null}</span>
            <Stepper value={counts[t.id] ?? 0} onChange={(v) => setCount(t.id, v)} min={0} max={(counts[t.id] ?? 0) + room - n} />
          </div>
        ))}
        {offered.length > 1 ? <div className="fore-bk-line"><span><b>Holes</b></span><Seg value={String(holes)} onChange={(v) => setHoles(v === '9' ? 9 : 18)} options={offered.map((h) => ({ value: String(h), label: `${h} holes` }))} /></div> : null}
      </div>

      {n ? (
        <div className="fore-bk-group fore-names">
          <div className="fore-bk-head"><b>Player names</b><span className="muted small">{namesRequired ? 'Required for every player' : 'Optional'}</span></div>
          {players.map((typeId, i) => (
            <label key={i} className="fore-bk-line">
              <span><b>Player {i + 1}</b><small>{types.find((t) => t.id === typeId)?.name}</small></span>
              <input className="input" aria-label={`Name of player ${i + 1}`} value={names[i] ?? ''} placeholder={i === 0 ? f.contactName || 'Name for the booking' : namesRequired ? 'Name' : 'Name (optional)'}
                onChange={(e) => { const next = [...names]; next[i] = e.target.value; setNames(next); }} />
            </label>
          ))}
        </div>
      ) : null}

      {cart || caddie || setup.options.galleryMax > 0 || optional.length ? (
        <div className="fore-bk-group">
          {cart ? (
            <div className="fore-bk-line">
              <span><b>Golf carts</b><small>{cart.required ? `Required, ${setup.options.cartSeats} players per cart` : `${setup.options.cartSeats} players per cart`}</small></span>
              <Stepper value={q.carts} onChange={setCarts} min={cart.required ? Math.ceil(n / Math.max(1, setup.options.cartSeats)) : 0} max={n} />
            </div>
          ) : null}
          {caddie ? (
            <div className="fore-bk-line">
              <span><b>Caddies</b><small>{caddie.paidTo === 'direct' ? 'One for every player, paid direct to the caddie' : 'One for every player'}</small></span>
              {caddie.required ? <span className="fore-bk-fixed">{q.caddies}</span> : <Stepper value={q.caddies} onChange={setCaddies} min={0} max={n} />}
            </div>
          ) : null}
          {setup.options.galleryMax > 0 ? (
            <div className="fore-bk-line"><span><b>Gallery</b><small>Guests who aren’t playing</small></span><Stepper value={gallery} onChange={setGallery} min={0} max={setup.options.galleryMax} /></div>
          ) : null}
          {optional.map((o) => (
            <label key={o.id} className="fore-bk-line check-line">
              <span><b>{o.name}</b><small>{o.per === 'booking' ? 'Once per booking' : 'Per player'}</small></span>
              <input type="checkbox" checked={extras.includes(o.id)} onChange={(e) => setExtras(e.target.checked ? [...extras, o.id] : extras.filter((x) => x !== o.id))} />
            </label>
          ))}
        </div>
      ) : null}

      {cell && n > 0 && n < least ? <p className="fore-note">The course asks for at least {least} players per booking on this day. Golfers in the app can’t book fewer; you still can.</p> : null}
      <Field label="Note" value={f.notes} onChange={(v) => setF({ ...f, notes: v })} placeholder={cell ? 'e.g. celebrating a birthday, needs club rental' : 'e.g. guest of the board, member’s family'} />
      {n ? <Price lines={q.lines} total={q.total} problems={q.problems} /> : null}
      {msg ? <p className="fore-error">{msg}</p> : null}
    </Sheet>
  );
}

/** When a new staff booking must be paid: on the spot (same-day walk-ins, or past the deadline), or by the club's deadline. */
function PayNote({ setup, day, time, channel }: { setup: CourseSetup; day: string; time: number; channel: string }) {
  const now = Date.now();
  const at = (ms: number) => new Date(ms).toLocaleString('en-PH', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: setup.timeZone });
  if (mustPayNow(setup, { day, time, channel }, now)) {
    return <p className="fore-note pay-now">{channel === 'walkin' && day === localParts(now, setup.timeZone).day ? 'Same-day walk-in: they pay now.' : 'Too close to the tee time for a deadline: they pay now.'} The time is held {setup.rules.holdMinutes} minutes while they pay, then released.</p>;
  }
  const due = payDeadline(setup, { day, time, channel }, now);
  return due ? <p className="muted small">If not paid now, it keeps its tee time until {at(due)}. After that it becomes a pencil booking.</p> : null;
}

/** The price, line by line, with what's paid at the course marked. */
export function Price({ lines, problems = [], payAtCourse = false }: { lines: QuoteLine[]; total?: number; problems?: string[]; payAtCourse?: boolean }) {
  // Bookings priced before payment targets were named say 'app' and 'course'.
  const to = (l: QuoteLine): string => (l.payAt as string) === 'app' ? 'booking' : (l.payAt as string) === 'course' ? 'counter' : l.payAt;
  // App bookings paid at the course: the counter also collects the fees paid at the counter (not the caddie's).
  const { collect: withBooking, separate, total } = counterSplit(lines, payAtCourse);
  const row = (l: QuoteLine) => (
    <div key={l.key}>
      <dt>{l.label}<small>{l.detail}{separate.includes(l) && to(l) === 'counter' ? ', paid at the counter' : to(l) === 'direct' ? ' at least, paid direct to the caddie' : ''}</small></dt>
      <dd>{peso(l.amount)}</dd>
    </div>
  );
  return (
    <div className="fore-price">
      {problems.length ? <ul className="fore-price-warn">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
      <dl>
        {withBooking.map(row)}
        <div className="total"><dt>Total{separate.length ? <small>{payAtCourse ? 'Collected at the counter' : 'Paid with the booking'}</small> : null}</dt><dd>{peso(total)}</dd></div>
      </dl>
      {separate.length ? (
        <dl className="fore-price-sep">
          <div className="sep-head"><dt>Paid separately</dt></div>
          {separate.map(row)}
        </dl>
      ) : null}
    </div>
  );
}

/**
 * One booking: check in, mark played or no-show, cancel, move it to another time, record a payment at the
 * counter, or fix the golfer's details. View-only staff see it and change nothing.
 */
export function BookingPanel({ courseId, b, setup, courseName = '', readOnly, justMade, onClose, onDone }: {
  courseId: string; b: StaffBooking; setup: CourseSetup; courseName?: string; readOnly?: boolean; justMade?: boolean; onClose: () => void; onDone: () => void;
}) {
  // Paying after playing: golfers register on arrival (passports open) and settle after the round.
  const after = setup.rules.payWhen === 'after';
  const [passports, setPassports] = useState<PassportsData | null>(null);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (!after || (b.status !== 'checked_in' && b.status !== 'played')) return;
    let live = true;
    api<PassportsData>(`/courses/${courseId}/bookings/${b.id}/passports`).then((r) => { if (live) setPassports(r); }).catch(() => { /* shown on retry */ });
    return () => { live = false; };
  }, [after, courseId, b.id, b.status]);
  const registered = passports !== null && (b.status === 'checked_in' || b.status === 'played' || changed);
  const [msg, setMsg] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  // Just booked by phone, Viber or at the counter: go straight to taking the payment.
  // (Paying after playing: a same-day walk-in registers straight away instead.)
  const [mode, setMode] = useState<'view' | 'cancel' | 'move' | 'pay' | 'edit' | 'register'>(
    justMade && !readOnly && after ? (b.channel === 'walkin' && b.day === localParts(Date.now(), setup.timeZone).day ? 'register' : 'view')
      : justMade && !readOnly && b.payStatus === 'unpaid' ? 'pay' : 'view');
  const pencil = isPencil(b, Date.now());
  const clockOf = (ms: number) => new Date(ms).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: setup.timeZone });
  const [roster, setRoster] = useState<{ n: number; name: string; player_type_id: string }[]>([]);
  useEffect(() => {
    let live = true;
    api<{ players: { n: number; name: string; player_type_id: string }[] }>(`/courses/${courseId}/bookings/${b.id}`).then((r) => { if (live) setRoster(r.players); }).catch(() => { /* names are extra */ });
    return () => { live = false; };
  }, [courseId, b.id]);
  const typeName = (id: string) => setup.playerTypes.find((t) => t.id === id)?.name ?? '';
  const act = async (path: string, body?: unknown) => {
    setMsg(null);
    try { await api(`/courses/${courseId}/bookings/${b.id}/${path}`, { method: 'POST', body: body ?? {} }); onDone(); } catch (e) { setMsg((e as Error).message); }
  };
  const active = b.status === 'held' || b.status === 'confirmed';
  const unpaid = b.payStatus === 'unpaid' && b.status !== 'cancelled' && b.status !== 'expired';
  const canCheckIn = !after && (b.status === 'confirmed' || b.status === 'no_show') && paidForCheckIn(b);
  const canRegister = after && !registered && (b.status === 'confirmed' || b.status === 'no_show');
  const payFirst = !after && (b.status === 'confirmed' || b.status === 'no_show') && !canCheckIn;
  const layoutName = setup.layouts.length > 1 ? setup.layouts.find((l) => l.id === b.layoutId)?.name : null;
  return (
    <Sheet open title={b.contactName} eyebrow={`${formatDay(b.day)}, ${b.time < 0 ? 'no set time' : formatTime(b.time)}${b.special ? ', special booking' : ''}${layoutName ? `, ${layoutName}` : ''}${b.startTee !== '1' ? `, tee ${b.startTee}` : ''}`} onClose={changed ? onDone : onClose} width={600}>
      <dl className="fore-facts">
        <div><dt>Status</dt><dd><span className={`fore-status s-${b.status}`}>{STATUS_WORDS[b.status]}</span></dd></div>
        <div><dt>Players</dt><dd>{b.players}, {b.holes} holes</dd></div>
        {b.carts || b.caddies || b.gallery ? <div><dt>With</dt><dd>{[b.carts ? `${b.carts} ${b.carts === 1 ? 'cart' : 'carts'}` : '', b.caddies ? `${b.caddies} ${b.caddies === 1 ? 'caddie' : 'caddies'}` : '', b.gallery ? `${b.gallery} gallery` : ''].filter(Boolean).join(', ')}</dd></div> : null}
        <div><dt>Booked by</dt><dd>{CHANNEL[b.channel] ?? b.channel}</dd></div>
        <div><dt>Reference</dt><dd className="fore-ref">{b.ref}</dd></div>
        <div className={pencil || b.status === 'held' ? 'wide' : ''}><dt>Payment</dt><dd>{b.payStatus === 'paid_course' ? `${peso(b.paidAmount)} paid at the counter${b.paidMethod ? `, ${METHOD[b.paidMethod] ?? b.paidMethod}` : ''}` : b.payStatus === 'paid_online' ? 'Paid in the app'
          : pencil ? <span className="fore-pencil-note">{after ? 'Not registered in time: now a pencil booking. Others can book this time. Register them to put it back, if there’s still room.' : 'Not paid in time: now a pencil booking. Others can book this time. Record the payment to put it back, if there’s still room.'}</span>
            : b.status === 'held' && b.holdExpiresAt ? (b.createdBy === 'waitlist'
              ? `Waitlist offer: held for this golfer until ${clockOf(b.holdExpiresAt)}. They book it in the app; if they don’t, it goes to the next in line.`
              : `Pay now: held until ${clockOf(b.holdExpiresAt)}. Record the payment to confirm it; otherwise the time is released.`)
              : after && registered ? (passports?.settled ? 'Settled after the round' : 'Registered: settles after the round')
              : b.payDueBy ? `${after ? 'Not registered yet. Register' : 'Not paid yet. Pay'} by ${new Date(b.payDueBy).toLocaleString('en-PH', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}, or it becomes a pencil booking.`
                : after ? 'Pays after the round' : 'Not paid yet'}</dd></div>
        {b.mobile ? <div><dt>Mobile</dt><dd><a href={`tel:${b.mobile}`}>{b.mobile}</a></dd></div> : null}
        {b.email ? <div><dt>Email</dt><dd><a href={`mailto:${b.email}`}>{b.email}</a></dd></div> : null}
        {b.notes ? <div className="wide"><dt>Note</dt><dd>{b.notes}</dd></div> : null}
        {roster.length && !(registered && passports) ? (
          <div className="wide"><dt>Players</dt><dd>
            <ol className="fore-roster">{roster.map((p) => <li key={p.n}><span>{p.name || <i>No name yet</i>}</span><small>{typeName(p.player_type_id)}</small></li>)}</ol>
          </dd></div>
        ) : null}
      </dl>
      {registered && passports ? <PassportsPanel courseId={courseId} b={b} setup={setup} courseName={courseName} data={passports} readOnly={readOnly} onChange={(p) => { setPassports(p); setChanged(true); }} />
        : b.quote?.length ? <Price lines={b.quote} total={b.amount} payAtCourse={(b.channel === 'app' || after) && b.payStatus !== 'paid_online'} /> : null}

      {readOnly ? <p className="muted small">You can view bookings. Ask the owner if you need to change them.</p> : mode === 'view' ? (
        <>
          <div className="row wrap">
            {b.status === 'held' ? <Btn kind="primary" onClick={() => void act('confirm')}>Confirm booking</Btn> : null}
            {canCheckIn ? <Btn kind="primary" onClick={() => void act('check-in')}>Check in</Btn> : null}
            {canRegister ? <Btn kind="primary" onClick={() => setMode('register')}>Register</Btn> : null}
            {b.status === 'checked_in' || (registered && b.status !== 'played') ? <Btn kind={after && !passports?.settled ? undefined : 'primary'} disabled={after && !passports?.settled} onClick={() => void act('played')}>Mark round played</Btn> : null}
            {unpaid && !(after && registered) ? <Btn kind={payFirst ? 'primary' : undefined} onClick={() => setMode('pay')}>{after ? 'Record payment ahead' : 'Record payment'}</Btn> : null}
            {b.status === 'confirmed' ? <Btn onClick={() => void act('no-show')}>Mark no-show</Btn> : null}
          </div>
          {payFirst ? <p className="muted small">Check-in opens once the booking is paid.</p> : null}
          {after && registered && !passports?.settled && b.status !== 'played' ? <p className="muted small">The round can be finished once every passport is settled.</p> : null}
          <div className="row wrap">
            {active ? <Btn kind="ghost" onClick={() => setMode('move')}>{b.special ? 'Put on a tee time' : 'Move to another time'}</Btn> : null}
            <Btn kind="ghost" onClick={() => setMode('edit')}>Edit golfer details</Btn>
            {active ? <Btn kind="ghost" onClick={() => setMode('cancel')}>Cancel booking…</Btn> : null}
          </div>
        </>
      ) : mode === 'cancel' ? (
        <div className="fore-cancel">
          <Field label="Why is it cancelled?" value={reason} onChange={setReason} autoFocus placeholder="e.g. golfer called to cancel" />
          <div className="row"><Btn kind="danger" onClick={() => void act('cancel', { reason })}>Cancel booking</Btn><Btn kind="ghost" onClick={() => setMode('view')}>Keep it</Btn></div>
        </div>
      ) : mode === 'move' ? <MoveBooking courseId={courseId} b={b} setup={setup} onBack={() => setMode('view')} onDone={onDone} />
        : mode === 'register' ? <RegisterForm courseId={courseId} b={b} roster={roster} required={setup.rules.playerNames === 'required'} onBack={() => setMode('view')} onDone={(p) => { setPassports(p); setChanged(true); setMode('view'); setRoster(p.players.map((x) => ({ n: x.n, name: x.name, player_type_id: roster.find((r) => r.n === x.n)?.player_type_id ?? '' }))); }} />
        : mode === 'pay' ? <RecordPayment courseId={courseId} b={b} justMade={justMade} onBack={justMade ? onClose : () => setMode('view')} onDone={onDone} />
          : <EditDetails courseId={courseId} b={b} roster={roster} typeName={typeName} required={setup.rules.playerNames === 'required'} onBack={() => setMode('view')} onDone={onDone} />}
      {msg ? <p className="fore-error">{msg}</p> : null}
    </Sheet>
  );
}

const METHOD: Record<string, string> = { cash: 'cash', gcash: 'GCash', maya: 'Maya', card: 'card', bank: 'bank transfer' };

/** Pick a new day, course and time; only times with room for the whole booking are offered. */
function MoveBooking({ courseId, b, setup, onBack, onDone }: { courseId: string; b: StaffBooking; setup: CourseSetup; onBack: () => void; onDone: () => void }) {
  const layouts = setup.layouts.filter((l) => l.active);
  const [day, setDay] = useState(b.day);
  const [layoutId, setLayoutId] = useState(layouts.some((l) => l.id === b.layoutId) ? b.layoutId : layouts[0]?.id ?? '');
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [pick, setPick] = useState<StaffSlot | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setSheet(null); setPick(null);
    api<SheetData>(`/courses/${courseId}/sheet?day=${day}`).then((r) => { if (live) setSheet(r); }).catch((e) => setMsg((e as Error).message));
    return () => { live = false; };
  }, [courseId, day]);
  const slots = (sheet?.layouts.find((l) => l.layout.id === layoutId)?.slots ?? [])
    .filter((s) => s.state !== 'past' && s.state !== 'closed' && !(s.day === b.day && s.time === b.time && s.startTee === b.startTee && s.layoutId === b.layoutId))
    .filter((s) => s.free >= b.players);
  const twoTees = (layouts.find((l) => l.id === layoutId)?.startTees.length ?? 1) > 1;
  const go = async () => {
    if (!pick) return;
    setBusy(true); setMsg(null);
    try { await api(`/courses/${courseId}/bookings/${b.id}/move`, { method: 'POST', body: { layoutId: pick.layoutId, startTee: pick.startTee, day: pick.day, time: pick.time } }); onDone(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="fore-subform">
      <b>Move {b.contactName}’s {b.players} {b.players === 1 ? 'player' : 'players'}</b>
      <div className={`grid ${layouts.length > 1 ? 'fore-2' : ''}`}>
        <Field label="Day" type="date" value={day} onChange={(v) => v && setDay(v)} />
        {layouts.length > 1 ? <Select label="Course" value={layoutId} onChange={(v) => { setLayoutId(v); setPick(null); }} options={layouts.map((l) => ({ value: l.id, label: l.name }))} /> : null}
      </div>
      {!sheet ? <p className="muted small">Loading open times…</p> : !slots.length ? <p className="muted small">No times with room for {b.players} on this day. Try another day.</p> : (
        <div className="fore-times" role="listbox" aria-label="Open times">
          {slots.map((s) => (
            <button key={`${s.startTee}-${s.time}`} role="option" aria-selected={pick === s} className={`${pick === s ? 'on' : ''}${s.state === 'held' ? ' held' : ''}`} onClick={() => setPick(s)}>
              <b>{formatTime(s.time)}</b><span>{twoTees ? `Tee ${s.startTee}, ` : ''}{s.free} free{s.state === 'held' ? ', held' : ''}</span>
            </button>
          ))}
        </div>
      )}
      <p className="muted small">The price is worked out again for the new day and time. App golfers are told about the change.</p>
      {msg ? <p className="fore-error">{msg}</p> : null}
      <div className="row"><Btn kind="primary" disabled={!pick || busy} onClick={() => void go()}>{pick ? `Move to ${formatTime(pick.time)}${pick.day !== b.day ? `, ${formatDay(pick.day)}` : ''}` : 'Pick a time'}</Btn><Btn kind="ghost" onClick={onBack}>Back</Btn></div>
    </div>
  );
}

/** Payment taken at the counter: cash, GCash, Maya, card or bank transfer, with its reference number. */
function RecordPayment({ courseId, b, justMade, onBack, onDone }: { courseId: string; b: StaffBooking; justMade?: boolean; onBack: () => void; onDone: () => void }) {
  // The total paid with the booking; fees paid separately (at the counter, or direct to the caddie) are not part of it.
  const due = dueWithBooking(b);
  const [amount, setAmount] = useState(String(due / 100));
  const [method, setMethod] = useState('cash');
  const [ref, setRef] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      const c = Math.round(Number(amount.replace(/[₱,\s]/g, '')) * 100);
      if (!(c > 0)) throw new Error('Enter the amount paid.');
      await api(`/courses/${courseId}/bookings/${b.id}/payment`, { method: 'POST', body: { amount: c, method, ref } });
      onDone();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="fore-subform">
      <b>{justMade ? `Booked: ${b.ref}. Take the payment now?` : 'Record payment at the counter'}</b>
      <Seg value={method} onChange={setMethod} options={[{ value: 'cash', label: 'Cash' }, { value: 'gcash', label: 'GCash' }, { value: 'maya', label: 'Maya' }, { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank' }]} />
      <div className="grid fore-2">
        <Field label="Amount paid (₱)" inputMode="decimal" value={amount} onChange={setAmount} hint={`Due at the counter: ${peso(due)}`} />
        {method !== 'cash' ? <Field label="Reference number" value={ref} onChange={setRef} placeholder="From the receipt or app" /> : null}
      </div>
      {msg ? <p className="fore-error">{msg}</p> : null}
      {justMade && b.status === 'held' && b.holdExpiresAt ? <p className="fore-note pay-now">They pay now: the time is held until {new Date(b.holdExpiresAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}, then released if no payment is recorded.</p>
        : justMade && b.payDueBy ? <p className="muted small">Not paying now? The booking keeps its tee time until {new Date(b.payDueBy).toLocaleString('en-PH', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. After that it becomes a pencil booking and others can book the time.</p> : null}
      <div className="row"><Btn kind="primary" disabled={busy} onClick={() => void go()}>Record {method === 'cash' ? 'cash' : METHOD[method]} payment</Btn><Btn kind="ghost" onClick={onBack}>{justMade ? (b.status === 'held' ? 'Not now' : 'Pay later') : 'Back'}</Btn></div>
    </div>
  );
}

function EditDetails({ courseId, b, roster, typeName, required, onBack, onDone }: {
  courseId: string; b: StaffBooking; roster: { n: number; name: string; player_type_id: string }[]; typeName: (id: string) => string; required: boolean; onBack: () => void; onDone: () => void;
}) {
  const [f, setF] = useState({ contactName: b.contactName, mobile: b.mobile, email: b.email ?? '', notes: b.notes });
  const [names, setNames] = useState<string[]>(() => roster.map((p) => p.name));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setMsg(null);
    try { await api(`/courses/${courseId}/bookings/${b.id}`, { method: 'PATCH', body: roster.length ? { ...f, playerNames: names } : f }); onDone(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="fore-subform">
      <b>Golfer details</b>
      <Field label="Name for the booking" value={f.contactName} onChange={(v) => setF({ ...f, contactName: v })} autoFocus />
      <div className="grid fore-2">
        <Field label="Mobile" type="tel" value={f.mobile} onChange={(v) => setF({ ...f, mobile: v })} placeholder="0917 123 4567" />
        <Field label="Email" type="email" value={f.email} onChange={(v) => setF({ ...f, email: v })} />
      </div>
      <Field label="Note" value={f.notes} onChange={(v) => setF({ ...f, notes: v })} />
      {roster.map((p, idx) => (
        <Field key={p.n} label={`Player ${p.n}, ${typeName(p.player_type_id)}${required ? '' : ' (optional)'}`} value={names[idx] ?? ''} onChange={(v) => { const next = [...names]; next[idx] = v; setNames(next); }} />
      ))}
      {msg ? <p className="fore-error">{msg}</p> : null}
      <div className="row"><Btn kind="primary" disabled={busy} onClick={() => void go()}>Save details</Btn><Btn kind="ghost" onClick={onBack}>Back</Btn></div>
    </div>
  );
}

/**
 * Pencil-hold times for walk-ins or regulars (staff can still book them), block them for an event or
 * tournament (nobody can book), or close them for maintenance or weather.
 */
export function HoldClose({ courseId, day, tees, layoutId, firstTee, lastTee, onClose, onDone }: { courseId: string; day: string; tees: string[]; layoutId: string; firstTee?: number; lastTee?: number; onClose: () => void; onDone: (note?: string) => void }) {
  const [f, setF] = useState({ kind: 'walkin', from: '06:00', to: '08:00', tee: '', reason: '', releaseDayBefore: true });
  const [msg, setMsg] = useState<string | null>(null);
  const event = f.kind === 'event';
  const closure = f.kind === 'weather' || f.kind === 'maintenance' || event;
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const go = async () => {
    setMsg(null);
    const releaseAt = !closure && f.releaseDayBefore ? Date.parse(`${addDays(day, -1)}T18:00:00+08:00`) : null;
    try {
      const r = await api<{ affected: StaffBooking[] }>(`/courses/${courseId}/blocks`, { method: 'POST', body: { kind: f.kind, day, from: toMin(f.from), to: toMin(f.to), layoutId, startTee: f.tee || null, reason: f.reason, releaseAt } });
      onDone(r.affected.length ? `${r.affected.length === 1 ? 'One booking is' : `${r.affected.length} bookings are`} on the times you just ${event ? 'blocked' : closure ? 'closed' : 'held'}. Call to move or cancel: ${r.affected.map((b) => `${b.contactName}, ${formatTime(b.time)}${b.mobile ? `, ${b.mobile}` : ''}`).join('; ')}.` : undefined);
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <Sheet open title={event ? 'Block tee time' : closure ? 'Close tee time' : 'Hold tee time'} eyebrow={formatDay(day)} onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={() => void go()}>{event ? 'Block these times' : closure ? 'Close these times' : 'Hold these times'}</Btn></>}>
      <Select label="What for" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[
        { value: 'walkin', label: 'Pencil hold for walk-ins' }, { value: 'regulars', label: 'Pencil hold for regulars or a group' },
        { value: 'event', label: 'Block for an event or tournament' }, { value: 'maintenance', label: 'Close for maintenance' }, { value: 'weather', label: 'Close for weather' },
      ]} />
      <p className={`fore-kind-note${event || closure ? ' block' : ''}`}>{event ? 'Nobody can book these times, staff included. Golfers in the app see them as unavailable.'
        : closure ? 'Nobody can book these times until you reopen them.'
          : 'A pencil hold: golfers can’t book these times in the app, but your staff can still book them for the golfers you’re holding them for.'}</p>
      <div className="grid fore-2"><Field label="From" type="time" value={f.from} onChange={(v) => setF({ ...f, from: v })} /><Field label="Until" type="time" value={f.to} onChange={(v) => setF({ ...f, to: v })} hint="The time you enter here is not included." /></div>
      {firstTee !== undefined && lastTee !== undefined ? <button className="fore-idea" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...f, from: hhmm(firstTee), to: hhmm(Math.min(lastTee + 1, 1439)) })}>Whole day, {formatTime(firstTee)} to {formatTime(lastTee)}</button> : null}
      {tees.length > 1 ? <Select label="Starting tee" value={f.tee} onChange={(v) => setF({ ...f, tee: v })} options={[{ value: '', label: 'Both tees' }, ...tees.map((t) => ({ value: t, label: `Tee ${t} only` }))]} /> : null}
      <Field label="Shown on the tee sheet as" value={f.reason} onChange={(v) => setF({ ...f, reason: v })} placeholder={event ? 'e.g. Club championship, Corporate tournament' : closure ? 'e.g. Greens aeration' : 'e.g. Saturday regulars'} />
      {!closure
        ? <label className="check"><input type="checkbox" checked={f.releaseDayBefore} onChange={(e) => setF({ ...f, releaseDayBefore: e.target.checked })} /><span>Open unused times to the app the day before at 6:00 PM</span></label>
        : <p className="muted small">Bookings already on these times stay. You’ll get a list of them to call.</p>}
      {msg ? <p className="fore-error">{msg}</p> : null}
    </Sheet>
  );
}

/** The players on a flight as golf balls: filled for each booked player, hollow for each free spot. */
export function Balls({ capacity, used, adding = 0 }: { capacity: number; used: number; adding?: number }) {
  return (
    <span className="balls" role="img" aria-label={`${used} of ${capacity} players`}>
      {Array.from({ length: capacity }, (_, i) => <i key={i} className={i < used ? 'on' : i < used + adding ? 'add' : ''} />)}
    </span>
  );
}

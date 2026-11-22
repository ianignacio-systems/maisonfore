import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Btn } from '@maison/core/ui/kit';
import { addDays, daysBetween, formatTime, isPencil, localParts, STATUS_WORDS, weekday, type CourseSetup } from '@maison/engine';
import { api, type DaySummary, type SheetData, type SheetReply, type StaffBooking, type StaffSlot } from '../api';
import { Balls, BookingPanel, HoldClose, NewBooking } from './panels';

type View = 'day' | 'week';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateNum = (d: string) => Number(d.slice(8));
const monthOf = (d: string) => MONTHS.at(Number(d.slice(5, 7)) - 1)!;
/** The Monday on or before a day. */
const mondayOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));
/** 'In 3 days', '2 weeks ago'… */
const relDays = (today: string, d: string) => {
  const n = daysBetween(today, d), a = Math.abs(n);
  const w = a < 14 ? `${a} days` : a < 60 ? `${Math.round(a / 7)} weeks` : `${Math.round(a / 30)} months`;
  return n > 0 ? `In ${w}` : `${w.charAt(0).toUpperCase()}${w.slice(1)} ago`;
};
const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;

/**
 * The tee sheet (PTR-6), as a day or a week. The day shows every flight with its players as golf balls,
 * every booking whatever the channel, holds and closures, and refreshes every few seconds. The week
 * shows how full each hour of each day is; tap a day to open it.
 */
export function TeeSheet({ courseId, setup, courseName, readOnly, canSpecial, initialDay }: { courseId: string; setup: CourseSetup; courseName: string; readOnly?: boolean; canSpecial?: boolean; initialDay?: string }) {
  const page = useRef<HTMLDivElement>(null);
  const top = useStuckHeight(page, '--top-h');
  const today = localParts(Date.now(), setup.timeZone).day;
  const [view, setView] = useState<View>(() => { if (initialDay) return 'day'; try { return (localStorage.getItem('fore.view') as View) || 'day'; } catch { return 'day'; } });
  const [day, setDay] = useState(initialDay ?? today);
  const [layoutIx, setLayoutIx] = useState(0);
  const [calendar, setCalendar] = useState(false);
  const pick = (v: View) => { setView(v); try { localStorage.setItem('fore.view', v); } catch { /* private window */ } };
  const step = view === 'day' ? 1 : 7;
  const layouts = setup.layouts.filter((l) => l.active);
  const layout = layouts[Math.min(layoutIx, layouts.length - 1)];
  const weekStart = mondayOf(day);

  const title = view === 'day'
    ? `${DAYS.at(weekday(day))}, ${dateNum(day)} ${monthOf(day)}`
    : `${dateNum(weekStart)}${monthOf(weekStart) !== monthOf(addDays(weekStart, 6)) ? ` ${monthOf(weekStart)}` : ''} to ${dateNum(addDays(weekStart, 6))} ${monthOf(addDays(weekStart, 6))}`;
  const sub = view === 'day' ? (day === today ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : day === addDays(today, -1) ? 'Yesterday' : relDays(today, day)) : 'Week';

  return (
    <div className="fore-page" ref={page}>
      <div className="fore-top" ref={top}>
      <header className="fore-bar">
        <div className="fore-title">
          <span className="fore-kicker">{sub}{layouts.length > 1 ? null : ` at ${courseName}`}</span>
          <h1>{title}</h1>
        </div>
        <div className="fore-controls">
          <div className="fore-toggle" role="tablist" aria-label="View">
            {(['day', 'week'] as const).map((v) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => pick(v)}>{v === 'day' ? 'Day' : 'Week'}</button>)}
          </div>
          <div className="fore-nav">
            <button aria-label={view === 'day' ? 'Day before' : 'Week before'} onClick={() => setDay(addDays(day, -step))}>‹</button>
            <button className="fore-today" disabled={view === 'day' ? day === today : weekStart === mondayOf(today)} onClick={() => setDay(today)}>Today</button>
            <button aria-label={view === 'day' ? 'Next day' : 'Next week'} onClick={() => setDay(addDays(day, step))}>›</button>
          </div>
          <div className="fore-cal-wrap">
            <button className={`fore-cal-btn${calendar ? ' on' : ''}`} aria-expanded={calendar} onClick={() => setCalendar(!calendar)}>Calendar</button>
            {calendar ? <MonthPicker value={day} today={today} onPick={(d) => { setDay(d); setCalendar(false); }} onClose={() => setCalendar(false)} /> : null}
          </div>
        </div>
      </header>
      {layout ? <DateStrip courseId={courseId} layoutId={layout.id} day={day} today={today} view={view} onPick={setDay} /> : null}
      {layouts.length > 1 ? (
        <div className="fore-layouts">{layouts.map((l, i) => <button key={l.id} className={i === layoutIx ? 'on' : ''} onClick={() => setLayoutIx(i)}>{l.name}</button>)}</div>
      ) : null}
      </div>
      {!layout ? <p className="fore-empty">No tee slots are set up yet. Add them in Settings.</p>
        : view === 'day' ? <DayView key={`${day}-${layout.id}`} courseId={courseId} setup={setup} day={day} today={today} layoutId={layout.id} readOnly={readOnly} canSpecial={canSpecial} page={page} />
          : <WeekView key={`${weekStart}-${layout.id}`} courseId={courseId} weekStart={weekStart} today={today} layoutId={layout.id} onOpen={(d) => { setDay(d); pick('day'); }} onSwipe={(dir) => setDay(addDays(day, dir * 7))} />}
    </div>
  );
}

// ---------------------------------------------------------------- day

function DayView({ courseId, setup, day, today, layoutId, readOnly, canSpecial, page }: {
  courseId: string; setup: CourseSetup; day: string; today: string; layoutId: string; readOnly?: boolean; canSpecial?: boolean; page: React.RefObject<HTMLDivElement | null>;
}) {
  const summary = useStuckHeight(page, '--sum-h');
  const [onlyOpen, setOnlyOpen] = useState(() => { try { return localStorage.getItem('fore.onlyOpen') === '1'; } catch { return false; } });
  const toggleOpen = () => { const v = !onlyOpen; setOnlyOpen(v); try { localStorage.setItem('fore.onlyOpen', v ? '1' : '0'); } catch { /* private window */ } };
  const [specialing, setSpecialing] = useState(false);
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState<StaffSlot | null>(null);
  const [open, setOpen] = useState<StaffBooking | null>(null);
  const [justMade, setJustMade] = useState(false);
  const [holding, setHolding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef<number | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const r = await api<SheetReply>(`/courses/${courseId}/sheet?day=${day}${!force && seq.current !== null ? `&since=${seq.current}` : ''}`);
      if (!r.unchanged) { setSheet(r); seq.current = r.seq; }
      setProblem(null);
    } catch (e) { setProblem((e as Error).message); }
  }, [courseId, day]);
  useEffect(() => {
    void load(true);
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const L = sheet?.layouts.find((l) => l.layout.id === layoutId);
  const tees = L?.layout.startTees ?? ['1'];
  const bookableSlot = (s: StaffSlot) => s.state !== 'past' && s.state !== 'closed' && s.free > 0;
  const allTimes = useMemo(() => (L ? [...new Set(L.slots.map((s) => s.time))] : []), [L]);
  const times = onlyOpen && L ? allTimes.filter((t) => L.slots.some((s) => s.time === t && bookableSlot(s))) : allTimes;
  const bookings = L ? L.slots.flatMap((s) => s.bookings) : [];
  const players = bookings.reduce((n, b) => n + b.players, 0);
  const capacity = L ? L.slots.filter((s) => s.state !== 'closed').reduce((n, s) => n + s.capacity, 0) : 0;
  const openTimes = L ? L.slots.filter((s) => s.state === 'open' || s.state === 'partial').length : 0;
  const checkedIn = bookings.filter((b) => b.status === 'checked_in' || b.status === 'played').length;
  const nowMin = day === today ? localParts(Date.now(), setup.timeZone).minutes : null;
  const after = (note?: string) => { setAdding(null); setOpen(null); setHolding(false); setSpecialing(false); setNotice(note ?? null); void load(true); };
  // Today opens at the current time: the slots that have already teed off are scrolled up out of view.
  const scrolled = useRef(false);
  const sheetBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrolled.current || nowMin === null || !times.length || !sheetBox.current) return;
    scrolled.current = true;
    const ix = times.findIndex((t) => t >= nowMin);
    if (ix <= 0) return; // nothing has teed off yet, or (ix = -1) the day is over: leave it at the top
    const row = sheetBox.current.querySelectorAll<HTMLElement>('.fore-row')[ix];
    if (row) scrollUnderHeader(row, sheetBox.current.querySelector<HTMLElement>('.fore-sheet-head'));
  }, [nowMin, times]);
  const release = (id: string) => api(`/courses/${courseId}/blocks/${id}`, { method: 'DELETE' }).then(() => load(true)).catch((e) => setProblem(e.message));

  return (
    <>
      <section className="fore-summary" aria-label="The day in numbers" ref={summary}>
        <div className="fore-fill">
          <div className="fore-fill-bar"><span style={{ width: `${capacity ? Math.round((players / capacity) * 100) : 0}%` }} /></div>
          <p><b>{players}</b> of {capacity} spots booked</p>
        </div>
        <p><b>{bookings.length}</b> {bookings.length === 1 ? 'booking' : 'bookings'}</p>
        <p><b>{openTimes}</b> slots open</p>
        <p><b>{checkedIn}</b> checked in</p>
        <div className="fore-sum-actions">
          <button className={`fore-chip-toggle${onlyOpen ? ' on' : ''}`} aria-pressed={onlyOpen} onClick={toggleOpen}><i aria-hidden />Only available slots</button>
          {readOnly ? <span className="muted small">View only</span> : (
            <>
              {canSpecial ? <Btn onClick={() => setSpecialing(true)}>Special booking</Btn> : null}
              <Btn kind="primary" onClick={() => setHolding(true)}>Hold or block times</Btn>
            </>
          )}
        </div>
      </section>
      {problem ? <p className="fore-alert crit">{problem}</p> : null}
      {notice ? <div className="fore-alert warn"><p>{notice}</p><button onClick={() => setNotice(null)}>Done</button></div> : null}
      {sheet && sheet.blocks.length ? (
        <section className="fore-blocks" aria-label="Holds and closures">
          {sheet.blocks.map((b) => {
            const closed = b.kind === 'weather' || b.kind === 'maintenance' || b.kind === 'event';
            return (
              <div key={b.id} className={`fore-block ${b.kind === 'event' ? 'event' : closed ? 'closed' : 'held'}`}>
                <b>{b.reason}</b>
                <span>{formatTime(b.from)} to {formatTime(b.to)}{b.startTee ? `, tee ${b.startTee}` : ''}{b.releaseAt ? `. Opens to the app ${new Date(b.releaseAt).toLocaleString('en-PH', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}</span>
                {readOnly ? null : <button onClick={() => void release(b.id)}>{b.kind === 'event' ? 'Unblock' : closed ? 'Reopen' : 'Release now'}</button>}
              </div>
            );
          })}
        </section>
      ) : null}
      {sheet?.specials?.length ? (
        <section className="fore-specials" aria-label="Special bookings">
          <b>Special bookings</b>
          {sheet.specials.map((b) => (
            <button key={b.id} className={`fore-golfer b-${b.status}`} onClick={() => setOpen(b)}>
              <span className="tm">{b.time < 0 ? 'No set time' : formatTime(b.time)}</span>
              <span className="n">{b.contactName}</span>
              <span className="p">{b.players}</span>
              {b.status !== 'confirmed' ? <span className="st">{STATUS_WORDS[b.status]}</span> : null}
            </button>
          ))}
        </section>
      ) : null}
      {sheet?.loose.length ? <p className="fore-alert warn">{sheet.loose.length === 1 ? 'One booking is' : `${sheet.loose.length} bookings are`} on a tee slot that’s no longer on the sheet: {sheet.loose.map((b) => `${b.contactName} at ${formatTime(b.time)}`).join(', ')}. Move {sheet.loose.length === 1 ? 'it' : 'them'} to another time.</p> : null}
      {!sheet ? <p className="fore-empty">Loading the tee sheet…</p> : !L || !allTimes.length ? <p className="fore-empty">No tee slots on this day. Check the tee slots in Settings.</p> : !times.length ? <p className="fore-empty">No available slots left on this day. <button className="fore-link" onClick={toggleOpen}>Show all slots</button></p> : (
        <div className={`fore-sheet tees-${tees.length}`} ref={sheetBox}>
          <div className="fore-sheet-head">
            <span>Tee slot</span>
            {tees.map((t) => <span key={t}>{tees.length > 1 ? `From tee ${t}` : 'Flight'}</span>)}
          </div>
          {times.map((time, i) => {
            const nowHere = nowMin !== null && nowMin >= time && (i === times.length - 1 || nowMin < times[i + 1]);
            const cells = tees.map((t) => L.slots.find((s) => s.time === time && s.startTee === t)!);
            const past = cells.every((c) => c.state === 'past');
            return (
              <div key={time} className={`fore-row${past ? ' past' : ''}${nowHere ? ' now' : ''}`}>
                <div className="fore-time"><span>{formatTime(time).replace(/ (AM|PM)$/, '')}</span><small>{time < 720 ? 'am' : 'pm'}</small></div>
                {cells.map((c) => (onlyOpen && !bookableSlot(c)
                  ? <div key={c.startTee} className="fore-flight s-hidden" aria-hidden />
                  : <Flight key={c.startTee} c={c} onAdd={readOnly ? undefined : setAdding} onOpen={setOpen} />))}
              </div>
            );
          })}
        </div>
      )}
      {specialing ? <NewBooking courseId={courseId} special={{ day }} setup={setup} onClose={() => setSpecialing(false)} onDone={(made) => { after(); if (made) { setOpen(made); setJustMade(true); } }} /> : null}
      {adding ? <NewBooking courseId={courseId} cell={adding} setup={setup} onClose={() => setAdding(null)} onDone={(made) => { after(); if (made) { setOpen(made); setJustMade(true); } }} /> : null}
      {open ? <BookingPanel key={open.id} courseId={courseId} b={open} setup={setup} readOnly={readOnly} justMade={justMade} onClose={() => { setOpen(null); setJustMade(false); }} onDone={() => { setJustMade(false); after(); }} /> : null}
      {holding && L ? <HoldClose courseId={courseId} day={day} tees={tees} layoutId={L.layout.id} firstTee={times[0]} lastTee={times.at(-1)} onClose={() => setHolding(false)} onDone={after} /> : null}
    </>
  );
}

function Flight({ c, onAdd, onOpen }: { c: StaffSlot; onAdd?: (c: StaffSlot) => void; onOpen: (b: StaffBooking) => void }) {
  const bookable = !!onAdd && c.state !== 'past' && c.state !== 'closed' && c.free > 0;
  return (
    <div className={`fore-flight s-${c.state}${c.block ? ` k-${c.block.kind}` : ''}`}>
      {c.state === 'closed' ? <span className="fore-closed">{c.block?.reason ?? 'Closed'}</span> : <Balls capacity={c.capacity} used={c.used} />}
      <div className="fore-who">
        {c.bookings.map((b) => (
          <button key={b.id} className={`fore-golfer b-${isPencil(b, Date.now()) ? 'pencil' : b.status}`} onClick={() => onOpen(b)}>
            <span className="n">{b.contactName}</span>
            <span className="p">{b.players}</span>
            {isPencil(b, Date.now()) ? <span className="st">Pencil</span> : b.status !== 'confirmed' ? <span className="st">{STATUS_WORDS[b.status]}</span> : null}
          </button>
        ))}
        {c.state === 'held' && !c.bookings.length ? <span className="fore-held">{c.block?.reason ?? 'Held'}</span> : null}
      </div>
      {bookable ? <button className={`fore-book${c.state === 'held' ? ' held' : ''}`} onClick={() => onAdd?.(c)} aria-label={`Book ${formatTime(c.time)}, tee ${c.startTee}${c.state === 'held' ? ', held' : ''}`}>{c.state === 'held' ? 'Book held time' : 'Book'}</button> : null}
    </div>
  );
}

/** Scrolls the page so a row sits just under the frozen top (title, date strip, summary and column headings). */
function scrollUnderHeader(row: HTMLElement, head: HTMLElement | null) {
  let box: HTMLElement | null = row.parentElement;
  while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement;
  // Where the headings stop once frozen: their sticky top plus their height, from the top of the scrolling area.
  const frozen = (box ? box.getBoundingClientRect().top : 0) + (head ? (parseFloat(getComputedStyle(head).top) || 0) + head.offsetHeight : 0);
  const by = row.getBoundingClientRect().top - frozen;
  if (box) box.scrollTop += by; else window.scrollBy(0, by);
}

/**
 * Keeps a CSS variable on the page equal to an element's height, so the parts frozen below it (the day's
 * summary, the column headings) stick just under it as the tee sheet scrolls.
 */
function useStuckHeight(page: React.RefObject<HTMLDivElement | null>, name: string) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current, host = page.current;
    if (!el || !host) return;
    const set = () => host.style.setProperty(name, `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); host.style.setProperty(name, '0px'); };
  }, [page, name]);
  return ref as React.RefObject<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ---------------------------------------------------------------- week

interface HourCell { used: number; capacity: number; closed: boolean; event: boolean; held: boolean; past: boolean }

function WeekView({ courseId, weekStart, today, layoutId, onOpen, onSwipe }: { courseId: string; weekStart: string; today: string; layoutId: string; onOpen: (d: string) => void; onSwipe: (dir: 1 | -1) => void }) {
  const swipe = useSwipe(onSwipe);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const [sheets, setSheets] = useState<Record<string, SheetData>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const all = await Promise.all(days.map((d) => api<SheetReply>(`/courses/${courseId}/sheet?day=${d}`)));
      setSheets(Object.fromEntries(all.map((r, i) => [days[i], r as SheetData])));
      setProblem(null);
    } catch (e) { setProblem((e as Error).message); }
  }, [courseId, days]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30_000); return () => clearInterval(t); }, [load]);

  const slotsOf = (d: string) => sheets[d]?.layouts.find((l) => l.layout.id === layoutId)?.slots ?? [];
  const hours = [...new Set(days.flatMap((d) => slotsOf(d).map((s) => Math.floor(s.time / 60))))].sort((a, b) => a - b);
  const cell = (d: string, h: number): HourCell => {
    const ss = slotsOf(d).filter((s) => Math.floor(s.time / 60) === h);
    return {
      used: ss.reduce((n, s) => n + s.used, 0),
      capacity: ss.filter((s) => s.state !== 'closed').reduce((n, s) => n + s.capacity, 0),
      closed: ss.length > 0 && ss.every((s) => s.state === 'closed'),
      event: ss.length > 0 && ss.every((s) => s.state === 'closed' || s.state === 'past') && ss.some((s) => s.block?.kind === 'event'),
      held: ss.some((s) => s.state === 'held'),
      past: ss.length > 0 && ss.every((s) => s.state === 'past'),
    };
  };
  const loaded = Object.keys(sheets).length === 7;

  return (
    <>
      {problem ? <p className="fore-alert crit">{problem}</p> : null}
      <div className="fore-legend" aria-hidden>
        <span>Fewer players</span><i className="l0" /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" /><span>Full</span>
        <i className="held" /><span>Pencil hold</span><i className="event" /><span>Event</span><i className="closed" /><span>Closed</span>
      </div>
      {!loaded ? <p className="fore-empty">Loading the week…</p> : !hours.length ? <p className="fore-empty">No tee slots this week. Check the tee slots in Settings.</p> : (
        <div className="fore-week" {...swipe}>
          <div className="fore-wk-corner" />
          {days.map((d) => {
            const ss = slotsOf(d);
            const used = ss.reduce((n, s) => n + s.used, 0), cap = ss.filter((s) => s.state !== 'closed').reduce((n, s) => n + s.capacity, 0);
            const bks = ss.reduce((n, s) => n + s.bookings.length, 0);
            return (
              <button key={d} className={`fore-wk-day${d === today ? ' today' : ''}`} onClick={() => onOpen(d)}>
                <span className="dn">{SHORT.at(weekday(d))}</span>
                <span className="dd">{dateNum(d)}</span>
                <span className="dm">{bks} {bks === 1 ? 'booking' : 'bookings'}</span>
                <span className="fore-fill-bar"><span style={{ width: `${cap ? Math.round((used / cap) * 100) : 0}%` }} /></span>
              </button>
            );
          })}
          {hours.map((h) => (
            <div key={h} className="fore-wk-row">
              <div className="fore-wk-hour">{hourLabel(h)}</div>
              {days.map((d) => {
                const c = cell(d, h);
                const ratio = c.capacity ? c.used / c.capacity : 0;
                const level = c.used === 0 ? 0 : ratio < 0.34 ? 1 : ratio < 0.67 ? 2 : ratio < 1 ? 3 : 4;
                return (
                  <button key={d} className={`fore-wk-cell l${level}${c.event ? ' event' : c.closed ? ' closed' : c.held ? ' held' : ''}${c.past ? ' past' : ''}`} onClick={() => onOpen(d)}
                    aria-label={`${DAYS.at(weekday(d))} ${hourLabel(h)}: ${c.closed ? 'closed' : `${c.used} of ${c.capacity} players`}`}>
                    {c.event ? 'Event' : c.closed ? 'Closed' : c.capacity ? <><b>{c.used}</b><span>/{c.capacity}</span></> : ''}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Swipe left or right (touch, pen or a mouse drag) to move a week; a tap still works as a tap. */
function useSwipe(onSwipe: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current; start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => { start.current = null; },
  };
}

// ---------------------------------------------------------------- date strip

const BEFORE_WEEKS = 4, AFTER_WEEKS = 12;
const levelOf = (d: DaySummary | undefined) => {
  if (!d || !d.capacity) return 0;
  const r = d.used / d.capacity;
  return d.used === 0 ? 0 : r < 0.34 ? 1 : r < 0.67 ? 2 : r < 1 ? 3 : 4;
};

/**
 * A strip of days you can slide through, back into past weeks and months ahead, with how full each day
 * is. Drag it, swipe it or scroll it; tap a day to open it (or its week). The chosen day or week is marked.
 */
function DateStrip({ courseId, layoutId, day, today, view, onPick }: { courseId: string; layoutId: string; day: string; today: string; view: View; onPick: (d: string) => void }) {
  const [anchor, setAnchor] = useState(() => addDays(mondayOf(today), -7 * BEFORE_WEEKS));
  const end = addDays(anchor, 7 * (BEFORE_WEEKS + AFTER_WEEKS) - 1);
  const [summary, setSummary] = useState<Record<string, DaySummary>>({});
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  // Keep the chosen day inside the strip: re-centre when it goes near either end.
  useEffect(() => {
    if (day < addDays(anchor, 7) || day > addDays(end, -7)) setAnchor(addDays(mondayOf(day), -7 * BEFORE_WEEKS));
  }, [day, anchor, end]);

  useEffect(() => {
    let live = true;
    const load = () => api<DaySummary[]>(`/courses/${courseId}/days?from=${anchor}&to=${end}&layoutId=${layoutId}`)
      .then((r) => { if (live) setSummary(Object.fromEntries(r.map((d) => [d.day, d]))); }).catch(() => { /* the strip still works without numbers */ });
    void load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, [courseId, layoutId, anchor, end]);

  // Bring the chosen day into view.
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-day="${view === 'week' ? mondayOf(day) : day}"]`);
    if (!el || !strip.current) return;
    const box = strip.current;
    const want = el.offsetLeft - box.clientWidth / 2 + (view === 'week' ? el.offsetWidth * 3.5 : el.offsetWidth / 2);
    box.scrollTo({ left: want, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [day, view, anchor]);

  const weeks = Array.from({ length: BEFORE_WEEKS + AFTER_WEEKS }, (_, w) => addDays(anchor, w * 7));
  const chosenWeek = mondayOf(day);
  const by = (px: number) => strip.current?.scrollBy({ left: px, behavior: 'smooth' });
  const page = () => (strip.current?.clientWidth ?? 600) * 0.8;

  return (
    <div className="fore-strip-wrap">
      <button className="fore-strip-arrow" aria-label="Earlier dates" onClick={() => by(-page())}>‹</button>
      <div
        className="fore-strip"
        ref={strip}
        role="listbox"
        aria-label="Dates"
        onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && strip.current) strip.current.scrollLeft += e.deltaY; }}
        onPointerDown={(e) => { if (e.pointerType === 'mouse' && strip.current) drag.current = { x: e.clientX, left: strip.current.scrollLeft, moved: false }; }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !strip.current) return;
          if (Math.abs(e.clientX - d.x) > 4) { d.moved = true; strip.current.classList.add('dragging'); }
          strip.current.scrollLeft = d.left - (e.clientX - d.x);
        }}
        onPointerUp={() => { strip.current?.classList.remove('dragging'); setTimeout(() => { drag.current = null; }, 0); }}
        onPointerLeave={() => { strip.current?.classList.remove('dragging'); drag.current = null; }}
        onClickCapture={(e) => { if (drag.current?.moved) { e.stopPropagation(); e.preventDefault(); } }}
      >
        {weeks.map((w) => (
          <div key={w} className={`fore-strip-week${view === 'week' && w === chosenWeek ? ' on' : ''}`}>
            {Array.from({ length: 7 }, (_, i) => {
              const d = addDays(w, i);
              const sm = summary[d];
              const firstOfMonth = d.endsWith('-01') || (w === anchor && i === 0);
              return (
                <button
                  key={d}
                  data-day={d}
                  role="option"
                  aria-selected={view === 'day' ? d === day : w === chosenWeek}
                  className={['fore-strip-day', `l${levelOf(sm)}`, d === today ? 'today' : '', view === 'day' && d === day ? 'sel' : '', d < today ? 'past' : '', sm?.closed ? 'closed' : '', i >= 5 ? 'wkend' : ''].join(' ')}
                  onClick={() => onPick(d)}
                  aria-label={`${DAYS.at(weekday(d))} ${dateNum(d)} ${monthOf(d)}${sm ? `: ${sm.closed ? 'closed' : `${sm.used} of ${sm.capacity} players`}` : ''}`}
                >
                  {firstOfMonth ? <span className="mo">{monthOf(d).slice(0, 3)}</span> : null}
                  <span className="wd">{SHORT.at(weekday(d))!.slice(0, 2)}</span>
                  <span className="dn">{dateNum(d)}</span>
                  <span className="fill" aria-hidden><i style={{ width: `${sm?.capacity ? Math.max(sm.used ? 12 : 0, Math.round((sm.used / sm.capacity) * 100)) : 0}%` }} /></span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <button className="fore-strip-arrow" aria-label="Later dates" onClick={() => by(page())}>›</button>
    </div>
  );
}

// ---------------------------------------------------------------- month calendar

function MonthPicker({ value, today, onPick, onClose }: { value: string; today: string; onPick: (d: string) => void; onClose: () => void }) {
  const [month, setMonth] = useState(value.slice(0, 7));
  const first = `${month}-01`;
  const start = mondayOf(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const shift = (n: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.fore-cal-btn')) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  return (
    <div className="fore-month" ref={ref} role="dialog" aria-label="Pick a day">
      <div className="fore-month-head">
        <button aria-label="Month before" onClick={() => shift(-1)}>‹</button>
        <b>{monthOf(first)} {first.slice(0, 4)}</b>
        <button aria-label="Next month" onClick={() => shift(1)}>›</button>
      </div>
      <div className="fore-month-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="wd">{d.slice(0, 2)}</span>)}
        {cells.map((d) => (
          <button key={d} className={[d.slice(0, 7) !== month ? 'out' : '', d === today ? 'today' : '', d === value ? 'sel' : ''].join(' ')} onClick={() => onPick(d)}>{dateNum(d)}</button>
        ))}
      </div>
      <button className="fore-month-today" onClick={() => onPick(today)}>Go to today</button>
    </div>
  );
}

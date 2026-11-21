import { useState, type ReactNode } from 'react';
import { Area, Btn, Check, Field, Seg, Select } from '@maison/core/ui/kit';
import {
  formatTime, localParts, type BookingRules, type CourseOptions, type Fee, type FeeAmount, type Layout, type PaidTo, type PlayerType, type Rate, type SheetSettings,
} from '@maison/engine';
import { api, type CourseData } from '../api';

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const toPeso = (c: number | undefined | null) => (c === undefined || c === null ? '' : String(c / 100));
const toCentavos = (s: string) => Math.round(Number(s.replace(/[₱,\s]/g, '')) * 100);
const isAmount = (s: string) => s.trim() !== '' && Number.isFinite(Number(s.replace(/[₱,\s]/g, '')));
const key = () => `n${Math.random().toString(36).slice(2, 12)}`;
const DAY_LETTERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Pane = 'course' | 'teetimes' | 'players' | 'fees' | 'rules' | 'holidays';
const PANES: { id: Pane; label: string; sub: string }[] = [
  { id: 'teetimes', label: 'Courses and tee times', sub: 'Each course (9 or 18 holes), its tee times and interval' },
  { id: 'players', label: 'Players and green fees', sub: 'Local, foreign, senior… 9 and 18 holes' },
  { id: 'fees', label: 'Carts, caddies and fees', sub: 'Golf cart, caddie, insurance, rentals and more' },
  { id: 'rules', label: 'Booking rules', sub: 'How far ahead, cancelling, holds' },
  { id: 'holidays', label: 'Holidays', sub: 'Days that use holiday rates' },
  { id: 'course', label: 'Course page', sub: 'What golfers see in the app' },
];

/** Settings: everything the owner and managers can change about how the course books and charges. */
export function Settings({ data, reload }: { data: CourseData; reload: () => Promise<void> }) {
  const [pane, setPane] = useState<Pane>(() => { try { return (localStorage.getItem('fore.settings') as Pane) || 'teetimes'; } catch { return 'teetimes'; } });
  const go = (p: Pane) => { setPane(p); try { localStorage.setItem('fore.settings', p); } catch { /* private window */ } };
  const props = { data, reload };
  return (
    <div className="fore-settings">
      <nav className="fore-set-nav" aria-label="Settings">
        <h1>Settings</h1>
        {PANES.map((p) => (
          <button key={p.id} className={pane === p.id ? 'on' : ''} aria-current={pane === p.id ? 'page' : undefined} onClick={() => go(p.id)}>
            <b>{p.label}</b><span>{p.sub}</span>
          </button>
        ))}
      </nav>
      <div className="fore-set-body">
        {pane === 'course' ? <CoursePane {...props} key={data.course.id} /> : null}
        {pane === 'teetimes' ? <TeeTimesPane {...props} /> : null}
        {pane === 'players' ? <PlayersPane {...props} /> : null}
        {pane === 'fees' ? <FeesPane {...props} /> : null}
        {pane === 'rules' ? <RulesPane {...props} /> : null}
        {pane === 'holidays' ? <HolidaysPane {...props} /> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shared

function useSave(reload: () => Promise<void>) {
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (calls: [string, unknown][]) => {
    setBusy(true); setMsg(null);
    try {
      for (const [path, body] of calls) await api(path, { method: 'PUT', body });
      await reload();
      setMsg({ text: 'Saved.', ok: true });
    } catch (e) { setMsg({ text: (e as Error).message }); } finally { setBusy(false); }
  };
  return { run, busy, msg };
}

function PaneHead({ title, sub }: { title: string; sub: ReactNode }) {
  return <header className="fore-set-head"><h2>{title}</h2><p>{sub}</p></header>;
}

function SaveBar({ label, busy, msg, onSave, extra }: { label: string; busy: boolean; msg: { text: string; ok?: boolean } | null; onSave: () => void; extra?: ReactNode }) {
  return (
    <div className="fore-savebar">
      {extra}
      {msg ? <span className={msg.ok ? 'ok' : 'bad'} role="status">{msg.text}</span> : null}
      <Btn kind="primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : label}</Btn>
    </div>
  );
}

function Money({ value, onChange, placeholder, label, caption }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string; caption?: string }) {
  return (
    <label className="fore-money">
      {caption ? <span className="cap" aria-hidden>{caption}</span> : null}
      <i aria-hidden>₱</i>
      <input inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </label>
  );
}

// ---------------------------------------------------------------- course page

function CoursePane({ data, reload }: { data: CourseData; reload: () => Promise<void> }) {
  const c = data.course;
  const [f, setF] = useState({ name: c.name, address: c.address, city: c.city, province: c.province, phone: c.phone, email: c.email, description: c.description, facilities: c.facilities.join(', ') });
  const { run, busy, msg } = useSave(reload);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <section>
      <PaneHead title="Course page" sub="What golfers see about your course in the MaisonFore app." />
      <div className="fore-panel">
        <Field label="Course name" value={f.name} onChange={set('name')} />
        <div className="grid fore-2"><Field label="Street address" value={f.address} onChange={set('address')} /><Field label="Phone for bookings" value={f.phone} onChange={set('phone')} /></div>
        <div className="grid fore-2"><Field label="City or town" value={f.city} onChange={set('city')} /><Field label="Province" value={f.province} onChange={set('province')} /></div>
        <Field label="Email for bookings" value={f.email} onChange={set('email')} />
        <Area label="Description" value={f.description} onChange={set('description')} placeholder="The course in a few lines: holes, terrain, what makes it worth the trip." />
        <Field label="Facilities" value={f.facilities} onChange={set('facilities')} hint="Separate with commas, e.g. Driving range, Restaurant, Pro shop, Locker rooms." />
      </div>
      <SaveBar label="Save course page" busy={busy} msg={msg} onSave={() => void run([[`/courses/${c.id}`, { ...f, facilities: f.facilities.split(',').map((x) => x.trim()).filter(Boolean) }]])} />
    </section>
  );
}

// ---------------------------------------------------------------- tee times

interface LayoutForm { id: string; name: string; holes: Layout['holes']; twoTee: boolean; active: boolean; first: string; last: string; interval: string; players: string; isNew: boolean }

function TeeTimesPane({ data, reload }: { data: CourseData; reload: () => Promise<void> }) {
  const s = data.setup;
  const today = localParts(Date.now(), s.timeZone).day;
  const currentOf = (l: Layout) => [...s.settings].filter((x) => x.layoutId === l.id && x.effectiveFrom <= today).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
    ?? [...s.settings].filter((x) => x.layoutId === l.id).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  const upcoming = s.settings.filter((x) => x.effectiveFrom > today);
  const [rows, setRows] = useState<LayoutForm[]>(() => s.layouts.map((l) => {
    const cur = currentOf(l);
    return { id: l.id, name: l.name, holes: l.holes, twoTee: l.startTees.length > 1, active: l.active, first: toTime(cur?.firstTee ?? 360), last: toTime(cur?.lastTee ?? 840), interval: String(cur?.interval ?? 8), players: String(cur?.maxPlayers ?? 4), isNew: false };
  }));
  const [from, setFrom] = useState(today);
  const [nine, setNine] = useState(s.options.nineHoles);
  const { run, busy, msg } = useSave(reload);
  const upd = (i: number, p: Partial<LayoutForm>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const count = (r: LayoutForm) => Math.max(0, Math.floor((toMin(r.last) - toMin(r.first)) / Math.max(1, Number(r.interval) || 1)) + 1) * (r.twoTee ? 2 : 1);

  const save = () => {
    const layouts: Layout[] = rows.map((r) => ({ id: r.id, name: r.name, holes: r.holes, startTees: r.twoTee ? ['1', '10'] : ['1'], active: r.active }));
    const settings: SheetSettings[] = rows.map((r) => ({ layoutId: r.id, effectiveFrom: from, firstTee: toMin(r.first), lastTee: toMin(r.last), interval: Number(r.interval), maxPlayers: Number(r.players) }));
    void run([[`/courses/${data.course.id}/teetimes`, { layouts, settings }], [`/courses/${data.course.id}/options`, { ...s.options, nineHoles: nine }]]);
  };

  return (
    <section>
      <PaneHead title="Courses and tee times" sub="Each course at your club has its own tee sheet. Changes start from the date you choose; bookings already made keep their times." />
      {upcoming.length ? <p className="fore-note">Tee-time changes already set to start later: {upcoming.map((u) => `${s.layouts.find((l) => l.id === u.layoutId)?.name ?? 'Course'} from ${u.effectiveFrom}`).join('; ')}.</p> : null}
      {rows.map((r, i) => (
        <div key={r.id} className={`fore-panel fore-layout${r.active ? '' : ' off'}`}>
          <div className="fore-layout-head">
            <Field label="Course name" value={r.name} onChange={(v) => upd(i, { name: v })} placeholder="e.g. North course, Championship course" />
            <Check label="Open for booking" value={r.active} onChange={(v) => upd(i, { active: v })} />
          </div>
          <div className="fore-layout-opts">
            <div><span className="fore-lbl">Holes</span><Seg value={String(r.holes)} onChange={(v) => upd(i, { holes: Number(v) as Layout['holes'] })} options={[{ value: '9', label: '9 holes' }, { value: '18', label: '18 holes' }]} /></div>
            <div><span className="fore-lbl">Flights start from</span><Seg value={r.twoTee ? '2' : '1'} onChange={(v) => upd(i, { twoTee: v === '2' })} options={[{ value: '1', label: '1st tee' }, { value: '2', label: '1st and 10th tees' }]} /></div>
          </div>
          <div className="grid fore-4">
            <Field label="First tee time" type="time" value={r.first} onChange={(v) => upd(i, { first: v })} />
            <Field label="Last tee time" type="time" value={r.last} onChange={(v) => upd(i, { last: v })} />
            <Select label="Minutes between flights" value={r.interval} onChange={(v) => upd(i, { interval: v })} options={INTERVALS} />
            <Select label="Players per flight" value={r.players} onChange={(v) => upd(i, { players: v })} options={['1', '2', '3', '4', '5'].map((n) => ({ value: n, label: `${n} ${n === '1' ? 'player' : 'players'}` }))} />
          </div>
          <p className="fore-preview">{count(r)} tee times a day, {formatTime(toMin(r.first))} to {formatTime(toMin(r.last))}{r.twoTee ? ', from both tees' : ''}.</p>
        </div>
      ))}
      <div className="fore-panel fore-inline">
        <Btn onClick={() => setRows([...rows, { id: key(), name: '', holes: 18, twoTee: false, active: true, first: '06:00', last: '14:00', interval: '8', players: '4', isNew: true }])}>Add another course</Btn>
        <span className="muted small">For clubs with more than one course. Each gets its own tee sheet, holes and tee times.</span>
      </div>
      <div className="fore-panel">
        <Check label="Golfers can book 9 holes on 18-hole courses" hint="Set 9-hole green fees under Players and green fees." value={nine} onChange={setNine} />
        <Field label="Changes start from" type="date" value={from} onChange={setFrom} hint="Days before this keep their current tee times." />
      </div>
      <SaveBar label="Save tee times" busy={busy} msg={msg} onSave={save} />
    </section>
  );
}

// ---------------------------------------------------------------- players and green fees

const INTERVALS = Array.from({ length: 27 }, (_, i) => String(i + 4)).map((n) => ({ value: n, label: `${n} minutes` }));
const TYPE_IDEAS: { name: string; days?: number[]; earliest?: number }[] = [
  { name: 'Senior' }, { name: 'Junior', earliest: 660 }, { name: 'Member’s guest' }, { name: 'Resident' }, { name: 'Student' },
];
/** Military and government clubs price by service status. */
const MILITARY = ['Active uniformed personnel', 'Retired military', 'Military dependent', 'Civilian guest'];
type Holes = '18' | '9' | 'twi';
const DT = ['weekday', 'weekend', 'holiday'] as const;

function PlayersPane({ data, reload }: { data: CourseData; reload: () => Promise<void> }) {
  const s = data.setup;
  const today = localParts(Date.now(), s.timeZone).day;
  const latest = (t: string, dt: string, holes: number, band: string) => s.rates.filter((r) => r.playerTypeId === t && r.dayType === dt && r.holes === holes && r.band === band && r.effectiveFrom <= today)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.amount;
  const [types, setTypes] = useState<(PlayerType & { earliestText: string })[]>(() => s.playerTypes.filter((p) => !p.member).map((p) => ({ ...p, earliestText: p.earliest === null ? '' : toTime(p.earliest) })));
  const cell = (t: string, h: Holes, dt: string) => `${t}|${h}|${dt}`;
  const [grid, setGrid] = useState<Record<string, string>>(() => {
    const g: Record<string, string> = {};
    for (const p of s.playerTypes) for (const dt of DT) {
      g[cell(p.id, '18', dt)] = toPeso(latest(p.id, dt, 18, 'regular'));
      g[cell(p.id, '9', dt)] = toPeso(latest(p.id, dt, 9, 'regular'));
      g[cell(p.id, 'twi', dt)] = toPeso(latest(p.id, dt, 18, 'twilight'));
    }
    return g;
  });
  const [holes, setHoles] = useState<Holes>('18');
  const [twilight, setTwilight] = useState(s.rules.twilightFrom === null ? '' : toTime(s.rules.twilightFrom));
  const [from, setFrom] = useState(today);
  const { run, busy, msg } = useSave(reload);
  const nine = s.options.nineHoles || s.layouts.some((l) => l.holes === 9);
  const upd = (i: number, p: Partial<PlayerType & { earliestText: string }>) => setTypes(types.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const fresh = (idea?: (typeof TYPE_IDEAS)[number]) => ({
    id: key(), name: idea?.name ?? '', public: true, member: false, proof: '', days: idea?.days ?? [], earliest: idea?.earliest ?? null,
    earliestText: idea?.earliest ? toTime(idea.earliest) : '', active: true,
  });
  const add = (idea?: (typeof TYPE_IDEAS)[number]) => setTypes([...types, fresh(idea)]);
  const missingMilitary = MILITARY.filter((m) => !types.some((t) => t.name.toLowerCase() === m.toLowerCase()));

  const save = () => {
    const rates: Rate[] = [];
    for (const t of types) for (const dt of DT) for (const h of ['18', '9', 'twi'] as Holes[]) {
      const v = grid[cell(t.id, h, dt)] ?? '';
      if (isAmount(v)) rates.push({ playerTypeId: t.id, dayType: dt, holes: h === '9' ? 9 : 18, band: h === 'twi' ? 'twilight' : 'regular', effectiveFrom: from, amount: toCentavos(v) });
    }
    const playerTypes = types.map(({ earliestText, ...t }) => ({ ...t, earliest: earliestText ? toMin(earliestText) : null }));
    const rules: BookingRules = { ...s.rules, twilightFrom: twilight ? toMin(twilight) : null };
    void run([[`/courses/${data.course.id}/rates`, { playerTypes, rates }], [`/courses/${data.course.id}/rules`, rules]]);
  };
  const tabs = [{ value: '18' as Holes, label: '18 holes' }, ...(nine ? [{ value: '9' as Holes, label: '9 holes' }] : []), ...(twilight ? [{ value: 'twi' as Holes, label: `Twilight, from ${formatTime(toMin(twilight))}` }] : [])];
  const unused = TYPE_IDEAS.filter((x) => !types.some((t) => t.name.toLowerCase() === x.name.toLowerCase()));

  return (
    <section>
      <PaneHead title="Players and green fees" sub="Each kind of golfer pays their own green fee: local, foreign, senior, uniformed personnel… Staff pick the type for each player when booking. In the app, golfers are checked as local or foreign when they register." />
      <div className="fore-panel flush">
        <div className="fore-types" role="table" aria-label="Player types">
          <div className="fore-types-row head" role="row">
            <span role="columnheader">Player type</span><span role="columnheader">Plays on</span><span role="columnheader">From</span><span role="columnheader">In the app</span><span role="columnheader">On</span>
          </div>
          {types.map((t, i) => (
            <div key={t.id} className={`fore-types-row${t.active ? '' : ' off'}`} role="row">
              <input aria-label="Player type name" value={t.name} placeholder="e.g. Senior" onChange={(e) => upd(i, { name: e.target.value })} />
              <div className="fore-days" role="group" aria-label={`Days ${t.name} can play`}>
                {DAY_LETTERS.map((d, n) => {
                  const on = !t.days.length || t.days.includes(n);
                  return <button key={d} aria-pressed={on} className={on ? 'on' : ''} title={d} onClick={() => {
                    const all = t.days.length ? t.days : [0, 1, 2, 3, 4, 5, 6];
                    const next = on ? all.filter((x) => x !== n) : [...all, n].sort();
                    if (next.length) upd(i, { days: next.length === 7 ? [] : next });
                  }}>{d.slice(0, 2)}</button>;
                })}
              </div>
              <label className="fore-cell"><span className="cap">Tee times from</span><input type="time" aria-label={`Earliest tee time for ${t.name}`} value={t.earliestText} onChange={(e) => upd(i, { earliestText: e.target.value })} /></label>
              <label className="fore-cell tick"><input type="checkbox" aria-label={`${t.name} can book in the app`} checked={t.public} onChange={(e) => upd(i, { public: e.target.checked })} /><span className="cap">In the app</span></label>
              <label className="fore-cell tick"><input type="checkbox" aria-label={`${t.name} is on`} checked={t.active} onChange={(e) => upd(i, { active: e.target.checked })} /><span className="cap">On</span></label>
            </div>
          ))}
        </div>
        <div className="fore-ideas">
          <Btn size="sm" onClick={() => add()}>Add player type</Btn>
          {unused.map((x) => <button key={x.name} className="fore-idea" onClick={() => add(x)}>+ {x.name}</button>)}
          {missingMilitary.length ? <button className="fore-idea" onClick={() => setTypes([...types, ...missingMilitary.map((name) => fresh({ name }))])}>+ Military club set: {missingMilitary.join(', ')}</button> : null}
        </div>
      </div>

      <div className="fore-panel">
        <div className="fore-rates-top">
          <h3>Green fees, per player</h3>
          <Seg value={tabs.some((t) => t.value === holes) ? holes : '18'} onChange={setHoles} options={tabs} />
        </div>
        <div className="fore-rates" role="table" aria-label="Green fees">
          <div className="fore-rates-row head" role="row"><span role="columnheader" /><span role="columnheader">Weekday</span><span role="columnheader">Weekend</span><span role="columnheader">Holiday</span></div>
          {types.filter((t) => t.active).map((t) => (
            <div key={t.id} className="fore-rates-row" role="row">
              <span role="rowheader"><b>{t.name || 'New type'}</b>{t.days.length ? <small>{t.days.map((d) => DAY_LETTERS[d]).join(', ')} only</small> : null}</span>
              {DT.map((dt) => (
                <Money key={dt} caption={dt.charAt(0).toUpperCase() + dt.slice(1)} label={`${t.name} ${dt} ${holes}`} value={grid[cell(t.id, holes, dt)] ?? ''} onChange={(v) => setGrid({ ...grid, [cell(t.id, holes, dt)]: v })}
                  placeholder={dt === 'holiday' ? 'Weekend' : holes === 'twi' ? 'Regular' : ''} />
              ))}
            </div>
          ))}
        </div>
        <p className="muted small">Empty holiday fees use the weekend fee. Empty twilight fees use the regular fee. Fees are per player and don’t include carts, caddies or other fees.</p>
        <div className="grid fore-2">
          <Field label="Twilight fees from" type="time" value={twilight} onChange={setTwilight} hint="Leave empty if you don’t have twilight fees." />
          <Field label="New fees start from" type="date" value={from} onChange={setFrom} hint="Bookings made before keep their price." />
        </div>
      </div>
      <SaveBar label="Save players and green fees" busy={busy} msg={msg} onSave={save} />
    </section>
  );
}

// ---------------------------------------------------------------- carts, caddies and fees

type Policy = 'none' | 'optional' | 'required';
interface FeeForm extends Fee { split: boolean; grid: Record<string, string> }
const COLS: [9 | 18, 'weekday' | 'weekend'][] = [[18, 'weekday'], [18, 'weekend'], [9, 'weekday'], [9, 'weekend']];
const OTHER_IDEAS: { name: string; required: boolean; per?: Fee['per'] }[] = [
  { name: 'Insurance', required: true }, { name: 'Contingency fee', required: true }, { name: 'Registration fee', required: true },
  { name: 'Development fee', required: true }, { name: 'Locker rental', required: false }, { name: 'Golf club rental', required: false },
  { name: 'Golf bag storage', required: false }, { name: 'Food consumable', required: false },
];

const gridOf = (amounts: FeeAmount[]) => Object.fromEntries(amounts.map((a) => [`${a.playerTypeId ?? '*'}|${a.holes}|${a.dayType}`, toPeso(a.amount)]));
const blankFee = (kind: Fee['kind'], name: string): FeeForm => ({
  id: key(), name, kind, per: kind === 'cart' ? 'cart' : kind === 'gallery' ? 'guest' : 'player', required: kind === 'caddie', paidTo: kind === 'caddie' ? 'direct' : 'booking', active: false, amounts: [], split: false, grid: {},
});

function FeesPane({ data, reload }: { data: CourseData; reload: () => Promise<void> }) {
  const s = data.setup;
  const types = s.playerTypes.filter((t) => t.active && !t.member);
  const nine = s.options.nineHoles || s.layouts.some((l) => l.holes === 9);
  const [fees, setFees] = useState<FeeForm[]>(() => {
    const all = s.fees.map((f) => ({ ...f, split: f.amounts.some((a) => a.playerTypeId !== null), grid: gridOf(f.amounts) }));
    for (const [kind, name] of [['cart', 'Golf cart'], ['caddie', 'Caddie'], ['gallery', 'Gallery']] as const) if (!all.some((f) => f.kind === kind)) all.push(blankFee(kind, name));
    return all;
  });
  const [opts, setOpts] = useState<CourseOptions>(s.options);
  const { run, busy, msg } = useSave(reload);
  const upd = (id: string, p: Partial<FeeForm>) => setFees(fees.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const one = (kind: Fee['kind']) => fees.find((f) => f.kind === kind)!;

  const save = () => {
    const out = fees.filter((f) => f.kind !== 'other' || f.name.trim()).map(({ split, grid, ...f }) => {
      const amounts: FeeAmount[] = [];
      for (const [k, v] of Object.entries(grid)) {
        const [t, h, dt] = k.split('|');
        if ((split ? t !== '*' : t === '*') && isAmount(v)) amounts.push({ holes: Number(h) as 9 | 18, dayType: dt as 'weekday' | 'weekend', playerTypeId: t === '*' ? null : t, amount: toCentavos(v) });
      }
      return { ...f, amounts };
    }).filter((f) => f.kind === 'other' || f.active || f.amounts.length);
    void run([[`/courses/${data.course.id}/fees`, { fees: out }], [`/courses/${data.course.id}/options`, opts]]);
  };

  const policyOf = (f: FeeForm): Policy => (!f.active ? 'none' : f.required ? 'required' : 'optional');
  const setPolicy = (f: FeeForm, p: Policy) => upd(f.id, { active: p !== 'none', required: p === 'required' });

  return (
    <section>
      <PaneHead title="Carts, caddies and fees" sub="What golfers pay on top of the green fee. Each booking shows the full price line by line, and keeps it if you change a fee later." />

      <FeeCard f={one('cart')} title="Golf cart" policy={policyOf(one('cart'))} onPolicy={(p) => setPolicy(one('cart'), p)} upd={upd} types={types} nine={nine}
        sub={policyOf(one('cart')) === 'required' ? 'Required: every flight must use carts, and enough carts for all its players are charged.' : policyOf(one('cart')) === 'optional' ? 'Optional: golfers can walk or rent a cart. Charged per cart.' : 'The course has no carts for rent.'}
        policies={[['none', 'No carts'], ['optional', 'Optional'], ['required', 'Required']]}>
        <div className="fore-inline">
          <span className="fore-lbl">Players per cart</span>
          <Seg value={String(opts.cartSeats)} onChange={(v) => setOpts({ ...opts, cartSeats: Number(v) })} options={[{ value: '1', label: '1, solo' }, { value: '2', label: '2, twin sharing' }]} />
        </div>
      </FeeCard>

      <FeeCard f={one('caddie')} title="Caddie" sub={one('caddie').active ? 'One caddie for every player.' : 'Players go without caddies.'} policy={one('caddie').active ? 'required' : 'none'}
        onPolicy={(p) => setPolicy(one('caddie'), p)} upd={upd} types={types} nine={nine} policies={[['none', 'No caddies'], ['required', 'With caddie']]} />

      <FeeCard f={one('gallery')} title="Gallery" sub="Non-playing guests who walk or ride with the flight, charged per guest." policy={opts.galleryMax === 0 ? 'none' : 'optional'}
        onPolicy={(p) => { setOpts({ ...opts, galleryMax: p === 'none' ? 0 : Math.max(1, opts.galleryMax) }); setPolicy(one('gallery'), p === 'none' ? 'none' : 'optional'); }}
        upd={upd} types={types} nine={nine} policies={[['none', 'No gallery'], ['optional', 'Allowed']]}>
        {opts.galleryMax > 0 ? (
          <div className="fore-inline"><span className="fore-lbl">Most gallery guests per booking</span><Seg value={String(opts.galleryMax)} onChange={(v) => setOpts({ ...opts, galleryMax: Number(v) })} options={['1', '2', '3', '4'].map((n) => ({ value: n, label: n }))} /></div>
        ) : null}
      </FeeCard>

      <h3 className="fore-set-sub">Other fees</h3>
      {fees.filter((f) => f.kind === 'other').map((f) => (
        <FeeCard key={f.id} f={f} title={null} sub="" policy={policyOf(f)} onPolicy={(p) => setPolicy(f, p)} upd={upd} types={types} nine={nine}
          policies={[['optional', 'Golfers choose'], ['required', 'Always charged'], ['none', 'Switched off']]}
          remove={() => setFees(fees.filter((x) => x.id !== f.id))} />
      ))}
      <div className="fore-ideas">
        <Btn size="sm" onClick={() => setFees([...fees, { ...blankFee('other', ''), active: true }])}>Add a fee</Btn>
        {OTHER_IDEAS.filter((n) => !fees.some((f) => f.name.toLowerCase() === n.name.toLowerCase())).map((n) => (
          <button key={n.name} className="fore-idea" onClick={() => setFees([...fees, { ...blankFee('other', n.name), active: true, required: n.required }])}>+ {n.name}</button>
        ))}
      </div>
      <SaveBar label="Save carts, caddies and fees" busy={busy} msg={msg} onSave={save} />
    </section>
  );
}

function FeeCard({ f, title, sub, policy, onPolicy, policies, upd, types, nine, children, remove }: {
  f: FeeForm; title: string | null; sub: string; policy: Policy; onPolicy: (p: Policy) => void; policies: [Policy, string][];
  upd: (id: string, p: Partial<FeeForm>) => void; types: PlayerType[]; nine: boolean; children?: ReactNode; remove?: () => void;
}) {
  const on = policy !== 'none';
  const rows: { id: string; label: string }[] = f.split ? types.map((t) => ({ id: t.id, label: t.name })) : [{ id: '*', label: '' }];
  const cols = COLS.filter(([h]) => nine || h === 18);
  return (
    <div className={`fore-panel fore-fee${on ? '' : ' off'}`}>
      <div className="fore-fee-head">
        <div className="grow">
          {title ? <h3>{title}</h3> : <input className="fore-fee-name" aria-label="Fee name" value={f.name} placeholder="Fee name, e.g. Locker" onChange={(e) => upd(f.id, { name: e.target.value })} />}
          {sub ? <p className="muted small">{sub}</p> : null}
        </div>
        <Seg value={policy} onChange={onPolicy} options={policies.map(([value, label]) => ({ value, label }))} />
      </div>
      {on ? (
        <>
          {children}
          <div className="fore-fee-opts">
            {f.kind === 'other' ? <div className="fore-inline"><span className="fore-lbl">Charged</span><Seg value={f.per} onChange={(v) => upd(f.id, { per: v })} options={[{ value: 'player', label: 'Per player' }, { value: 'booking', label: 'Once per booking' }]} /></div> : null}
            <div className="fore-inline"><span className="fore-lbl">Paid</span><Seg<PaidTo> value={f.paidTo} onChange={(v) => upd(f.id, { paidTo: v })} options={[
              { value: 'booking', label: 'With the booking' }, { value: 'counter', label: 'Separately at the counter' }, ...(f.kind === 'caddie' ? [{ value: 'direct' as const, label: 'Direct to the caddie' }] : [])]} /></div>
            {f.per === 'player' && types.length > 1 ? <Check label="Different amount for each player type" value={f.split} onChange={(v) => upd(f.id, { split: v })} /> : null}
          </div>
          <div className={`fore-amounts cols-${cols.length}${f.split ? ' split' : ''}`} role="table" aria-label={`${f.name} amounts`}>
            <div className="fore-amounts-row head" role="row"><span />{cols.map(([h, dt]) => <span key={`${h}${dt}`} role="columnheader">{h} holes, {dt}</span>)}</div>
            {rows.map((r) => (
              <div key={r.id} className="fore-amounts-row" role="row">
                <span role="rowheader">{r.label}</span>
                {cols.map(([h, dt]) => {
                  const k = `${r.id}|${h}|${dt}`;
                  return <Money key={k} caption={`${h} holes, ${dt}`} label={`${f.name} ${r.label} ${h} holes ${dt}`} value={f.grid[k] ?? ''} onChange={(v) => upd(f.id, { grid: { ...f.grid, [k]: v } })}
                    placeholder={dt === 'weekend' ? 'Weekday' : h === 9 ? '18 holes' : ''} />;
                })}
              </div>
            ))}
          </div>
          {f.paidTo === 'direct' ? <p className="fore-note">Golfers pay the caddie directly. Enter the minimum caddie fee; golfers see it as “at least” this amount.</p> : null}
          <p className="muted small">Empty weekend amounts use the weekday amount; empty 9-hole amounts use the 18-hole one. Holidays use weekend amounts.{f.split ? ' Player types left empty pay nothing.' : ''}</p>
        </>
      ) : null}
      {remove ? <button className="fore-remove" onClick={remove}>Remove this fee</button> : null}
    </div>
  );
}

// ---------------------------------------------------------------- booking rules

function RulesPane({ data, reload }: { data: CourseData; reload: () => Promise<void> }) {
  const r = data.setup.rules;
  const [f, setF] = useState({ ...r, releaseTimeText: toTime(r.releaseTime) });
  const { run, busy, msg } = useSave(reload);
  const num = (k: keyof BookingRules) => (v: string) => setF({ ...f, [k]: v === '' ? '' : Number(v.replace(/\D/g, '')) });
  const item = (label: string, hint: string, field: ReactNode) => <div className="fore-rule"><div><b>{label}</b><span>{hint}</span></div>{field}</div>;
  return (
    <section>
      <PaneHead title="Booking rules" sub="What golfers can do in the app. Staff can always book, move and cancel from the tee sheet." />
      <div className="fore-panel flush">
        {item('Book ahead', 'How many days ahead golfers can book.', <Field label="Days" inputMode="numeric" value={String(f.publicDaysAhead)} onChange={num('publicDaysAhead')} sm />)}
        {item('New day opens', 'The time each new day opens for booking.', <Field label="Time" type="time" value={f.releaseTimeText} onChange={(v) => setF({ ...f, releaseTimeText: v })} sm />)}
        {item('Cancel or move', 'Golfers can cancel or move up to this many hours before their tee time.', <Field label="Hours before" inputMode="numeric" value={String(f.cancelCutoffHours)} onChange={num('cancelCutoffHours')} sm />)}
        {item('Players per booking', 'Most players in one app booking.', <Field label="Players" inputMode="numeric" value={String(f.maxPlayersPerBooking)} onChange={num('maxPlayersPerBooking')} sm />)}
        {item('Open bookings', 'Most upcoming bookings one golfer can have.', <Field label="Bookings" inputMode="numeric" value={String(f.maxOpenBookingsPerGolfer)} onChange={num('maxOpenBookingsPerGolfer')} sm />)}
        {item('Time to pay', 'Minutes a tee time is held while the golfer pays.', <Field label="Minutes" inputMode="numeric" value={String(f.holdMinutes)} onChange={num('holdMinutes')} sm />)}
        {item('No-shows', 'No-shows in 90 days before a golfer can’t book in the app. 0 = never.', <Field label="No-shows" inputMode="numeric" value={String(f.noShowLimit)} onChange={num('noShowLimit')} sm />)}
      </div>
      <SaveBar label="Save booking rules" busy={busy} msg={msg} onSave={() => void run([[`/courses/${data.course.id}/rules`, { ...f, releaseTime: toMin(f.releaseTimeText) }]])} />
    </section>
  );
}

// ---------------------------------------------------------------- holidays

/** Philippine holidays on the same date every year. Holy Week and other moving holidays change by proclamation. */
const FIXED: [string, string][] = [
  ['01-01', 'New Year’s Day'], ['04-09', 'Araw ng Kagitingan'], ['05-01', 'Labor Day'], ['06-12', 'Independence Day'], ['08-21', 'Ninoy Aquino Day'],
  ['11-01', 'All Saints’ Day'], ['11-30', 'Bonifacio Day'], ['12-08', 'Immaculate Conception'], ['12-24', 'Christmas Eve'], ['12-25', 'Christmas Day'],
  ['12-30', 'Rizal Day'], ['12-31', 'Last day of the year'],
];

function HolidaysPane({ data, reload }: { data: CourseData; reload: () => Promise<void> }) {
  const today = localParts(Date.now(), data.setup.timeZone).day;
  const [rows, setRows] = useState(() => data.setup.holidays.map((d) => ({ day: d, name: data.holidayNames?.[d] ?? '' })));
  const { run, busy, msg } = useSave(reload);
  const year = Number(today.slice(0, 4)) + (today.slice(5) > '11-01' ? 1 : 0);
  const addYear = () => {
    const have = new Set(rows.map((r) => r.day));
    setRows([...rows, ...FIXED.map(([md, name]) => ({ day: `${year}-${md}`, name })).filter((r) => !have.has(r.day))].sort((a, b) => a.day.localeCompare(b.day)));
  };
  const shown = rows.filter((r) => r.day >= today.slice(0, 4) || !r.day);
  return (
    <section>
      <PaneHead title="Holidays" sub="Days charged at holiday green fees (or weekend fees where no holiday fee is set)." />
      <div className="fore-panel flush">
        {shown.length ? shown.map((r) => {
          const i = rows.indexOf(r);
          return (
            <div key={i} className="fore-holiday">
              <input type="date" aria-label="Holiday date" value={r.day} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)))} />
              <input aria-label="Holiday name" value={r.name} placeholder="Name" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <button className="fore-remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
            </div>
          );
        }) : <p className="fore-empty-line">No holidays yet.</p>}
        <div className="fore-ideas">
          <Btn size="sm" onClick={() => setRows([...rows, { day: '', name: '' }])}>Add a holiday</Btn>
          <button className="fore-idea" onClick={addYear}>+ Fixed-date Philippine holidays for {year}</button>
        </div>
      </div>
      <p className="muted small">Holy Week, Eid and other moving holidays change each year. Add them from the year’s proclamation.</p>
      <SaveBar label="Save holidays" busy={busy} msg={msg} onSave={() => void run([[`/courses/${data.course.id}/rates`, { holidays: rows.filter((r) => r.day) }]])} />
    </section>
  );
}

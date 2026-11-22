import { useEffect, useState, type ReactNode } from 'react';
import { Area, Btn, Check, Field, Seg, Select } from '@maison/core/ui/kit';
import {
  formatTime, localParts, type BookingRules, type CourseOptions, type Fee, type FeeAmount, type Layout, type PaidTo, type PlayerType, type Rate, type SheetSettings,
} from '@maison/engine';
import { api, type CourseData, type TeeHouseSetup } from '../api';

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const toPeso = (c: number | undefined | null) => (c === undefined || c === null ? '' : String(c / 100));
const toCentavos = (s: string) => Math.round(Number(s.replace(/[₱,\s]/g, '')) * 100);
const isAmount = (s: string) => s.trim() !== '' && Number.isFinite(Number(s.replace(/[₱,\s]/g, '')));
const key = () => `n${Math.random().toString(36).slice(2, 12)}`;
const DAY_LETTERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Pane = 'course' | 'teetimes' | 'players' | 'fees' | 'teehouses' | 'rules' | 'holidays';
const PANES: { id: Pane; label: string; sub: string }[] = [
  { id: 'teetimes', label: 'Courses and tee time', sub: 'Each course (9 or 18 holes), its tee time settings and interval' },
  { id: 'players', label: 'Players and green fees', sub: 'Local, foreign, senior… 9 and 18 holes' },
  { id: 'fees', label: 'Carts, caddies and fees', sub: 'Golf cart, caddie, insurance, rentals and more' },
  { id: 'teehouses', label: 'Tee houses', sub: 'Food and drinks on the course, charged to passports' },
  { id: 'rules', label: 'Booking rules', sub: 'How far ahead, cancelling, paying, the waitlist' },
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
        {pane === 'teehouses' ? <TeeHousesPane {...props} /> : null}
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
      <PaneHead title="Courses and tee time" sub="Each course at your club has its own tee sheet. Changes start from the date you choose; bookings already made keep their times." />
      {upcoming.length ? <p className="fore-note">Tee time changes already set to start later: {upcoming.map((u) => `${s.layouts.find((l) => l.id === u.layoutId)?.name ?? 'Course'} from ${u.effectiveFrom}`).join('; ')}.</p> : null}
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
          <p className="fore-preview">{count(r)} flights a day, {formatTime(toMin(r.first))} to {formatTime(toMin(r.last))}{r.twoTee ? ', from both tees' : ''}.</p>
        </div>
      ))}
      <div className="fore-panel fore-inline">
        <Btn onClick={() => setRows([...rows, { id: key(), name: '', holes: 18, twoTee: false, active: true, first: '06:00', last: '14:00', interval: '8', players: '4', isNew: true }])}>Add another course</Btn>
        <span className="muted small">For clubs with more than one course. Each gets its own tee sheet, holes and tee time settings.</span>
      </div>
      <div className="fore-panel">
        <Check label="Golfers can book 9 holes on 18-hole courses" hint="Set 9-hole green fees under Players and green fees." value={nine} onChange={setNine} />
        <Field label="Changes start from" type="date" value={from} onChange={setFrom} hint="Days before this keep their current tee time settings." />
      </div>
      <SaveBar label="Save tee time" busy={busy} msg={msg} onSave={save} />
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
              <label className="fore-cell"><span className="cap">Tee time from</span><input type="time" aria-label={`Earliest tee time for ${t.name}`} value={t.earliestText} onChange={(e) => upd(i, { earliestText: e.target.value })} /></label>
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
      // The gallery fee is on whenever gallery guests are allowed.
      return { ...f, amounts, ...(f.kind === 'gallery' ? { active: opts.galleryMax > 0, required: false } : {}) };
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

const before = (m: number) => (m < 60 ? `${m} minutes before` : m < 1440 ? `${m / 60} ${m === 60 ? 'hour' : 'hours'} before` : `${m / 1440} ${m === 1440 ? 'day' : 'days'} before`);
const PAY_BEFORE = [{ value: '', label: 'No deadline' }, ...[15, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440, 2880].map((m) => ({ value: String(m), label: before(m) }))];
const PAY_WITHIN = [{ value: '', label: 'No limit' }, ...[1, 2, 3, 5, 7, 14].map((d) => ({ value: String(d), label: `Within ${d} ${d === 1 ? 'day' : 'days'} of booking` }))];
const CLAIM = [5, 10, 15, 20, 30].map((m) => ({ value: String(m), label: `${m} minutes` }));
const FEWEST = ['1', '2', '3', '4'].map((n) => ({ value: n, label: n === '1' ? '1 (solo)' : `${n} players` }));

function RulesPane({ data, reload }: { data: CourseData; reload: () => Promise<void> }) {
  const r = data.setup.rules;
  const [f, setF] = useState({ ...r, releaseTimeText: toTime(r.releaseTime) });
  const { run, busy, msg } = useSave(reload);
  const num = (k: keyof BookingRules) => (v: string) => setF({ ...f, [k]: v === '' ? '' : Number(v.replace(/\D/g, '')) });
  const item = (label: string, hint: string, field: ReactNode) => <div className="fore-rule"><div><b>{label}</b><span>{hint}</span></div>{field}</div>;
  return (
    <section>
      <PaneHead title="Booking rules" sub="What golfers can do in the app. Staff can book fewer players than the minimum, and owners and managers can always add a special booking." />
      <div className="fore-panel flush">
        {item('Book ahead', 'How many days ahead golfers can book.', <Field label="Days" inputMode="numeric" value={String(f.publicDaysAhead)} onChange={num('publicDaysAhead')} sm />)}
        {item('New day opens', 'The time each new day opens for booking.', <Field label="Time" type="time" value={f.releaseTimeText} onChange={(v) => setF({ ...f, releaseTimeText: v })} sm />)}
        {item('Cancel or move', 'Golfers can cancel or move up to this many hours before their tee time.', <Field label="Hours before" inputMode="numeric" value={String(f.cancelCutoffHours)} onChange={num('cancelCutoffHours')} sm />)}
        {item('Players per booking', 'Most players in one app booking.', <Field label="Players" inputMode="numeric" value={String(f.maxPlayersPerBooking)} onChange={num('maxPlayersPerBooking')} sm />)}
        {item('Open bookings', 'Most upcoming bookings one golfer can have.', <Field label="Bookings" inputMode="numeric" value={String(f.maxOpenBookingsPerGolfer)} onChange={num('maxOpenBookingsPerGolfer')} sm />)}
        {item('No-shows', 'No-shows in 90 days before a golfer can’t book in the app. 0 = never.', <Field label="No-shows" inputMode="numeric" value={String(f.noShowLimit)} onChange={num('noShowLimit')} sm />)}
        {item('Fewest players, Monday to Friday', 'The smallest group golfers can book in the app. 1 = a solo golfer can book.', <Select aria-label="Fewest players on weekdays" value={String(f.minPlayersWeekday ?? 1)} onChange={(v) => setF({ ...f, minPlayersWeekday: Number(v) })} options={FEWEST} />)}
        {item('Fewest players, weekends and holidays', 'Many courses ask for bigger groups on busy days.', <Select aria-label="Fewest players on weekends" value={String(f.minPlayersWeekend ?? 1)} onChange={(v) => setF({ ...f, minPlayersWeekend: Number(v) })} options={FEWEST} />)}
        {item('Player names', 'Required: staff and golfers give every player’s name when booking. Optional: only the name for the booking.', <Seg value={f.playerNames === 'required' ? 'required' : 'optional'} onChange={(v) => setF({ ...f, playerNames: v === 'required' ? 'required' : 'optional' })} options={[{ value: 'optional', label: 'Optional' }, { value: 'required', label: 'Required' }]} />)}
        {item('Groups share a tee time', 'On: different groups can book the same tee time until it’s full. Off: one group per tee time.', <Seg value={f.shareTeeTimes === false ? 'no' : 'yes'} onChange={(v) => setF({ ...f, shareTeeTimes: v === 'yes' })} options={[{ value: 'yes', label: 'Share' }, { value: 'no', label: 'One group' }]} />)}
      </div>
      <h3 className="fore-set-sub">Paying, and the waitlist</h3>
      <div className="fore-panel flush">
        {item('Golfers pay', 'Before playing: at the counter before teeing off; check-in waits for payment. After playing: golfers register on arrival and get a passport each; tee houses add food and drinks; they settle at the counter after the round. Caddie fees stay separate either way.',
          <Seg value={f.payWhen === 'after' ? 'after' : 'before'} onChange={(v) => setF({ ...f, payWhen: v === 'after' ? 'after' : 'before' })} options={[{ value: 'before', label: 'Before playing' }, { value: 'after', label: 'After playing' }]} />)}
        {item(f.payWhen === 'after' ? 'Register by' : 'Pay by', f.payWhen === 'after' ? 'Golfers must arrive and register this long before their tee time (phone, Viber, walk-ins for a later day, and app bookings). Not registered in time: it becomes a pencil booking and the tee time opens to others and to the waitlist.' : 'For phone, Viber and walk-in bookings for a later day, and app golfers paying at the counter. Not paid in time: it becomes a pencil booking and the tee time opens to others and to the waitlist.',
          <Select aria-label="Pay by" value={f.payBeforeMinutes === null || f.payBeforeMinutes === undefined ? '' : String(f.payBeforeMinutes)} onChange={(v) => setF({ ...f, payBeforeMinutes: v === '' ? null : Number(v) })} options={PAY_BEFORE} />)}
        {item('…and within', 'Optional: also within some days of booking, whichever comes first. Stops a far-off tee time being held unpaid until the last minute.',
          <Select aria-label="Pay within" value={f.payWithinDays === null || f.payWithinDays === undefined ? '' : String(f.payWithinDays)} onChange={(v) => setF({ ...f, payWithinDays: v === '' ? null : Number(v) })} options={PAY_WITHIN} />)}
        {f.payWhen === 'after' ? null : item('Pay-now window', 'Same-day walk-ins pay at the counter right away; so do bookings made after their pay deadline. Their tee time is held this many minutes while they pay, then released. Staff holds last this long too.', <Field label="Minutes" inputMode="numeric" value={String(f.holdMinutes)} onChange={num('holdMinutes')} sm />)}
        {f.payWhen === 'after' ? item('Hold time', 'How long a staff hold keeps a tee time before it’s released.', <Field label="Minutes" inputMode="numeric" value={String(f.holdMinutes)} onChange={num('holdMinutes')} sm />) : null}
        {item('Waitlist: time to claim', 'When a tee time opens, the first golfer on the app waitlist has this long to book it before it goes to the next. Under an hour before the tee time, everyone waiting is told at once.',
          <Select aria-label="Time to claim" value={String(f.waitlistClaimMinutes ?? 15)} onChange={(v) => setF({ ...f, waitlistClaimMinutes: Number(v) })} options={CLAIM} />)}
      </div>
      <SaveBar label="Save booking rules" busy={busy} msg={msg} onSave={() => void run([[`/courses/${data.course.id}/rules`, { ...f, releaseTime: toMin(f.releaseTimeText) }]])} />
    </section>
  );
}

// ---------------------------------------------------------------- tee houses

interface HouseForm { id: string; name: string; concessionaire: string; sharePercent: string; rent: string; rentNote: string; receipts: 'club' | 'tee_house'; active: boolean; items: { id: string; name: string; price: string }[] }
const HOUSE_IDEAS = ['Halfway house', 'Hole 5 tee house', 'Hole 9 tee house', 'Hole 14 tee house'];

/** Tee houses: who runs each one, what the club keeps, who issues receipts, and their menu for quick charging. */
function TeeHousesPane({ data }: { data: CourseData; reload: () => Promise<void> }) {
  const [list, setList] = useState<HouseForm[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const fromServer = (r: TeeHouseSetup[]) => r.map((h) => ({ id: h.id, name: h.name, concessionaire: h.concessionaire, sharePercent: String(h.sharePercent), rent: toPeso(h.rentAmount), rentNote: h.rentNote,
    receipts: h.receipts, active: h.active, items: h.items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, price: toPeso(i.price) })) }));
  useEffect(() => { void api<TeeHouseSetup[]>(`/courses/${data.course.id}/teehouses`).then((r) => setList(fromServer(r))).catch((e) => setMsg({ text: (e as Error).message })); }, [data.course.id]);
  if (!list) return <section><PaneHead title="Tee houses" sub="Loading…" /></section>;
  const upd = (i: number, p: Partial<HouseForm>) => setList(list.map((h, j) => (j === i ? { ...h, ...p } : h)));
  const add = (name = '') => setList([...list, { id: '', name, concessionaire: '', sharePercent: '0', rent: '', rentNote: '', receipts: 'club', active: true, items: [{ id: '', name: '', price: '' }] }]);
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api<TeeHouseSetup[]>(`/courses/${data.course.id}/teehouses`, { method: 'PUT', body: { teeHouses: list.map((h) => ({
        id: h.id || undefined, name: h.name, concessionaire: h.concessionaire, sharePercent: Number(h.sharePercent || 0), rentAmount: isAmount(h.rent) ? toCentavos(h.rent) : 0, rentNote: h.rentNote,
        receipts: h.receipts, active: h.active, items: h.items.filter((it) => it.name.trim()).map((it) => ({ id: it.id || undefined, name: it.name, price: isAmount(it.price) ? toCentavos(it.price) : 0 })),
      })) } });
      setList(fromServer(r)); setMsg({ text: 'Saved.', ok: true });
    } catch (e) { setMsg({ text: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <section>
      <PaneHead title="Tee houses" sub="Food and drink stops on the course. Their staff charge orders to each player’s passport from a phone; golfers settle everything at the counter after the round, and the club remits what’s due to each tee house. Used when golfers pay after playing (Booking rules)." />
      {data.setup.rules.payWhen !== 'after' ? <p className="fore-note">Golfers at your course pay before playing, so there are no passports to charge yet. Switch to “After playing” in Booking rules to use tee houses.</p> : null}
      {list.map((h, i) => (
        <div key={h.id || `new${i}`} className={`fore-panel fore-house${h.active ? '' : ' off'}`}>
          <div className="grid fore-2">
            <Field label="Name" value={h.name} onChange={(v) => upd(i, { name: v })} placeholder="e.g. Hole 5 tee house" />
            <Field label="Run by (concessionaire)" value={h.concessionaire} onChange={(v) => upd(i, { concessionaire: v })} placeholder="Owner’s name, or leave empty if the club runs it" />
          </div>
          <div className="fore-house-terms">
            <Field label="Club’s share of sales (%)" inputMode="decimal" value={h.sharePercent} onChange={(v) => upd(i, { sharePercent: v.replace(/[^\d.]/g, '') })} sm hint="0 if the club keeps nothing" />
            <label className="fore-money-field"><span>Rent (₱, for the record)</span><Money label={`${h.name} rent`} value={h.rent} onChange={(v) => upd(i, { rent: v })} /></label>
            <Field label="Rent note" value={h.rentNote} onChange={(v) => upd(i, { rentNote: v })} placeholder="e.g. a month, billed separately" sm />
            <div className="fore-inline"><span className="fore-lbl">Receipts issued by</span><Seg value={h.receipts} onChange={(v) => upd(i, { receipts: v === 'tee_house' ? 'tee_house' : 'club' })} options={[{ value: 'club', label: 'The club' }, { value: 'tee_house', label: 'The tee house' }]} /></div>
          </div>
          <div className="fore-house-menu">
            <b>Menu</b><span className="muted small">Optional: staff tap these to charge quickly, or type any item and price.</span>
            {h.items.map((it, j) => (
              <div key={it.id || `i${j}`} className="fore-house-item">
                <input className="input" aria-label="Item" placeholder="e.g. Iced tea" value={it.name} onChange={(e) => upd(i, { items: h.items.map((x, k) => (k === j ? { ...x, name: e.target.value } : x)) })} />
                <Money label={`${it.name || 'Item'} price`} value={it.price} onChange={(v) => upd(i, { items: h.items.map((x, k) => (k === j ? { ...x, price: v } : x)) })} />
                <button className="fore-remove" onClick={() => upd(i, { items: h.items.filter((_, k) => k !== j) })}>Remove</button>
              </div>
            ))}
            <Btn size="sm" onClick={() => upd(i, { items: [...h.items, { id: '', name: '', price: '' }] })}>Add an item</Btn>
          </div>
          <div className="row"><Check label="Open" value={h.active} onChange={(v) => upd(i, { active: v })} /><button className="fore-remove" onClick={() => setList(list.filter((_, j) => j !== i))}>Remove tee house</button></div>
        </div>
      ))}
      <div className="fore-ideas">
        <Btn size="sm" onClick={() => add()}>Add a tee house</Btn>
        {HOUSE_IDEAS.filter((n) => !list.some((h) => h.name.toLowerCase() === n.toLowerCase())).map((n) => <button key={n} className="fore-idea" onClick={() => add(n)}>+ {n}</button>)}
      </div>
      <p className="muted small">Give tee house staff the “Tee house” role under Staff. They sign in on their phone and see only their tee house: the groups on the course, their menu and their own orders.</p>
      <SaveBar label="Save tee houses" busy={busy} msg={msg} onSave={() => void save()} />
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

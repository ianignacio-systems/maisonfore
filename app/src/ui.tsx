import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { addDays, counterSplit, formatTime, peso, weekday, type QuoteLine } from '@maison/engine';

export const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDay = (d: string) => `${SHORT[weekday(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
export const clock = (m: number) => formatTime(m);

/** /play/… addresses, without a page reload. */
export function go(path: string) {
  history.pushState(null, '', `/play${path}`);
  dispatchEvent(new PopStateEvent('popstate'));
}
export function usePath(): string {
  const read = () => location.pathname.replace(/^\/play/, '') || '/';
  const [p, setP] = useState(read);
  useEffect(() => { const on = () => setP(read()); addEventListener('popstate', on); return () => removeEventListener('popstate', on); }, []);
  return p;
}

export function Button({ children, onClick, kind = 'primary', disabled, type = 'button', block }: {
  children: ReactNode; onClick?: () => void; kind?: 'primary' | 'quiet' | 'line' | 'danger'; disabled?: boolean; type?: 'button' | 'submit'; block?: boolean;
}) {
  return <button type={type} className={`pl-btn ${kind}${block ? ' block' : ''}`} disabled={disabled} onClick={onClick}>{children}</button>;
}

export function Input({ label, value, onChange, type = 'text', placeholder, hint, autoComplete, autoFocus, inputMode }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; hint?: ReactNode; autoComplete?: string; autoFocus?: boolean;
  inputMode?: 'text' | 'tel' | 'email' | 'numeric';
}) {
  return (
    <label className="pl-field">
      <span>{label}</span>
      <input aria-label={label} type={type} value={value} placeholder={placeholder} autoComplete={autoComplete} autoFocus={autoFocus} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Stepper({ value, onChange, min, max, label }: { value: number; onChange: (n: number) => void; min: number; max: number; label: string }) {
  return (
    <span className="pl-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <b>{value}</b>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </span>
  );
}

/** A panel that slides up from the bottom on phones and sits in the middle on bigger screens. */
export function Sheet({ title, sub, onClose, children, footer }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', esc);
    document.body.classList.add('pl-locked');
    return () => { removeEventListener('keydown', esc); document.body.classList.remove('pl-locked'); };
  }, [onClose]);
  return (
    <div className="pl-sheet-back" onClick={onClose}>
      <div className="pl-sheet" role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header><div>{sub ? <small>{sub}</small> : null}<h2>{title}</h2></div><button className="pl-x" aria-label="Close" onClick={onClose}>×</button></header>
        <div className="pl-sheet-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>
  );
}

/** A strip of days to pick from, today first. */
export function Days({ from, count, value, onPick, lastBookable }: { from: string; count: number; value: string; onPick: (d: string) => void; lastBookable?: string }) {
  const days = Array.from({ length: count }, (_, i) => addDays(from, i));
  return (
    <div className="pl-days" role="listbox" aria-label="Day">
      {days.map((d, i) => (
        <button key={d} role="option" aria-selected={d === value} className={`${d === value ? 'on' : ''}${lastBookable && d > lastBookable ? ' later' : ''}`} onClick={() => onPick(d)}>
          <small>{i === 0 ? 'Today' : i === 1 ? 'Tmrw' : SHORT[weekday(d)]}</small>
          <b>{Number(d.slice(8))}</b>
          <small>{MONTHS[Number(d.slice(5, 7)) - 1]}</small>
        </button>
      ))}
    </div>
  );
}

/**
 * The price, as the counter collects it: golfers pay at the course, so everything the counter takes is in
 * one total (fees paid at the counter included); only the caddie fee is settled separately.
 */
export function PriceList({ lines, payWord = 'Total' }: { lines: QuoteLine[]; payWord?: string }) {
  const { collect, separate, total } = counterSplit(lines, true);
  const row = (l: QuoteLine, apart: boolean) => (
    <div key={l.key} className="pl-price-row">
      <span>{l.label}<small>{l.detail}{apart ? (l.payAt === 'direct' ? ', at least, paid to the caddie' : l.payAt === 'counter' ? ', paid at the caddie counter' : '') : ''}</small></span>
      <b>{peso(l.amount)}</b>
    </div>
  );
  return (
    <div className="pl-price">
      {collect.map((l) => row(l, false))}
      <div className="pl-price-row total"><span>{payWord}</span><b>{peso(total)}</b></div>
      {separate.length ? <><p className="pl-price-sep">Paid separately</p>{separate.map((l) => row(l, true))}</> : null}
    </div>
  );
}

export function QR({ text, size = 200 }: { text: string; size?: number }) {
  const [svg, setSvg] = useState('');
  useEffect(() => { void QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#15241d', light: '#ffffff' } }).then(setSvg); }, [text]);
  return <div className="pl-qr" style={{ width: size, height: size }} role="img" aria-label={`QR code for ${text}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function Flag() {
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 21V4l10 4-10 4" /></svg>;
}
export function Ticket() {
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z" /><path d="M14 7v10" strokeDasharray="2 2" /></svg>;
}
export function Person() {
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
}

// ---------------------------------------------------------------- course art

/** Time-of-day palettes for the course postcards: sky (top, bottom), sun, far, middle and near hills, fairway stripes. */
const SKIES = [
  { name: 'dawn', sky: ['#f7d8b5', '#fbeedd'], sun: '#f4b25e', hills: ['#a9c3a3', '#4f8a64', '#1f5a43'], mow: ['#2a6a4d', '#317556'] },
  { name: 'morning', sky: ['#bfe0ea', '#eef6f1'], sun: '#fff0bf', hills: ['#9fc7ab', '#4c9068', '#1d5c40'], mow: ['#276a48', '#2e7552'] },
  { name: 'noon', sky: ['#d7ecd9', '#f4f8ec'], sun: '#ffe58f', hills: ['#b2cf9c', '#5e9a5f', '#2a6640'], mow: ['#316f45', '#397a4d'] },
  { name: 'dusk', sky: ['#efb99c', '#f8dcc4'], sun: '#ef8a5b', hills: ['#8aa592', '#3f6c55', '#183f30'], mow: ['#1f4b39', '#245441'] },
];
function hash(s: string): number { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

/**
 * A small illustrated postcard for a course: hills, a mown fairway, a green with its flag. The colours and
 * shapes come from the course's address, so every course has its own picture and keeps it.
 */
export function CourseArt({ seed, className }: { seed: string; className?: string }) {
  const h = hash(seed);
  const p = SKIES[h % SKIES.length];
  const r = (n: number, span: number) => ((h >>> n) % span);
  const id = `a${h.toString(36)}`;
  const sunX = 60 + r(3, 280), sunY = 38 + r(7, 30);
  const far = `M0 ${110 + r(2, 20)} C70 ${80 + r(4, 25)} 150 ${125 - r(5, 20)} 220 ${98 + r(6, 20)} S350 ${78 + r(8, 25)} 400 ${100 + r(9, 15)} V200 H0z`;
  const mid = `M0 ${140 + r(10, 15)} C90 ${115 + r(11, 20)} 170 ${158 - r(12, 15)} 260 ${130 + r(13, 15)} S360 ${118 + r(14, 15)} 400 ${132 + r(15, 10)} V200 H0z`;
  const flagX = 215 + r(16, 80);
  const greenY = 166;
  const pond = h % 3 === 0;
  return (
    <svg className={className} viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={p.sky[0]} /><stop offset="1" stopColor={p.sky[1]} /></linearGradient>
        <pattern id={`${id}m`} width="44" height="200" patternUnits="userSpaceOnUse" patternTransform="skewX(-28)"><rect width="22" height="200" fill={p.mow[0]} /><rect x="22" width="22" height="200" fill={p.mow[1]} /></pattern>
      </defs>
      <rect width="400" height="200" fill={`url(#${id}s)`} />
      <circle cx={sunX} cy={sunY} r="20" fill={p.sun} opacity="0.9" />
      <path d={far} fill={p.hills[0]} />
      <path d={mid} fill={p.hills[1]} />
      <path d={`M0 ${172 - r(17, 8)} C110 ${150 + r(18, 10)} 250 ${178 - r(19, 8)} 400 ${156 + r(20, 10)} V200 H0z`} fill={`url(#${id}m)`} />
      {pond ? <ellipse cx={70 + r(21, 80)} cy="186" rx="46" ry="7" fill="#9fd1d6" opacity="0.9" /> : <ellipse cx={90 + r(21, 90)} cy="184" rx="30" ry="5" fill="#ecd9a7" />}
      <ellipse cx={flagX} cy={greenY} rx="38" ry="7" fill={p.hills[0]} opacity="0.85" />
      <path d={`M${flagX} ${greenY}V${greenY - 52}`} stroke="#fdfaf2" strokeWidth="2.5" strokeLinecap="round" />
      <path d={`M${flagX + 1.5} ${greenY - 51}l26 9-26 9z`} fill="#e8a33d" />
    </svg>
  );
}

/** Open spots in a slot as golf balls: filled = open for you, hollow = taken. */
export function Spots({ free, capacity }: { free: number; capacity: number }) {
  return <span className="pl-spots" aria-label={`${free} of ${capacity} spots open`}>{Array.from({ length: capacity }, (_, i) => <i key={i} className={i < free ? 'on' : ''} />)}</span>;
}

/** Morning, midday and afternoon marks for the slot groups. */
export function DayPart({ part }: { part: 'Morning' | 'Midday' | 'Afternoon' }) {
  const d = part === 'Morning' ? <><path d="M3 18h18M6 18a6 6 0 0 1 12 0" /><path d="M12 6V4M5.6 9.6 4.2 8.2M18.4 9.6l1.4-1.4" /></>
    : part === 'Midday' ? <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>
      : <><path d="M3 18h18M7 18a5 5 0 0 1 10 0" /><path d="M12 9v3M9 12l3 3 3-3" transform="rotate(180 12 12)" /></>;
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
}

/** The booking pass: the QR code and booking code the counter scans, with when and where. */
export function Pass({ code, course, when, detail }: { code: string; course: string; when: string; detail: string }) {
  return (
    <div className="pl-pass">
      <div className="pl-pass-top"><small>{course}</small><b>{when}</b><span>{detail}</span></div>
      <div className="pl-pass-cut" aria-hidden />
      <div className="pl-pass-code"><QR text={`MAISONFORE:${code}`} size={176} /><p className="pl-ref">{code}</p><small>Show this at the counter when you arrive.</small></div>
    </div>
  );
}

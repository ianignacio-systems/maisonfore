import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { addDays, formatTime, peso, weekday, type QuoteLine } from '@maison/engine';

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

/** The price: what's paid for the booking, then what's paid separately (at the counter or to the caddie). */
export function PriceList({ lines, payWord = 'Total' }: { lines: QuoteLine[]; payWord?: string }) {
  const withBooking = lines.filter((l) => l.payAt === 'booking' || (l.payAt as string) === 'app');
  const separate = lines.filter((l) => !withBooking.includes(l));
  const total = withBooking.reduce((s, l) => s + l.amount, 0);
  const row = (l: QuoteLine) => (
    <div key={l.key} className="pl-price-row">
      <span>{l.label}<small>{l.detail}{l.payAt === 'direct' ? ', at least, paid to the caddie' : l.payAt === 'counter' ? ', paid at the counter' : ''}</small></span>
      <b>{peso(l.amount)}</b>
    </div>
  );
  return (
    <div className="pl-price">
      {withBooking.map(row)}
      <div className="pl-price-row total"><span>{payWord}</span><b>{peso(total)}</b></div>
      {separate.length ? <><p className="pl-price-sep">Paid separately at the course</p>{separate.map(row)}</> : null}
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

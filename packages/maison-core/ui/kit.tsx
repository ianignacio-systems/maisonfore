import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Small, touch-friendly building blocks used by every screen. */

export function Btn({ children, onClick, kind, size, disabled, block, type = 'button', title }: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'ok' | 'danger' | 'ghost';
  size?: 'sm' | 'lg';
  disabled?: boolean;
  block?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  return (
    <button type={type} title={title} className={['btn', kind, size, block ? 'block' : ''].filter(Boolean).join(' ')} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Field({ label, value, onChange, type = 'text', placeholder, hint, mono, autoFocus, inputMode, maxLength, style, sm, onEnter, autoComplete, name }: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'password' | 'email' | 'number' | 'date' | 'tel' | 'time';
  placeholder?: string;
  hint?: ReactNode;
  mono?: boolean;
  autoFocus?: boolean;
  inputMode?: 'decimal' | 'numeric' | 'text' | 'email' | 'tel' | 'none';
  maxLength?: number;
  style?: React.CSSProperties;
  sm?: boolean;
  onEnter?: () => void;
  autoComplete?: string;
  name?: string;
}) {
  const [shown, setShown] = useState(false);
  const secret = type === 'password';
  const field = (
    <input
      className={['input', mono ? 'mono' : '', sm ? 'sm' : ''].join(' ')}
      value={value}
      type={secret && shown ? 'text' : type}
      name={name}
      placeholder={placeholder}
      autoFocus={autoFocus}
      inputMode={inputMode}
      maxLength={maxLength}
      autoComplete={autoComplete}
      aria-label={label ?? placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) onEnter();
      }}
    />
  );
  // Every password or PIN box has a Show/Hide button so people can check what they typed.
  const input = secret ? (
    <span className="pw-wrap">
      {field}
      <button type="button" className="pw-eye" aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}
        onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); setShown(!shown); }}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </span>
  ) : field;
  if (!label && !hint) return <div className="field" style={style}>{input}</div>;
  return (
    <label className="field" style={style}>
      {label ? <span>{label}</span> : null}
      {input}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Area({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Select<T extends string>({ label, value, onChange, options, style, placeholder, 'aria-label': aria }: {
  label?: string;
  'aria-label'?: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  style?: React.CSSProperties;
  placeholder?: string;
}) {
  const sel = (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={aria ?? label ?? placeholder}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  if (!label) return <div className="field" style={style}>{sel}</div>;
  return (
    <label className="field" style={style}>
      <span>{label}</span>
      {sel}
    </label>
  );
}

export function Check({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b style={{ fontWeight: 600 }}>{label}</b>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ label, sub, on, onClick, disabled }: { label: string; sub?: string; on?: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={`chip${on ? ' on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={!!on}>
      <b>{label}</b>
      {sub ? <small>{sub}</small> : null}
    </button>
  );
}

export function Pill({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'crit' | 'info' | 'accent' }) {
  return <span className={`pill ${tone ?? ''}`}>{children}</span>;
}

export function Stepper({ value, onChange, min = 0, max = 9999 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="stepper">
      <button type="button" aria-label="Less" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span>{value}</span>
      <button type="button" aria-label="More" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</button>
    </div>
  );
}

export function Sheet({ open, title, eyebrow, onClose, children, footer, width = 560, watch }: {
  open: boolean;
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** A form's values: closing (×, Esc, tapping outside) after they changed asks before throwing the changes away. */
  watch?: unknown;
}) {
  const first = useRef<string | null>(null);
  const [asking, setAsking] = useState(false);
  const snap = (v: unknown) => { try { return JSON.stringify(v) ?? ''; } catch { return ''; } };
  if (open && watch !== undefined && first.current === null) first.current = snap(watch);
  if (!open && first.current !== null) first.current = null;
  const tryClose = () => {
    if (watch !== undefined && first.current !== null && snap(watch) !== first.current) setAsking(true);
    else onClose();
  };
  useEffect(() => {
    if (!open) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && (asking ? setAsking(false) : tryClose());
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  });
  // Leaving or reloading the page with unsaved changes in a form: the browser asks too.
  useEffect(() => {
    if (!open || watch === undefined) return;
    const f = (e: BeforeUnloadEvent) => { if (first.current !== null && snap(watch) !== first.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  });
  if (!open) return null;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && tryClose()}>
      <div className="sheet" style={{ maxWidth: width }} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <div className="grow">
            {eyebrow ? <div className="label">{eyebrow}</div> : null}
            <h2>{title}</h2>
          </div>
          <button className="x" onClick={tryClose} aria-label="Close">×</button>
        </div>
        {asking ? (
          <div className="alertbox discard" role="alertdialog" aria-label="Unsaved changes">
            <span className="grow"><b>You have changes that aren’t saved.</b> Close and lose them?</span>
            <Btn size="sm" onClick={() => setAsking(false)}>Keep editing</Btn>
            <Btn size="sm" kind="danger" onClick={() => { setAsking(false); onClose(); }}>Discard changes</Btn>
          </div>
        ) : null}
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="v">{value}</div>
      {hint ? <div className="small muted">{hint}</div> : null}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3 style={{ color: 'var(--ink)' }}>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

/** The page title bar. It stays at the top while the page scrolls, with `below` (search, filters, tabs) under it. */
export function PageHead({ title, sub, right, below }: { title: string; sub?: ReactNode; right?: ReactNode; below?: ReactNode }) {
  // Table column headings freeze just under this bar, so the page shares its height.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const setH = () => document.documentElement.style.setProperty('--page-top-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    setH();
    const ro = new ResizeObserver(setH);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="page-top" ref={ref}>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {sub ? <p className="muted">{sub}</p> : null}
        </div>
        {right ? <div className="row wrap">{right}</div> : null}
      </div>
      {below ? <div className="page-below">{below}</div> : null}
    </div>
  );
}

export function PinPad({ onSubmit, error, length = 4, onWrong }: { onSubmit: (pin: string, quiet?: boolean) => Promise<boolean>; error?: string | null; length?: number; onWrong?: () => void }) {
  const [pin, setPin] = useState('');
  const busy = useRef(false);
  // A PIN that was checked and didn't match; erasing it counts as a wrong try (so PINs can't be guessed silently).
  const failed = useRef('');
  // PINs are 4 to 6 digits: from the 4th digit on, a matching PIN signs in right away (no OK needed).
  const attempt = async (p: string, final: boolean) => {
    if (busy.current) return;
    busy.current = true;
    const ok = await onSubmit(p, !final);
    busy.current = false;
    if (!ok) failed.current = p;
    if (!ok && final) { setPin(''); failed.current = ''; onWrong?.(); }
  };
  const press = (d: string) => {
    if (d === '⌫') {
      if (pin.length >= 4 && failed.current === pin) { failed.current = ''; onWrong?.(); }
      return setPin((p) => p.slice(0, -1));
    }
    if (d === 'OK') return pin.length >= 4 && void attempt(pin, true);
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length >= 4) void attempt(next, next.length === 6);
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter') press('OK');
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  });
  return (
    <div className="col" style={{ alignItems: 'center' }}>
      <div className="dots" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(length, pin.length) }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      <div style={{ minHeight: 20, color: 'var(--crit)', fontSize: 14 }}>{error}</div>
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} aria-label={d === '⌫' ? 'Delete' : d === 'OK' ? 'Enter PIN' : d} style={d === 'OK' ? { fontSize: 18 } : undefined}>
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

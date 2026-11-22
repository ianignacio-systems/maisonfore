import { useState, type ReactNode } from 'react';
import { LOCAL, resetPassword, setNewPassword, signIn, signUp } from '../auth';
import { Button, Input } from '../ui';

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="pl-auth">
      <div className="pl-auth-art" aria-hidden>
        <svg viewBox="0 0 400 220" preserveAspectRatio="xMidYMax slice">
          <path d="M0 150 C80 120 140 170 220 140 S340 110 400 130 V220 H0z" fill="#2c5244" />
          <path d="M0 180 C90 160 170 200 260 175 S360 160 400 170 V220 H0z" fill="#3f6b57" />
          <ellipse cx="250" cy="168" rx="44" ry="9" fill="#5d8a72" />
          <path d="M246 168V92" stroke="#f4ecdd" strokeWidth="3" strokeLinecap="round" />
          <path d="M249 94l34 12-34 12z" fill="#d6b880" />
        </svg>
        <div className="pl-auth-brand"><b>Maison<span>Fore</span></b><p>Tee times at partner courses across the Philippines.</p></div>
      </div>
      <div className="pl-auth-form">{children}</div>
    </div>
  );
}

/** Sign in or create a Maison account (the same one as MaisonPOS). */
export function SignIn({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setMsg(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setMsg({ text: 'Enter your email address.' });
    if (mode === 'up' && !LOCAL && password.length < 8) return setMsg({ text: 'Use a password of at least 8 characters.' });
    setBusy(true);
    try {
      if (mode === 'forgot') { await resetPassword(email.trim()); setMsg({ text: `If ${email.trim()} has an account, a link to set a new password is on its way.`, ok: true }); }
      else if (mode === 'up') { const note = await signUp(email.trim(), password); if (note) setMsg({ text: note, ok: true }); else onDone(); }
      else { await signIn(email.trim(), password); onDone(); }
    } catch (e) { setMsg({ text: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <Frame>
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <h1>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create your account' : 'Reset your password'}</h1>
        <p className="pl-muted">{LOCAL ? 'Local trial: any email signs in, no password needed.' : mode === 'up' ? 'One Maison account works across MaisonFore and the other Maison apps.' : 'Use your Maison account.'}</p>
        <Input label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" inputMode="email" autoFocus />
        {mode !== 'forgot' && !LOCAL ? <Input label="Password" type="password" value={password} onChange={setPassword} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} /> : null}
        {msg ? <p className={msg.ok ? 'pl-ok' : 'pl-err'} role="status">{msg.text}</p> : null}
        <Button type="submit" block disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</Button>
        {LOCAL ? null : mode === 'in' ? (
          <div className="pl-auth-links">
            <button type="button" onClick={() => { setMode('up'); setMsg(null); }}>New here? Create an account</button>
            <button type="button" onClick={() => { setMode('forgot'); setMsg(null); }}>Forgot password?</button>
          </div>
        ) : <div className="pl-auth-links"><button type="button" onClick={() => { setMode('in'); setMsg(null); }}>Back to sign in</button></div>}
      </form>
    </Frame>
  );
}

export function NewPassword({ onDone }: { onDone: () => void }) {
  const [a, setA] = useState(''), [b, setB] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const go = async () => {
    if (a.length < 8) return setMsg('Use a password of at least 8 characters.');
    if (a !== b) return setMsg('The two passwords don’t match.');
    try { await setNewPassword(a); onDone(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <Frame>
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <h1>New password</h1>
        <Input label="New password" type="password" value={a} onChange={setA} autoComplete="new-password" autoFocus />
        <Input label="Type it again" type="password" value={b} onChange={setB} autoComplete="new-password" />
        {msg ? <p className="pl-err">{msg}</p> : null}
        <Button type="submit" block>Save new password</Button>
      </form>
    </Frame>
  );
}

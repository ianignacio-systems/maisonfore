import { useState } from 'react';
import { Btn, Field } from '@maison/core/ui/kit';
import { LOCAL, resetPassword, setNewPassword, signIn, signUp } from '../auth';
import { AuthFrame } from './AuthFrame';

/** Sign in with the Maison account: the same email and password as MaisonPOS. */
export function SignIn({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setMsg(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setMsg({ text: 'Enter your email address.' });
    if (mode !== 'forgot' && !LOCAL && password.length < 8 && mode === 'up') return setMsg({ text: 'Use a password of at least 8 characters.' });
    setBusy(true);
    try {
      if (mode === 'forgot') { await resetPassword(email.trim()); setMsg({ text: `If ${email.trim()} has a Maison account, a link to set a new password is on its way.`, ok: true }); }
      else if (mode === 'up') { const note = await signUp(email.trim(), password); if (note) setMsg({ text: note, ok: true }); else onDone(); }
      else { await signIn(email.trim(), password); onDone(); }
    } catch (e) {
      setMsg({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame headline="The tee sheet, without the paper." body="Take phone and walk-in bookings, hold times for your regulars, and let golfers book your open tee slots in the MaisonFore app.">
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <h1>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create your Maison account' : 'Reset your password'}</h1>
        <p className="lead">
          {LOCAL ? 'Local trial: any email signs in, no password needed.' : 'Use your Maison account. If you use MaisonPOS, it’s the same email and password.'}
        </p>
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" name="email" autoFocus />
        {mode !== 'forgot' && !LOCAL ? <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} name="password" /> : null}
        {msg ? <p style={{ color: msg.ok ? 'var(--ok)' : 'var(--crit)' }}>{msg.text}</p> : null}
        <Btn kind="primary" size="lg" type="submit" disabled={busy} block>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</Btn>
        {LOCAL ? null : (
          <div className="row between wrap">
            {mode === 'in' ? <Btn kind="ghost" size="sm" onClick={() => { setMode('forgot'); setMsg(null); }}>Forgot password?</Btn> : <Btn kind="ghost" size="sm" onClick={() => { setMode('in'); setMsg(null); }}>Back to sign in</Btn>}
            {mode === 'in' ? <Btn kind="ghost" size="sm" onClick={() => { setMode('up'); setMsg(null); }}>New here? Create an account</Btn> : null}
          </div>
        )}
      </form>
    </AuthFrame>
  );
}

/** After opening the reset-password link: choose a new password for the Maison account. */
export function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setMsg(null);
    if (password.length < 8) return setMsg('Use a password of at least 8 characters.');
    if (password !== again) return setMsg('The two passwords don’t match.');
    setBusy(true);
    try { await setNewPassword(password); onDone(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <AuthFrame headline="Choose a new password." body="It changes the password for your Maison account, so use it in MaisonPOS too.">
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <h1>New password</h1>
        <Field label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" name="password" autoFocus />
        <Field label="Type it again" type="password" value={again} onChange={setAgain} autoComplete="new-password" name="password2" />
        {msg ? <p style={{ color: 'var(--crit)' }}>{msg}</p> : null}
        <Btn kind="primary" size="lg" type="submit" disabled={busy} block>{busy ? 'Saving…' : 'Save new password'}</Btn>
      </form>
    </AuthFrame>
  );
}

import { useState } from 'react';
import { api, type Me, type Profile as P } from '../api';
import { LOCAL, signOut } from '../auth';
import { Button, Input } from '../ui';

function Residency({ value, onChange }: { value: P['residency']; onChange: (v: P['residency']) => void }) {
  return (
    <fieldset className="pl-choice">
      <legend>Green fees</legend>
      {(['local', 'foreign'] as const).map((r) => (
        <label key={r} className={value === r ? 'on' : ''}>
          <input type="radio" name="residency" checked={value === r} onChange={() => onChange(r)} />
          <b>{r === 'local' ? 'Local' : 'Foreign'}</b>
          <small>{r === 'local' ? 'Filipino citizen or resident' : 'Visiting from abroad'}</small>
        </label>
      ))}
    </fieldset>
  );
}

/** The second step of signing up: name, mobile, local or foreign, and the privacy notice. */
export function ProfileSetup({ email, onDone }: { email: string; onDone: (m: Me) => void }) {
  const [f, setF] = useState<P>({ name: '', mobile: '', residency: 'local' });
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setMsg(null);
    try { onDone(await api<Me>('/me', { method: 'PUT', body: { ...f, acceptPrivacy: agree } })); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="pl-setup">
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <p className="pl-kicker">{email}</p>
        <h1>A little about you</h1>
        <p className="pl-muted">Courses use this to hold your tee slot and reach you about it.</p>
        <Input label="Your name" value={f.name} onChange={(v) => setF({ ...f, name: v })} autoComplete="name" autoFocus />
        <Input label="Mobile number" type="tel" inputMode="tel" value={f.mobile} onChange={(v) => setF({ ...f, mobile: v })} placeholder="0917 123 4567" autoComplete="tel" />
        <Residency value={f.residency} onChange={(v) => setF({ ...f, residency: v })} />
        <p className="pl-muted small">Courses charge locals and foreigners different green fees. You may be asked for an ID at the counter.</p>
        <label className="pl-check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I agree that MaisonFore and the courses I book keep my name, email and mobile number to manage my bookings, as the Data Privacy Act of 2012 allows. I can ask for them to be removed.</span>
        </label>
        {msg ? <p className="pl-err" role="status">{msg}</p> : null}
        <Button type="submit" block disabled={busy || !agree}>{busy ? 'Saving…' : 'Continue'}</Button>
      </form>
    </div>
  );
}

export function Profile({ me, onSaved }: { me: Me; onSaved: (m: Me) => void }) {
  const [f, setF] = useState<P>(me.profile!);
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const save = async () => {
    setMsg(null);
    try { onSaved(await api<Me>('/me', { method: 'PUT', body: f })); setMsg({ text: 'Saved.', ok: true }); } catch (e) { setMsg({ text: (e as Error).message }); }
  };
  return (
    <div className="pl-page">
      <header className="pl-head"><h1>Profile</h1><p className="pl-muted">{me.email}{LOCAL ? ' (local trial)' : ''}</p></header>
      <section className="pl-card pl-form">
        <Input label="Your name" value={f.name} onChange={(v) => setF({ ...f, name: v })} autoComplete="name" />
        <Input label="Mobile number" type="tel" inputMode="tel" value={f.mobile} onChange={(v) => setF({ ...f, mobile: v })} autoComplete="tel" />
        <Residency value={f.residency} onChange={(v) => setF({ ...f, residency: v })} />
        {msg ? <p className={msg.ok ? 'pl-ok' : 'pl-err'} role="status">{msg.text}</p> : null}
        <Button onClick={() => void save()}>Save</Button>
      </section>
      <section className="pl-card">
        <p className="pl-muted small">Your Maison account also signs you in to other Maison apps. To have your account or your data removed, contact Maison.</p>
        <Button kind="line" onClick={() => void signOut().then(() => location.assign('/play/'))}>Sign out</Button>
      </section>
    </div>
  );
}

import { useState } from 'react';
import { Btn, Field } from '@maison/core/ui/kit';
import { api, type Course } from '../api';
import { navigate } from '../App';
import { AuthFrame } from './AuthFrame';

/** Become a partner (PTR-1): the course's basic details. Maison verifies the course before it appears in the app. */
export function NewCourse({ onCreated }: { onCreated: (slug: string) => void }) {
  const [f, setF] = useState({ name: '', address: '', city: '', province: '', phone: '', email: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });

  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      const c = await api<Course>('/partners', { method: 'POST', body: f });
      onCreated(c.slug);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <AuthFrame headline="Put your open tee slots in front of golfers." body="Listing is free. You pay a fee only on bookings golfers make in the app; phone and walk-in bookings you take here cost nothing.">
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <h1>Add your course</h1>
        <p className="lead">Next you’ll set your tee slots and rates. Maison checks every course before it appears in the app.</p>
        <Field label="Course name" value={f.name} onChange={set('name')} autoFocus placeholder="e.g. Valley Golf Club" />
        <Field label="Street address" value={f.address} onChange={set('address')} />
        <div className="row">
          <div className="grow"><Field label="City or town" value={f.city} onChange={set('city')} /></div>
          <div className="grow"><Field label="Province" value={f.province} onChange={set('province')} /></div>
        </div>
        <Field label="Phone for bookings" type="tel" value={f.phone} onChange={set('phone')} />
        <Field label="Email for bookings (optional)" type="email" value={f.email} onChange={set('email')} hint="Leave empty to use your sign-in email." />
        {msg ? <p style={{ color: 'var(--crit)' }}>{msg}</p> : null}
        <Btn kind="primary" size="lg" type="submit" disabled={busy} block>{busy ? 'Creating…' : 'Create my course'}</Btn>
        <Btn kind="ghost" onClick={() => navigate('/')}>Cancel</Btn>
      </form>
    </AuthFrame>
  );
}

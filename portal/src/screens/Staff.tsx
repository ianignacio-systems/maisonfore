import { useCallback, useEffect, useState } from 'react';
import { Btn, Field, Select } from '@maison/core/ui/kit';
import { api, type Role, type TeeHouseSetup } from '../api';

interface StaffList {
  staff: { email: string; role: Role; teeHouseId: string | null; since: number; you: boolean }[];
  invites: { email: string; role: Role; teeHouseId: string | null; invitedBy: string; at: number }[];
}

const ROLES: { value: Role; label: string; does: string }[] = [
  { value: 'owner', label: 'Owner', does: 'Everything, including staff and sending the course to Maison.' },
  { value: 'manager', label: 'Manager', does: 'Runs the tee sheet and changes Settings.' },
  { value: 'starter', label: 'Starter', does: 'Runs the tee sheet: bookings, holds, check-in, payments.' },
  { value: 'viewer', label: 'View only', does: 'Sees the tee sheet and bookings; changes nothing.' },
  { value: 'teehouse', label: 'Tee house', does: 'Charges food and drinks to golfers’ passports at one tee house. Sees nothing else.' },
];
const roleOptions = ROLES.map((r) => ({ value: r.value, label: r.label }));

/** Staff (owners only): add people by email with a role, change roles, remove them. */
export function Staff({ courseId, slug }: { courseId: string; slug: string }) {
  const [list, setList] = useState<StaffList | null>(null);
  const [f, setF] = useState<{ email: string; role: Role; teeHouseId: string }>({ email: '', role: 'starter', teeHouseId: '' });
  const [houses, setHouses] = useState<TeeHouseSetup[]>([]);
  useEffect(() => { void api<TeeHouseSetup[]>(`/courses/${courseId}/teehouses`).then((r) => setHouses(r.filter((h) => h.active))).catch(() => { /* none yet */ }); }, [courseId]);
  const houseOptions = houses.map((h) => ({ value: h.id, label: h.name }));
  const houseName = (id: string | null) => houses.find((h) => h.id === id)?.name ?? '';
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const link = `${location.origin}/${slug}`;

  const load = useCallback(() => api<StaffList>(`/courses/${courseId}/staff`).then(setList).catch((e) => setMsg({ text: (e as Error).message })), [courseId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (method: string, path: string, body: unknown, ok: string) => {
    setBusy(true); setMsg(null);
    try { setList(await api<StaffList>(`/courses/${courseId}/staff${path}`, { method, body })); setMsg({ text: ok, ok: true }); return true; }
    catch (e) { setMsg({ text: (e as Error).message }); return false; } finally { setBusy(false); }
  };
  const add = async () => {
    const email = f.email.trim().toLowerCase();
    if (await run('POST', '', { email, role: f.role, teeHouseId: f.role === 'teehouse' ? f.teeHouseId || houses[0]?.id : undefined }, '')) {
      setF({ ...f, email: '' });
      setMsg({ text: `Added ${email}. Ask them to sign in at ${link} with this email.`, ok: true });
    }
  };

  return (
    <div className="fore-staff">
      <header className="fore-set-head">
        <h2>Staff</h2>
        <p>Add the people who run your course. Each signs in with their own email, so the activity log shows who did what.</p>
      </header>

      <div className="fore-panel">
        <h3>Add someone</h3>
        <div className="fore-staff-add">
          <Field label="Email" type="email" value={f.email} onChange={(v) => setF({ ...f, email: v })} placeholder="name@example.com" onEnter={() => void add()} />
          <Select label="Role" value={f.role} onChange={(v) => setF({ ...f, role: v })} options={roleOptions} />
          {f.role === 'teehouse' ? (houses.length ? <Select label="Tee house" value={f.teeHouseId || houses[0]?.id} onChange={(v) => setF({ ...f, teeHouseId: v })} options={houseOptions} /> : <span className="muted small">Add tee houses in Settings first.</span>) : null}
          <Btn kind="primary" disabled={busy || !f.email.trim()} onClick={() => void add()}>Add to staff</Btn>
        </div>
        <ul className="fore-roles">
          {ROLES.map((r) => <li key={r.value}><b>{r.label}</b><span>{r.does}</span></li>)}
        </ul>
        <p className="muted small">If they already use MaisonPOS or MaisonFore, they’re added straight away. Otherwise they join the first time they sign in with that email.</p>
        {msg ? <p className={msg.ok ? 'fore-ok' : 'fore-error'} role="status">{msg.text}</p> : null}
      </div>

      <div className="fore-panel flush">
        {!list ? <p className="fore-empty-line">Loading…</p> : (
          <>
            {list.staff.map((s) => (
              <div key={s.email} className="fore-staff-row">
                <div className="who"><b>{s.email}</b><span>{s.you ? 'You' : `Since ${new Date(s.since).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })}`}{s.role === 'teehouse' ? `, ${houseName(s.teeHouseId) || 'no tee house'}` : ''}</span></div>
                <Select aria-label={`Role of ${s.email}`} value={s.role} onChange={(v) => void run('PUT', '', { email: s.email, role: v, teeHouseId: v === 'teehouse' ? s.teeHouseId ?? houses[0]?.id : undefined }, `${s.email} is now ${ROLES.find((r) => r.value === v)?.label.toLowerCase()}.`)} options={roleOptions} />
                {s.role === 'teehouse' && houses.length ? <Select aria-label={`Tee house of ${s.email}`} value={s.teeHouseId ?? ''} onChange={(v) => void run('PUT', '', { email: s.email, role: 'teehouse', teeHouseId: v }, `${s.email} now works at ${houseName(v)}.`)} options={houseOptions} /> : null}
                {s.you ? <span /> : <button className="fore-remove" disabled={busy} onClick={() => { if (confirm(`Remove ${s.email} from the staff?`)) void run('DELETE', `/${encodeURIComponent(s.email)}`, undefined, `Removed ${s.email}.`); }}>Remove</button>}
              </div>
            ))}
            {list.invites.map((i) => (
              <div key={i.email} className="fore-staff-row invite">
                <div className="who"><b>{i.email}</b><span>Hasn’t signed in yet{i.role === 'teehouse' ? `, ${houseName(i.teeHouseId) || 'no tee house'}` : ''}</span></div>
                <Select aria-label={`Role of ${i.email}`} value={i.role} onChange={(v) => void run('PUT', '', { email: i.email, role: v }, 'Role changed.')} options={roleOptions} />
                <button className="fore-remove" disabled={busy} onClick={() => void run('DELETE', `/${encodeURIComponent(i.email)}`, undefined, `Cancelled the invite for ${i.email}.`)}>Cancel invite</button>
              </div>
            ))}
          </>
        )}
      </div>
      <p className="muted small">Staff sign in at <b>{link}</b>.</p>
    </div>
  );
}

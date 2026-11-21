import { useEffect, useState } from 'react';
import { Area, Btn, Empty, PageHead, Pill } from '@maison/core/ui/kit';
import { api, type Course } from '../api';
import { Brand, navigate, STATUS } from '../App';

/** Maison admin: partner applications to review, and every course (ADM-4). */
export function Admin() {
  const [rows, setRows] = useState<Course[] | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api<Course[]>('/admin/courses').then(setRows).catch((e) => setMsg(e.message));
  useEffect(() => { void load(); }, []);
  const review = async (id: string, decision: string) => {
    setMsg(null);
    try { await api(`/admin/courses/${id}/review`, { method: 'POST', body: { decision, note: note[id] ?? '' } }); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const waiting = rows?.filter((c) => c.status === 'review') ?? [];
  return (
    <div className="page" style={{ margin: '0 auto' }}>
      <PageHead title="Maison admin" sub="Partner courses" right={<><Brand small /><Btn size="sm" kind="ghost" onClick={() => navigate('/')}>Back</Btn></>} />
      {msg ? <div className="alertbox crit">{msg}</div> : null}
      <h3>Waiting for review ({waiting.length})</h3>
      {waiting.length ? waiting.map((c) => (
        <div key={c.id} className="card">
          <div className="row wrap"><b className="grow">{c.name}</b><span className="muted small">maisonfore.com/{c.slug}</span></div>
          <p className="small">{c.address}, {c.city}, {c.province} · {c.phone}{c.email ? ` · ${c.email}` : ''}</p>
          {c.description ? <p className="small muted">{c.description}</p> : null}
          <Area label="Note to the course (needed to send back or decline)" value={note[c.id] ?? ''} onChange={(v) => setNote({ ...note, [c.id]: v })} />
          <div className="row wrap">
            <Btn kind="ok" onClick={() => void review(c.id, 'approve')}>Approve: go live</Btn>
            <Btn onClick={() => void review(c.id, 'send_back')}>Send back with note</Btn>
            <Btn kind="danger" onClick={() => void review(c.id, 'decline')}>Decline</Btn>
          </div>
        </div>
      )) : <Empty title="Nothing to review" />}
      <h3>All courses</h3>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Course</th><th>Where</th><th>Status</th><th /></tr></thead>
        <tbody>{rows?.map((c) => (
          <tr key={c.id}><td><b>{c.name}</b><div className="small muted">maisonfore.com/{c.slug}</div></td><td className="small">{c.city}, {c.province}</td>
            <td><Pill tone={c.status === 'live' ? 'ok' : c.status === 'review' ? 'info' : undefined}>{STATUS[c.status]}</Pill></td>
            <td>{c.status === 'live' ? <Btn size="sm" kind="ghost" onClick={() => void review(c.id, 'pause')}>Pause</Btn> : null}</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

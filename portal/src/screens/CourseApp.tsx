import { useCallback, useEffect, useState } from 'react';
import { Btn, Empty, PageHead, Pill } from '@maison/core/ui/kit';
import { formatDay } from '@maison/engine';
import { api, type CourseData, type Me } from '../api';
import { signOut } from '../auth';
import { navigate, STATUS } from '../App';
import { Settings } from './Settings';
import { Staff } from './Staff';
import { Overview } from './Overview';
import { TeeSheet } from './TeeSheet';

type Tab = 'overview' | 'today' | 'start' | 'setup' | 'staff' | 'activity';
const ROLE: Record<string, string> = { owner: 'Owner', manager: 'Manager', starter: 'Starter', viewer: 'View only' };
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

/** A course's portal: the tee sheet, getting started, setup and the activity log. */
export function CourseApp({ courseId, me }: { courseId: string; me: Me }) {
  const [data, setData] = useState<CourseData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [jump, setJump] = useState<{ day: string; n: number } | null>(null);
  const load = useCallback(async () => {
    try { setData(await api<CourseData>(`/courses/${courseId}`)); } catch (e) { setProblem((e as Error).message); }
  }, [courseId]);
  useEffect(() => { void load(); }, [load]);
  if (problem) return <div className="center"><Empty title="Couldn’t open the course" body={problem} action={<Btn onClick={() => void load()}>Try again</Btn>} /></div>;
  if (!data) return <div className="center muted">Loading…</div>;
  const canSetup = data.role === 'owner' || data.role === 'manager';
  const live = data.course.status === 'live';
  const done = data.readiness.filter((r) => r.done).length;
  // Owners and managers land on the overview (or setup until the course is ready); everyone else on the tee sheet.
  const current: Tab = tab === 'start' && live ? 'overview' : tab ?? (!canSetup ? 'today' : data.course.status === 'draft' ? 'start' : 'overview');
  const openDay = (day?: string) => { if (day) setJump((j) => ({ day, n: (j?.n ?? 0) + 1 })); setTab('today'); };
  const links: { id: Tab; ico: React.ReactNode; txt: string; badge?: string; show: boolean }[] = [
    { id: 'overview', ico: <Icon d="M4 20V10M10 20V4M16 20v-7M22 20H2" />, txt: 'Overview', show: canSetup },
    { id: 'today', ico: <Icon d="M7 21V4l10 4-10 4" />, txt: 'Tee sheet', show: true },
    { id: 'start', ico: <Icon d="M5 12l4 4L19 6" />, txt: 'Go live', badge: `${done}/${data.readiness.length}`, show: canSetup && !live },
    { id: 'setup', ico: <Icon d="M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4" />, txt: 'Settings', show: canSetup },
    { id: 'staff', ico: <Icon d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6" />, txt: 'Staff', show: data.role === 'owner' },
    { id: 'activity', ico: <Icon d="M5 6h14M5 12h14M5 18h9" />, txt: 'Activity log', show: canSetup },
  ];
  return (
    <div className="app">
      <aside className="side fore-rail">
        <div className="fore-rail-brand">
          <img src="/maison-mark-light.svg" alt="" />
          <div className="txt"><b>Maison<span>Fore</span></b><small>{data.course.name}</small></div>
        </div>
        <nav>
          {links.filter((l) => l.show).map((l) => (
            <a key={l.id} href="#" className={current === l.id ? 'on' : ''} aria-current={current === l.id ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setTab(l.id); }}>
              <span className="ico" aria-hidden>{l.ico}</span><span className="txt">{l.txt}</span>{l.badge ? <span className="fore-badge txt">{l.badge}</span> : null}
            </a>
          ))}
        </nav>
        <div className="me">
          <span className="txt fore-who-am-i">{me.account.email}<br /><small>{ROLE[data.role]}</small></span>
          {me.courses.length > 1 ? <button className="fore-rail-btn" onClick={() => navigate('/')}><span className="txt">Other courses</span></button> : null}
          <button className="fore-rail-btn" onClick={() => void signOut().then(() => location.assign('/'))}><span className="txt">Sign out</span></button>
        </div>
      </aside>
      <main className="main">
        {current === 'overview' ? <Overview data={data} openDay={openDay} openSetup={() => setTab('start')} /> : null}
        {current === 'today' ? <TeeSheet key={jump?.n ?? 0} initialDay={jump?.day} courseId={courseId} setup={data.setup} courseName={data.course.name} readOnly={data.role === 'viewer'} canSpecial={canSetup} /> : null}
        {current === 'staff' ? <Staff courseId={courseId} slug={data.course.slug} /> : null}
        {current === 'start' ? <GettingStarted data={data} reload={load} go={setTab} /> : null}
        {current === 'setup' ? <Settings data={data} reload={load} /> : null}
        {current === 'activity' ? <Activity courseId={courseId} /> : null}
      </main>
    </div>
  );
}

function GettingStarted({ data, reload, go }: { data: CourseData; reload: () => Promise<void>; go: (t: Tab) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = data.course;
  const ready = data.readiness.every((r) => r.done);
  const submit = async () => {
    setBusy(true); setMsg(null);
    try { await api(`/courses/${c.id}/submit`, { method: 'POST' }); await reload(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="page">
      <PageHead title="Go live" sub={<>Your course’s address: <b>maisonfore.com/{c.slug}</b></>} right={<Pill tone={c.status === 'live' ? 'ok' : c.status === 'review' ? 'info' : undefined}>{STATUS[c.status]}</Pill>} />
      {c.reviewNote && c.status !== 'live' ? <div className="alertbox warn"><b>Note from Maison:</b> {c.reviewNote}</div> : null}
      <div className="card">
        <h3>Before Maison reviews your course</h3>
        {data.readiness.map((r) => (
          <div key={r.step} className="row"><span className={`fore-tick${r.done ? ' done' : ''}`}>{r.done ? '✓' : ''}</span><span className="grow">{r.step}</span>{r.done ? null : <Btn size="sm" onClick={() => go('setup')}>Open settings</Btn>}</div>
        ))}
      </div>
      <div className="card">
        <h3>Then</h3>
        <p className="muted">Your staff can already use the tee sheet for phone and walk-in bookings. Once Maison approves your course, golfers can find it and book a tee time in the MaisonFore app.</p>
        {c.status === 'draft' || c.status === 'declined' ? (
          <div className="row wrap">
            <Btn kind="primary" disabled={!ready || busy || data.role !== 'owner'} onClick={() => void submit()}>{busy ? 'Sending…' : 'Send to Maison for review'}</Btn>
            {data.role !== 'owner' ? <span className="muted small">Only the owner can send it.</span> : null}
          </div>
        ) : c.status === 'review' ? <p><b>With Maison for review</b> since {c.submittedAt ? formatDay(new Date(c.submittedAt).toISOString().slice(0, 10)) : '—'}. We’ll email you when it’s approved.</p>
          : <p><b>{STATUS[c.status]}.</b></p>}
        {msg ? <p style={{ color: 'var(--crit)' }}>{msg}</p> : null}
      </div>
    </div>
  );
}

function Activity({ courseId }: { courseId: string }) {
  const [rows, setRows] = useState<{ id: string; at: number; by_name: string; action: string; subject: string; detail: string }[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { api<typeof rows>(`/courses/${courseId}/activity`).then(setRows).catch((e) => setProblem(e.message)); }, [courseId]);
  return (
    <div className="page">
      <PageHead title="Activity log" sub="Every booking, change, hold and setting, with who did it and when." />
      {problem ? <p style={{ color: 'var(--crit)' }}>{problem}</p> : null}
      {rows ? (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td className="small">{new Date(r.at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</td><td className="small">{r.by_name}</td><td><b>{ACTION[r.action] ?? r.action}</b><div className="small muted">{r.subject}</div></td><td className="small">{r.detail}</td></tr>
          ))}</tbody>
        </table></div>
      ) : <p className="muted">Loading…</p>}
    </div>
  );
}

const ACTION: Record<string, string> = {
  'course.created': 'Course added', 'course.updated': 'Course details changed', 'course.submitted': 'Sent for review', 'course.approve': 'Approved by Maison',
  'course.send_back': 'Sent back by Maison', 'course.decline': 'Declined by Maison', 'course.pause': 'Paused by Maison',
  'setup.teetimes': 'Tee time settings changed', 'setup.rates': 'Players, green fees or holidays changed', 'setup.rules': 'Booking rules changed', 'setup.fees': 'Fees changed', 'setup.options': 'Course options changed',
  'staff.added': 'Staff added', 'staff.invited': 'Staff invited', 'staff.joined': 'Joined the staff', 'staff.role': 'Role changed', 'staff.removed': 'Removed from the staff',
  'booking.created': 'Booking made', 'booking.special': 'Special booking accepted', 'booking.held': 'Slot held', 'booking.confirmed': 'Booking confirmed', 'booking.checked_in': 'Checked in', 'booking.played': 'Played',
  'booking.cancelled': 'Booking cancelled', 'booking.no_show': 'No-show', 'booking.moved': 'Booking moved', 'booking.edited': 'Booking edited', 'booking.paid': 'Paid at the counter',
  'block.walkin': 'Held for walk-ins', 'block.regulars': 'Held for regulars', 'block.event': 'Held for an event', 'block.maintenance': 'Closed for maintenance', 'block.weather': 'Closed for weather', 'block.removed': 'Hold or closure removed',
};

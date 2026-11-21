import { useCallback, useEffect, useState } from 'react';
import { Btn, Empty, Pill } from '@maison/core/ui/kit';
import { api, type Me } from './api';
import { currentEmail, LOCAL, onAuthChange, onPasswordRecovery, signOut } from './auth';
import { SetPassword } from './screens/SignIn';
import { Admin } from './screens/Admin';
import { CourseApp } from './screens/CourseApp';
import { NewCourse } from './screens/NewCourse';
import { SignIn } from './screens/SignIn';
import { AuthFrame } from './screens/AuthFrame';

/**
 * Addresses: /             your courses (or add one)
 *            /new          become a partner
 *            /admin        Maison admin (Maison staff only)
 *            /<course>     a course's portal, e.g. /valleygolfclub
 */
export function navigate(path: string) {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  return path;
}

export function App() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const path = usePath();
  const [recovering, setRecovering] = useState(false);
  useEffect(() => onPasswordRecovery(() => setRecovering(true)), []);

  const refresh = useCallback(async () => {
    const e = await currentEmail();
    setEmail(e);
    if (!e) { setMe(null); return; }
    try { setMe(await api<Me>('/me')); setProblem(null); } catch (err) { setProblem((err as Error).message); }
  }, []);
  useEffect(() => { void refresh(); return onAuthChange(() => void refresh()); }, [refresh]);

  if (recovering) return <SetPassword onDone={() => { setRecovering(false); void refresh(); }} />;
  if (email === undefined) return <div className="center muted">Loading…</div>;
  if (!email) return <SignIn onDone={refresh} />;
  if (problem) return <div className="center"><div className="panel card"><p>{problem}</p><Btn kind="primary" onClick={() => void refresh()}>Try again</Btn></div></div>;
  if (!me) return <div className="center muted">Loading…</div>;

  const first = path.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
  if (first === 'new') return <NewCourse onCreated={async (slug) => { await refresh(); navigate(`/${slug}`); }} />;
  if (first === 'admin' && me.admin) return <Admin />;
  if (first) {
    const c = me.courses.find((x) => x.slug === first);
    if (!c) return <div className="center"><div className="panel"><Empty title="Course not found" body="This address isn’t one of your courses. Ask the owner to add you." action={<Btn onClick={() => navigate('/')}>Your courses</Btn>} /></div></div>;
    return <CourseApp key={c.id} courseId={c.id} me={me} />;
  }
  return <Home me={me} />;
}

function Home({ me }: { me: Me }) {
  return (
    <AuthFrame headline="Good morning. Which course today?" body="Open a course to run its tee sheet, or add another course you manage.">
      <div className="col gap-lg" style={{ width: '100%', maxWidth: 420 }}>
        <div className="col">
          <h1>Your courses</h1>
          {me.courses.length ? me.courses.map((c) => (
            <button key={c.id} className="fore-pick" onClick={() => navigate(`/${c.slug}`)}>
              <b>{c.name}</b>
              <span className="row"><span className="muted small">maisonfore.com/{c.slug}</span><Pill tone={c.status === 'live' ? 'ok' : c.status === 'review' ? 'info' : undefined}>{STATUS[c.status]}</Pill></span>
            </button>
          )) : <p className="muted">You’re not on any course yet. Add your course, or ask its owner to add you.</p>}
          <Btn kind="primary" onClick={() => navigate('/new')}>Add your course</Btn>
          {me.admin ? <Btn kind="ghost" onClick={() => navigate('/admin')}>Maison admin</Btn> : null}
        </div>
        <p className="muted small" style={{ textAlign: 'center' }}>
          Signed in as {me.account.email}{LOCAL ? ' (local trial)' : ''} · <a href="#" onClick={(e) => { e.preventDefault(); void signOut().then(() => location.assign('/')); }}>Sign out</a>
        </p>
      </div>
    </AuthFrame>
  );
}

export const STATUS: Record<string, string> = { draft: 'Setting up', review: 'With Maison for review', live: 'Live', paused: 'Paused', declined: 'Declined' };

export function Brand({ small }: { small?: boolean }) {
  return (
    <div className={`fore-brand${small ? ' small' : ''}`}>
      <img src="/maison-mark.svg" alt="" />
      <div><b>Maison<span>Fore</span></b>{small ? null : <span className="muted small">for golf courses</span>}</div>
    </div>
  );
}

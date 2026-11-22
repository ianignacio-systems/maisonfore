import { useCallback, useEffect, useState } from 'react';
import { api, type Inbox as InboxData, type Me } from './api';
import { currentEmail, onAuthChange } from './auth';
import { Bookings } from './screens/Bookings';
import { Course } from './screens/Course';
import { Find } from './screens/Find';
import { Inbox } from './screens/Inbox';
import { Profile, ProfileSetup } from './screens/Profile';
import { NewPassword, SignIn } from './screens/SignIn';
import { Flag, go, Person, Ticket, usePath } from './ui';

/**
 * The MaisonFore golfer app, at /play:  /             find a course
 *                                       /c/<course>   a course's tee times and booking
 *                                       /bookings     my bookings
 *                                       /profile      my profile
 */
export function App() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const path = usePath();

  const refresh = useCallback(async () => {
    const e = await currentEmail();
    setEmail(e);
    if (!e) { setMe(null); return; }
    try { setMe(await api<Me>('/me')); setProblem(null); } catch (err) { setProblem((err as Error).message); }
  }, []);
  useEffect(() => { void refresh(); return onAuthChange((recovery) => { if (recovery) setRecovering(true); void refresh(); }); }, [refresh]);
  // Messages: checked every minute while the app is open (phone alerts reach golfers when it's closed).
  const [inbox, setInbox] = useState<InboxData | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const loadInbox = useCallback(() => api<InboxData>('/messages').then(setInbox).catch(() => { /* not signed in yet */ }), []);
  useEffect(() => {
    if (!me?.profile) return;
    void loadInbox();
    const t = setInterval(() => void loadInbox(), 60_000);
    const back = () => { if (document.visibilityState === 'visible') void loadInbox(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [me?.profile, loadInbox]);

  if (recovering) return <NewPassword onDone={() => { setRecovering(false); void refresh(); }} />;
  if (email === undefined) return <div className="pl-loading">MaisonFore</div>;
  if (!email) return <SignIn onDone={refresh} />;
  if (problem) return <div className="pl-center"><p>{problem}</p><button className="pl-btn primary" onClick={() => void refresh()}>Try again</button></div>;
  if (!me) return <div className="pl-loading">MaisonFore</div>;
  if (!me.profile) return <ProfileSetup email={me.email} onDone={(m) => setMe(m)} />;

  const [first, second] = path.split('/').filter(Boolean);
  const tab = first === 'bookings' ? 'bookings' : first === 'profile' ? 'profile' : 'find';
  return (
    <div className="pl-app">
      <main className="pl-main">
        {first === 'c' && second ? <Course slug={second} me={me} key={second} />
          : tab === 'bookings' ? <Bookings />
            : tab === 'profile' ? <Profile me={me} onSaved={setMe} />
              : <Find me={me} unread={inbox?.unread ?? 0} openInbox={() => setInboxOpen(true)} />}
      </main>
      {inboxOpen && inbox ? <Inbox data={inbox} onClose={() => setInboxOpen(false)} onRead={() => void loadInbox()} /> : null}
      <nav className="pl-tabs" aria-label="MaisonFore">
        <button className={tab === 'find' ? 'on' : ''} aria-current={tab === 'find' ? 'page' : undefined} onClick={() => go('/')}><Flag /><span>Play</span></button>
        <button className={tab === 'bookings' ? 'on' : ''} aria-current={tab === 'bookings' ? 'page' : undefined} onClick={() => go('/bookings')}><Ticket /><span>Bookings</span>{inbox?.messages.some((m) => !m.read && (m.kind === 'offer' || m.kind === 'open_now')) ? <i className="pl-dot" aria-label="A time opened for you" /> : null}</button>
        <button className={tab === 'profile' ? 'on' : ''} aria-current={tab === 'profile' ? 'page' : undefined} onClick={() => go('/profile')}><Person /><span>Profile</span></button>
      </nav>
    </div>
  );
}

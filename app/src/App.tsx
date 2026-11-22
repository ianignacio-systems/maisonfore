import { useCallback, useEffect, useState } from 'react';
import { api, type Me } from './api';
import { currentEmail, onAuthChange } from './auth';
import { Bookings } from './screens/Bookings';
import { Course } from './screens/Course';
import { Find } from './screens/Find';
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
              : <Find me={me} />}
      </main>
      <nav className="pl-tabs" aria-label="MaisonFore">
        <button className={tab === 'find' ? 'on' : ''} aria-current={tab === 'find' ? 'page' : undefined} onClick={() => go('/')}><Flag /><span>Play</span></button>
        <button className={tab === 'bookings' ? 'on' : ''} aria-current={tab === 'bookings' ? 'page' : undefined} onClick={() => go('/bookings')}><Ticket /><span>Bookings</span></button>
        <button className={tab === 'profile' ? 'on' : ''} aria-current={tab === 'profile' ? 'page' : undefined} onClick={() => go('/profile')}><Person /><span>Profile</span></button>
      </nav>
    </div>
  );
}

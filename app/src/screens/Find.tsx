import { useEffect, useState } from 'react';
import { localParts, peso } from '@maison/engine';
import { api, type CourseCard, type Me } from '../api';
import { clock, Days, go } from '../ui';

const today = () => localParts(Date.now(), 'Asia/Manila').day;
const greet = () => { const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' })); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

/** Find a course: pick a day, search by course or place, see prices and the next open tee times. */
export function Find({ me }: { me: Me }) {
  const [day, setDay] = useState(() => { try { return sessionStorage.getItem('pl.day') || today(); } catch { return today(); } });
  const [q, setQ] = useState('');
  const [list, setList] = useState<CourseCard[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pick = (d: string) => { setDay(d); try { sessionStorage.setItem('pl.day', d); } catch { /* fine */ } };

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api<CourseCard[]>(`/courses?day=${day}&q=${encodeURIComponent(q.trim())}`).then((r) => { if (live) { setList(r); setProblem(null); } }).catch((e) => setProblem((e as Error).message));
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [day, q]);

  const first = me.profile!.name.split(' ')[0];
  return (
    <div className="pl-page">
      <header className="pl-head">
        <p className="pl-kicker">{greet()}, {first}</p>
        <h1>Where are you playing?</h1>
      </header>
      <label className="pl-search">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Course, city or province" aria-label="Search courses" />
      </label>
      <Days from={today()} count={14} value={day} onPick={pick} />
      {problem ? <p className="pl-err">{problem}</p> : null}
      {!list ? <p className="pl-muted pl-pad">Finding courses…</p> : !list.length ? (
        <div className="pl-empty"><b>No courses found</b><p>{q ? 'Try another name or place.' : 'Partner courses will appear here as they join MaisonFore.'}</p></div>
      ) : (
        <ul className="pl-courses">
          {list.map((c) => (
            <li key={c.id}>
              <button className="pl-course" onClick={() => go(`/c/${c.slug}?day=${day}`)}>
                <span className="pl-course-band" aria-hidden><i />{c.holes.map((h) => <em key={h}>{h} holes</em>)}</span>
                <span className="pl-course-body">
                  <b>{c.name}</b>
                  <span className="pl-muted">{[c.city, c.province].filter(Boolean).join(', ')}</span>
                  <span className="pl-course-meta">
                    {c.fromPrice !== null ? <span>From <b>{peso(c.fromPrice).replace(/\.00$/, '')}</b> a player</span> : null}
                    <span className={c.openSlots ? 'open' : 'none'}>{c.notYet ? 'Not open for booking yet' : c.openSlots ? `${c.openSlots} open tee ${c.openSlots === 1 ? 'time' : 'times'}` : day === today() ? 'No more times today' : 'Fully booked'}</span>
                  </span>
                  {c.nextTimes.length ? <span className="pl-times-peek">{c.nextTimes.map((t) => <i key={t}>{clock(t).replace(':00 ', ' ')}</i>)}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

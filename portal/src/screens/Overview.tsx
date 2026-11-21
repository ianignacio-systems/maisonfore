import { useEffect, useState } from 'react';
import { Btn } from '@maison/core/ui/kit';
import { formatDay, formatTime, peso, STATUS_WORDS, weekday } from '@maison/engine';
import { api, type CourseData } from '../api';

interface OverviewData {
  today: string; nowMin: number;
  todayFigures: { players: number; capacity: number; bookings: number; checkedIn: number; noShows: number; booked: number; collected: number; closedNote: string | null };
  next: { id: string; time: number; special?: boolean; startTee: string; name: string; players: number; status: string; paid: boolean }[];
  week: { day: string; used: number; capacity: number; bookings: number; closed: boolean }[];
  attention: { kind: string; text: string; day: string }[];
  last30: {
    rounds: number; players: number; revenue: number; noShows: number; noShowRate: number;
    byChannel: { channel: string; rounds: number; players: number; revenue: number }[];
    byPlayerType: { name: string; players: number; greenFees: number }[];
  };
}

const CHANNEL: Record<string, string> = { phone: 'Phone', viber: 'Viber', walkin: 'Walk-in', app: 'MaisonFore app', staff: 'Staff' };
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Owners and managers: today at a glance, money still to collect, what needs attention, the week ahead, the last 30 days. */
export function Overview({ data, openDay, openSetup }: { data: CourseData; openDay: (day?: string) => void; openSetup: () => void }) {
  const [o, setO] = useState<OverviewData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api<OverviewData>(`/courses/${data.course.id}/overview`).then((r) => { setO(r); setProblem(null); }).catch((e) => setProblem((e as Error).message));
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [data.course.id]);

  const live = data.course.status === 'live';
  const done = data.readiness.filter((r) => r.done).length;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="fore-ov">
      <header className="fore-ov-head">
        <span className="fore-kicker">{o ? formatDay(o.today) : ''}</span>
        <h1>{greet}</h1>
      </header>

      {!live ? (
        <div className="fore-ov-setup">
          <div><b>{data.course.status === 'review' ? 'Maison is reviewing your course.' : 'Golfers can’t find your course in the app yet.'}</b>
            <span>{data.course.status === 'review' ? 'Your staff can already take phone and walk-in bookings.' : done === data.readiness.length ? 'Setup is done. Send your course to Maison to go live.' : `${done} of ${data.readiness.length} setup steps done.`}</span></div>
          <Btn onClick={openSetup}>{data.course.status === 'review' ? 'See status' : done === data.readiness.length ? 'Go live' : 'Finish setting up'}</Btn>
        </div>
      ) : null}

      {problem ? <p className="fore-alert crit">{problem}</p> : null}
      {!o ? <p className="fore-empty">Loading…</p> : (
        <>
          <section className="fore-ov-figs" aria-label="Today">
            <Fig label="Players today" value={`${o.todayFigures.players}`} sub={`of ${o.todayFigures.capacity} spots, ${pct(o.todayFigures.players, o.todayFigures.capacity)}% full`}
              bar={pct(o.todayFigures.players, o.todayFigures.capacity)} />
            <Fig label="Checked in" value={`${o.todayFigures.checkedIn}`} sub={`of ${o.todayFigures.players} players, ${o.todayFigures.bookings} bookings`} />
            <Fig label="Booked today" value={peso(o.todayFigures.booked)} sub={o.todayFigures.booked ? `${peso(o.todayFigures.collected)} collected, ${peso(Math.max(0, o.todayFigures.booked - o.todayFigures.collected))} to go` : 'Not counting fees paid separately'} />
            <Fig label="No-shows, last 30 days" value={`${o.last30.noShows}`} sub={o.last30.noShows ? `${Math.round(o.last30.noShowRate * 100)}% of bookings` : 'None'} />
          </section>
          {o.todayFigures.closedNote ? <p className="fore-alert warn">{o.todayFigures.closedNote}</p> : null}

          <div className="fore-ov-cols">
            <section className="fore-panel">
              <div className="fore-ov-title"><h3>Coming up</h3><button className="fore-link" onClick={() => openDay(o.today)}>Open the tee sheet</button></div>
              {o.next.length ? (
                <ol className="fore-ov-next">
                  {o.next.map((n) => (
                    <li key={n.id}>
                      <span className="tm">{n.time < 0 ? 'No set time' : formatTime(n.time)}</span>
                      <span className="nm"><b>{n.name}</b><small>{n.players} {n.players === 1 ? 'player' : 'players'}{n.startTee !== '1' ? `, tee ${n.startTee}` : ''}{n.special ? ', special booking' : ''}</small></span>
                      <span className={`fore-status s-${n.status}`}>{STATUS_WORDS[n.status as keyof typeof STATUS_WORDS] ?? n.status}</span>
                      <span className="pay ok">{n.paid ? 'Paid' : ''}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className="fore-empty-line">No more flights today.</p>}
            </section>

            <section className="fore-panel">
              <div className="fore-ov-title"><h3>Needs attention</h3></div>
              {o.attention.length ? (
                <ul className="fore-ov-attn">
                  {o.attention.map((a, i) => (
                    <li key={i} className={`k-${a.kind}`}>
                      <span>{a.text}</span>
                      {a.kind === 'staff' ? null : <button className="fore-link" onClick={() => openDay(a.day)}>{a.day === o.today ? 'Open today' : `Open ${SHORT[weekday(a.day)]} ${Number(a.day.slice(8))}`}</button>}
                    </li>
                  ))}
                </ul>
              ) : <p className="fore-empty-line">Nothing needs attention.</p>}
            </section>
          </div>

          <section className="fore-panel">
            <div className="fore-ov-title"><h3>The week ahead</h3><span className="muted small">Player spots booked</span></div>
            <div className="fore-ov-week">
              {o.week.map((d) => {
                const p = pct(d.used, d.capacity);
                return (
                  <button key={d.day} className={`${d.day === o.today ? 'today' : ''}${d.closed ? ' closed' : ''}`} onClick={() => openDay(d.day)} aria-label={`${formatDay(d.day)}: ${d.used} of ${d.capacity} players`}>
                    <span className="pc">{d.closed ? 'Closed' : `${p}%`}</span>
                    <span className="col"><i style={{ height: `${d.closed ? 0 : Math.max(p, d.used ? 4 : 0)}%` }} /></span>
                    <span className="dl"><b>{SHORT[weekday(d.day)]}</b> {Number(d.day.slice(8))}</span>
                    <span className="ct">{d.used} of {d.capacity}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="fore-panel">
            <div className="fore-ov-title"><h3>Last 30 days</h3><span className="muted small">{o.last30.rounds} rounds, {o.last30.players} players, {peso(o.last30.revenue)}</span></div>
            {o.last30.rounds ? (
              <div className="fore-ov-cols">
                <table className="fore-ov-table">
                  <thead><tr><th>Booked by</th><th>Players</th><th>Revenue</th></tr></thead>
                  <tbody>{o.last30.byChannel.map((c) => <tr key={c.channel}><td>{CHANNEL[c.channel] ?? c.channel}</td><td>{c.players}</td><td>{peso(c.revenue)}</td></tr>)}</tbody>
                </table>
                <table className="fore-ov-table">
                  <thead><tr><th>Player type</th><th>Players</th><th>Green fees</th></tr></thead>
                  <tbody>{o.last30.byPlayerType.map((t) => <tr key={t.name}><td>{t.name}</td><td>{t.players}</td><td>{peso(t.greenFees)}</td></tr>)}</tbody>
                </table>
              </div>
            ) : <p className="fore-empty-line">No rounds played yet. Numbers appear here once golfers check in.</p>}
          </section>
        </>
      )}
    </div>
  );
}

function Fig({ label, value, sub, bar }: { label: string; value: string; sub: string; bar?: number }) {
  return (
    <div className="fore-ov-fig">
      <span className="lb">{label}</span>
      <b>{value}</b>
      {bar !== undefined ? <span className="fore-fill-bar"><span style={{ width: `${bar}%` }} /></span> : null}
      <span className="sb">{sub}</span>
    </div>
  );
}

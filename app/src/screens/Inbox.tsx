import { useEffect, useState } from 'react';
import { api, type Inbox as InboxData } from '../api';
import { alertState, turnOffAlerts, turnOnAlerts, type AlertState } from '../push';
import { Button, go, Sheet } from '../ui';

const ago = (at: number) => {
  const m = Math.round((Date.now() - at) / 60_000);
  return m < 1 ? 'Just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(at).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' });
};

/** The golfer's messages: payment reminders, waitlist offers, times that opened, changes by the course. */
export function Inbox({ data, onClose, onRead }: { data: InboxData; onClose: () => void; onRead: () => void }) {
  useEffect(() => { if (data.unread) void api('/messages/read', { method: 'POST' }).then(onRead); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (link: string) => { onClose(); if (link) go(link.replace(/^\/play/, '') || '/'); };
  return (
    <Sheet title="Messages" onClose={onClose}>
      <AlertsSwitch />
      {!data.messages.length ? <div className="pl-empty"><b>No messages yet</b><p>Payment reminders and waitlist news show up here.</p></div> : (
        <ul className="pl-inbox">
          {data.messages.map((m) => (
            <li key={m.id} className={`${m.read ? '' : 'unread'} k-${m.kind}`}>
              <button onClick={() => open(m.link)}>
                <span className="t"><b>{m.title}</b><small>{ago(m.at)}</small></span>
                <span className="b">{m.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/** Phone alerts on or off for this phone, with plain words when they can't be turned on. */
export function AlertsSwitch() {
  const [state, setState] = useState<AlertState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void alertState().then(setState); }, []);
  const flip = async () => {
    setBusy(true); setMsg(null);
    try {
      if (state === 'on') await turnOffAlerts(); else setMsg(await turnOnAlerts());
      setState(await alertState());
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  if (!state) return null;
  return (
    <div className="pl-alerts">
      <span><b>Phone alerts</b><small>{state === 'on' ? 'On for this phone: reminders to pay and waitlist offers.' : state === 'blocked' ? 'Blocked. Allow alerts for MaisonFore in your phone’s settings.'
        : state === 'install-first' ? 'On iPhone, add MaisonFore to your home screen first (Share → Add to Home Screen).' : state === 'unsupported' ? 'This browser can’t show alerts.' : 'Get a buzz when a waitlist time opens or it’s time to pay.'}</small></span>
      {state === 'on' || state === 'off' ? <Button kind={state === 'on' ? 'line' : 'primary'} disabled={busy} onClick={() => void flip()}>{state === 'on' ? 'Turn off' : 'Turn on'}</Button> : null}
      {msg ? <p className="pl-muted small" role="status">{msg}</p> : null}
    </div>
  );
}

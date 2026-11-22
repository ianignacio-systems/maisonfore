import { api } from './api';

/**
 * Phone alerts (Web Push). Android phones and computers can get them in the browser; on an iPhone the app
 * must first be added to the home screen (Share → Add to Home Screen), then alerts can be turned on there.
 */
export type AlertState = 'on' | 'off' | 'blocked' | 'unsupported' | 'install-first';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export async function alertState(): Promise<AlertState> {
  if (!supported()) return isIos() && !installed() ? 'install-first' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration('/play/');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

function keyBytes(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Asks the phone's permission and signs this phone up for alerts. Returns a sentence to show if it can't. */
export async function turnOnAlerts(): Promise<string | null> {
  if (!supported()) return isIos() ? 'On iPhone, first add MaisonFore to your home screen (Share → Add to Home Screen), then open it from there.' : 'This browser can’t show alerts. Try Chrome on Android, or the app on your home screen.';
  const { key } = await api<{ key: string | null }>('/push-key');
  if (!key) return 'Alerts aren’t switched on for MaisonFore yet. You’ll still see every update here in the app.';
  const ok = await Notification.requestPermission();
  if (ok !== 'granted') return 'Alerts are blocked for MaisonFore. Allow them in your phone’s settings for this site.';
  const reg = (await navigator.serviceWorker.getRegistration('/play/')) ?? (await navigator.serviceWorker.register('/play/sw.js', { scope: '/play/' }));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource }));
  await api('/push', { method: 'POST', body: { subscription: sub.toJSON() } });
  return null;
}

export async function turnOffAlerts() {
  const reg = await navigator.serviceWorker.getRegistration('/play/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api('/push/off', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => { /* gone already */ });
  await sub.unsubscribe();
}

// MaisonFore app: makes it installable and opens quickly. Pages and assets come from the network first and
// fall back to the last copy; the API is never cached, so tee times are always live.
const CACHE = 'maisonfore-play-v2';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.add('/play/'))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/play/')) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((m) => m || caches.match('/play/'))));
});

// Phone alerts: a payment reminder, a waitlist offer, a time that just opened.
self.addEventListener('push', (e) => {
  let m = { title: 'MaisonFore', body: '', link: '/play/' };
  try { m = { ...m, ...e.data.json() }; } catch { /* plain text */ }
  e.waitUntil(self.registration.showNotification(m.title, { body: m.body, icon: '/play/icon-192.png', badge: '/play/icon-192.png', data: { link: m.link }, tag: m.link }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '/play/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    const w = ws.find((c) => c.url.includes('/play'));
    if (w) { w.focus(); return w.navigate(link); }
    return self.clients.openWindow(link);
  }));
});

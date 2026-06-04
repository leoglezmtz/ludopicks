// LudoPicks Service Worker — maneja notificaciones push
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { return; }

  const opts = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag: data.tag || 'ludopicks',
    renotify: true,
    requireInteraction: false,
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
  };

  e.waitUntil(self.registration.showNotification(data.title || 'LudoPicks', opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const open = cs.find(c => c.url.includes('ludopicks'));
      if (open) { open.focus(); return; }
      self.clients.openWindow(url);
    })
  );
});

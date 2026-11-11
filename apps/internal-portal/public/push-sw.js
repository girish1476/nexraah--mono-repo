/*
 * Nexraah notifications — the part that lives in the browser after the tab is
 * closed. It shows what the server pushes (internal-api `web-push.ts`, payload
 * `{ title, body, url, tag }`) and opens the page it names when tapped.
 *
 * Kept to those two jobs: no caching, no offline pages, so it cannot serve a
 * stale screen. The same file is in both apps' `public/`.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'Nexraah', {
      body: message.body || '',
      icon: '/logo.png',
      badge: '/logo.png',
      tag: message.tag,
      data: { url: message.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only ever a page on this site — a link elsewhere is opened as the home page.
  let target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = open.find((c) => c.url === target.href);
      if (same) return same.focus();
      const any = open.find((c) => 'navigate' in c);
      if (any) {
        await any.focus();
        return any.navigate(target.href);
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});

// Web push for the Matchr web app. Registered from src/services/pushNotifications.ts
// with scope /app/. The server sends { title, body, data } (see notificationService).

self.addEventListener('push', (event) => {
  const msg = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(msg.title || 'Matchr', {
      body: msg.body || '',
      data: msg.data || {},
      icon: self.registration.scope + 'icon.png',
    }),
  );
});

// The app knows the user's role, which picks the screen, so routing happens
// there: an open tab gets a message, otherwise a new tab opens with ?push=.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((t) => t.url.startsWith(self.registration.scope));
    if (tab) {
      await tab.focus();
      tab.postMessage({ type: 'matchr-push-open', data });
      return;
    }
    await self.clients.openWindow(self.registration.scope + '?push=' + encodeURIComponent(JSON.stringify(data)));
  })());
});

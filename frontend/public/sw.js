self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'HelpDesk_X', { body: data.body || 'Nueva notificación.', icon: '/logo192.png', badge: '/favicon.ico', data: { ticketId: data.ticketId }, requireInteraction: true }));
});
self.addEventListener('notificationclick', (event) => { event.notification.close(); event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => windows[0] ? windows[0].focus() : clients.openWindow('/'))); });

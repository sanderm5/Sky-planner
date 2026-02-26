// Unregister legacy service worker from old Astro site
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => {
  self.registration.unregister();
  self.clients.matchAll().then(clients => {
    clients.forEach(client => client.navigate(client.url));
  });
});

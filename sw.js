// Service worker: najpierw sieć (zawsze świeża wersja), pamięć podręczna tylko gdy brak zasięgu.
// Nie dotyka danych wizyt — te są w localStorage/IndexedDB albo w Supabase.
const CACHE = 'form3la-v1';
const SHELL = ['./', './index.html', './admin.html', './css/app.css', './js/util.js', './js/slots.js', './js/ui.js',
  './js/store.js', './js/store-demo.js', './js/seed.js', './js/config.js', './js/ics.js', './js/client.js', './js/admin.js', './icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

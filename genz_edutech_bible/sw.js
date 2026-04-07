const CACHE_NAME = 'genz-bible-pwa-v8';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './kjv-part-01.js', './kjv-part-02.js', './kjv-part-03.js', './kjv-part-04.js', './kjv-part-05.js', './kjv-part-06.js', './kjv-part-07.js', './kjv-part-08.js', './kjv-part-09.js', './kjv-part-10.js', './kjv-part-11.js', './kjv-part-12.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(response => {
        if (response && response.status === 200 && req.url.startsWith(self.location.origin)) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, cloned));
        }
        return response;
      }).catch(() => cached || caches.match('./index.html'));
      return cached || fetchPromise;
    })
  );
});

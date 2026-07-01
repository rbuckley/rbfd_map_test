// Service worker: cache-first offline support. Bump CACHE_VERSION whenever the
// app shell or map data changes so clients pull fresh files.
const CACHE_VERSION = 'rbfd-map-v43';

const CORE_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/districts.js',
  './js/map.js',
  './js/quiz.js',
  './js/builder.js',
  './js/mapImporter.js',
  './js/storage.js',
  './js/renames.js',
  './data/d1/streets.json',
  './data/d1/map.svg',
  './data/d2/streets.json',
  './data/d2/map.svg',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        // Cache successful same-origin responses for next time.
        if (resp.ok && new URL(event.request.url).origin === self.location.origin) {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});

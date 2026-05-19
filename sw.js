// CarCare POS Service Worker
// Strategy: Network-first for HTML, Cache-first for assets

const CACHE_NAME = 'carcare-v1';
const STATIC_ASSETS = [
  './index.html',
  './desktop.html',
];

// Install — pre-cache nothing, let network handle it
self.addEventListener('install', e => {
  self.skipWaiting();
});

// Activate — clear old caches immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — always network first, fallback to cache
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET and cross-origin requests (Firebase, Line API etc.)
  if (e.request.method !== 'GET') return;
  if (!url.origin.includes(self.location.origin)) return;

  // For HTML files — always go to network, no cache
  if (e.request.mode === 'navigate' ||
      url.pathname.endsWith('.html') ||
      url.pathname === '/') {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // For JS/CSS/images — network first, then cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache a copy
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

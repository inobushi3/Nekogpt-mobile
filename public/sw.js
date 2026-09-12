const CACHE_NAME = 'nekogpt-mobile-v6';
const STATIC_SHELL = [
  '/manifest.webmanifest',
  '/neko-mark.svg',
  '/nekogpt-logo.png',
  '/neko-icon-192.png',
  '/neko-icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key === CACHE_NAME) return undefined;
            if (key.startsWith('nekogpt-mobile-')) return caches.delete(key);
            return undefined;
          })
        )
      ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Never serve the application document from Cache Storage. This prevents
  // an older Vercel build from being resurrected after a deployment.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  const requestUrl = new URL(event.request.url);
  const sameOrigin = requestUrl.origin === self.location.origin;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (sameOrigin && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

const CACHE_NAME = 'upfield-cache-v1';

// Add the core files you want to cache for offline availability
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './home.html',
  './entry.html',
  './submit.html',
  './reports.html',
  './manifest.json',
  './images/icon.png'
];

// Install Event: Cache essential files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching offline assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate Event: Clean up old caches if we update the CACHE_NAME
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event: Network-First strategy (great for dynamic apps)
self.addEventListener('fetch', (event) => {
  // Only handle GET requests (Firebase handles its own POST/Firestore traffic)
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If network works, save a clone to the cache for later and return it
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // If network fails (offline), return the cached version
        console.log('[Service Worker] Network failed, serving from cache:', event.request.url);
        return caches.match(event.request);
      })
  );
});

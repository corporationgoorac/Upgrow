const CACHE_NAME = 'upgrow-cache-v1';

// Add the core files you want to work offline here
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/login.html',
  '/home.html',
  '/lines.html',
  '/assignLines.html',
  '/approval.html',
  '/review.html',
  '/manage.html',
  '/config.js',
  '/manifest.json',
  '/images/icon.png'
];

// 1. Install Event - Caches the files when the app is first loaded
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache and caching assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// 2. Activate Event - Cleans up old caches if you update the CACHE_NAME version
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// 3. Fetch Event - Intercepts network requests and serves from cache if available
self.addEventListener('fetch', (event) => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') return;

  // Don't intercept Firebase API/Firestore database calls (Firestore handles its own offline cache)
  if (event.request.url.includes('firestore.googleapis.com') || event.request.url.includes('identitytoolkit.googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return the cached file if found
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Otherwise, fetch from the network
      return fetch(event.request).catch(() => {
        // If network fails and it's an HTML page request, you could optionally return a fallback page here
        console.log('Fetch failed; returning offline page instead.', event.request.url);
      });
    })
  );
});

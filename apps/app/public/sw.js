// Sky Planner Service Worker
// Handles caching strategies for offline support

const SHELL_CACHE = 'skyplanner-shell-v5';
const CDN_CACHE = 'skyplanner-cdn-v1';
const TILE_CACHE = 'skyplanner-tiles-v1';
const API_CACHE = 'skyplanner-api-v1';

const MAX_TILE_CACHE = 2000;

// App shell files to precache
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.js?v=20260226-ui-cleanup',
  '/style.css?v=20260226-ui-cleanup',
  '/offline-storage.js?v=1',
  '/sync-manager.js?v=1',
  '/skyplanner-logo.svg',
  '/skyplanner-logo-text.svg',
  '/logo.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json',
  '/auth-pages.css'
];

// CDN patterns to cache
const CDN_PATTERNS = [
  'api.mapbox.com/mapbox-gl-js',
  'unpkg.com/supercluster',
  'cdnjs.cloudflare.com/ajax/libs/font-awesome',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// Tile URL pattern (Mapbox GL JS vector tiles)
const TILE_PATTERN = /api\.mapbox\.com\/(v4|styles\/v1)\/.+\/(tiles|sprite|glyphs)/;

// API patterns that can be cached for offline
const CACHEABLE_API = [
  '/api/todays-work/my-route',
  '/api/kunder',
  '/api/ruter',
  '/api/config',
  '/api/klient/dashboard'
];

// Install: precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => {
        console.warn('SW: Precache failed, continuing:', err);
        return self.skipWaiting();
      })
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key.startsWith('skyplanner-') && key !== SHELL_CACHE && key !== CDN_CACHE && key !== TILE_CACHE && key !== API_CACHE)
          .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: route to appropriate caching strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const request = event.request;

  // Only handle GET requests for caching
  if (request.method !== 'GET') return;

  // Skip non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  // 1. CDN resources: cache-first
  if (isCdnResource(url.href)) {
    event.respondWith(cacheFirst(request, CDN_CACHE));
    return;
  }

  // 2. Map tiles: cache-first with LRU
  if (TILE_PATTERN.test(url.href)) {
    event.respondWith(cacheTile(request));
    return;
  }

  // 3. API requests: network-first with cache fallback
  if (url.pathname.startsWith('/api/') && isCacheableApi(url.pathname)) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // 4. App shell: cache-first for known assets
  if (isShellAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // 5. Navigation requests (HTML): network-first, fall back to cached index
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function(response) {
        // If server returns maintenance page, show it directly (don't fall back to cached app)
        if (response.status === 503 && response.headers.get('X-Maintenance') === 'true') {
          return response;
        }
        return response;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }
});

// Background sync for offline mutations
self.addEventListener('sync', (event) => {
  if (event.tag === 'skyplanner-sync') {
    event.waitUntil(replayPendingActions());
  }
});

// === Caching strategies ===

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Return a basic offline response for failed requests
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) {
      // Add header to indicate cached response
      const headers = new Headers(cached.headers);
      headers.set('X-Served-From', 'cache');
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: headers
      });
    }
    return new Response(JSON.stringify({ success: false, offline: true, message: 'Ingen nettverkstilkobling' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function cacheTile(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(TILE_CACHE);
      cache.put(request, response.clone());
      // Evict old tiles if cache is too large (fire-and-forget)
      evictOldTiles().catch(() => {});
    }
    return response;
  } catch (err) {
    // Return a transparent 1x1 PNG as placeholder
    return new Response(
      Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0)),
      { headers: { 'Content-Type': 'image/png' } }
    );
  }
}

// === Helper functions ===

function isCdnResource(href) {
  return CDN_PATTERNS.some(pattern => href.includes(pattern));
}

function isCacheableApi(pathname) {
  return CACHEABLE_API.some(api => pathname.startsWith(api));
}

function isShellAsset(pathname) {
  // Match shell assets by their base path (ignore query string)
  const basePaths = SHELL_ASSETS.map(a => a.split('?')[0]);
  return basePaths.includes(pathname) || pathname === '/';
}

async function evictOldTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_TILE_CACHE) {
    // Delete oldest entries (first in, first out)
    const toDelete = keys.slice(0, keys.length - MAX_TILE_CACHE);
    await Promise.all(toDelete.map(key => cache.delete(key)));
  }
}

// Replay queued offline actions
async function replayPendingActions() {
  // Open IndexedDB to get pending actions
  const db = await openDB();
  if (!db) return;

  const tx = db.transaction('syncQueue', 'readonly');
  const store = tx.objectStore('syncQueue');
  const statusIndex = store.index('status');
  const request = statusIndex.getAll('pending');

  const actions = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  if (!actions || actions.length === 0) {
    db.close();
    return;
  }

  // Replay each action in order
  for (const action of actions) {
    try {
      const response = await fetch(action.url, {
        method: action.method,
        headers: action.headers || { 'Content-Type': 'application/json' },
        body: action.body ? JSON.stringify(action.body) : undefined,
        credentials: 'include'
      });

      if (response.ok) {
        // Mark as synced
        const writeTx = db.transaction('syncQueue', 'readwrite');
        const writeStore = writeTx.objectStore('syncQueue');
        writeStore.delete(action.id);
        await new Promise((resolve, reject) => {
          writeTx.oncomplete = resolve;
          writeTx.onerror = reject;
        });
      } else {
        // Increment retry count
        const writeTx = db.transaction('syncQueue', 'readwrite');
        const writeStore = writeTx.objectStore('syncQueue');
        action.retryCount = (action.retryCount || 0) + 1;
        action.lastError = `HTTP ${response.status}`;
        writeStore.put(action);
        await new Promise((resolve, reject) => {
          writeTx.oncomplete = resolve;
          writeTx.onerror = reject;
        });
      }
    } catch (err) {
      // Network still unavailable, stop retrying
      break;
    }
  }

  db.close();

  // Notify clients that sync is complete
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'sync-complete' });
  });
}

// Open IndexedDB (shared schema with offline-storage.js)
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('skyplanner-offline', 1);
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('syncQueue')) {
        const store = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('todaysRoute')) {
        db.createObjectStore('todaysRoute', { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains('customers')) {
        const custStore = db.createObjectStore('customers', { keyPath: 'id' });
        custStore.createIndex('organization_id', 'organization_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('routes')) {
        db.createObjectStore('routes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
  });
}

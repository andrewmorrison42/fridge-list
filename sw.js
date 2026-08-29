/* The Fridge List — service worker (v21.2)
 *
 * Purpose: make the app open and work in a supermarket with one bar of signal.
 * Before this, every launch pulled ~1.2MB of index.html from GitHub Pages, so a weak
 * connection meant the shopping list simply would not open.
 *
 * The deliberate design constraint is the opposite risk: a service worker that caches
 * too eagerly pins a family on a stale build, and this app ships as a single file, so
 * a stale cache means stale everything. So:
 *
 *   - The page itself is NETWORK-FIRST. Online, you always get the newest build; the
 *     cache is only reached for if the network fails or is too slow. An update can
 *     never be "stuck" behind the cache the way a cache-first worker would allow.
 *   - Icons and the manifest are cache-first. They are content-addressed by name and
 *     change only when the app does, and a new CACHE version drops them anyway.
 *   - Everything cross-origin is left completely alone: Microsoft Graph, the MSAL
 *     redirect flow, and the MSAL CDN script must never be served from a cache. Auth
 *     and sync are meaningless offline, and the app already degrades to local-only
 *     when MSAL fails to load.
 *
 * Bump CACHE on every release. Old caches are deleted on activate.
 */
const CACHE = 'fridge-list-v23.1';

// Same-origin assets worth having before the first offline launch. The page itself is
// added on the fly by the fetch handler, so a failed precache can never block install.
const PRECACHE = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

// How long to wait for the network before falling back to the cached page. Long enough
// not to serve stale content on a merely slow connection, short enough that a dead
// connection doesn't leave someone staring at a white screen in aisle 7.
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(PRECACHE.map(u => c.add(u))))
      // Take over as soon as the new worker is ready rather than waiting for every tab
      // to close — an update should reach the phone on the next launch, not next week.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Let the page tell a waiting worker to activate immediately (see the update prompt
// in index.html).
self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

function isPageRequest(request) {
  return request.mode === 'navigate'
      || (request.destination === 'document')
      || (request.headers.get('accept') || '').includes('text/html');
}

// Network first, with a timeout, falling back to whatever we cached last.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    // cache: 'no-store' keeps the HTTP cache out of the decision — we want a real
    // network check here, and our own Cache Storage entry is the fallback.
    const fresh = await fetch(request, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (fresh && fresh.ok) {
      // Only same-origin, basic responses are worth storing; never store an opaque one.
      if (fresh.type === 'basic') cache.put(request, fresh.clone());
      return fresh;
    }
    // A real HTTP error (404/500) is still a genuine answer from the server. Prefer the
    // cached page if we have one, so a transient deploy blip doesn't break the app.
    const cached = await cache.match(request) || await cache.match('./');
    return cached || fresh;
  } catch (e) {
    const cached = await cache.match(request) || await cache.match('./');
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok && fresh.type === 'basic') cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', event => {
  const request = event.request;

  // Never touch anything but plain GETs, and never touch another origin. Graph API
  // calls, the MSAL CDN and the sign-in redirect all fall through untouched.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isPageRequest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

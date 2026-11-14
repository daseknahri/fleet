// GA-Q4-4 (#54): admin service worker — hand-written, dependency-free.
//
// Dependency decision (see BUILD54Q-REPORT.md): no vite-plugin-pwa / workbox.
// The admin build hashes every asset filename (entries/[name]-[hash].js,
// chunks/[name]-[hash].js, assets/[name]-[hash][extname]), so a build-time
// precache list is NOT available to a hand-written SW — and this app does
// not need one. A runtime cache fills on fetch instead (see below), which
// covers every hashed asset without knowing its name in advance, with zero
// new dependencies and zero build-plugin coupling.
//
// Caching policy:
// - API calls (/api/*): NETWORK-ONLY, never cached — no stale data, no
//   cached auth. The fetch handler returns without respondWith, so the
//   request goes to the network untouched.
// - Navigation requests: network-first, falling back to the cached app
//   shell (index.html) only when the network fails.
// - Static build assets (same-origin GET, JS/CSS/images/fonts): stale-
//   while-revalidate — serve the cached copy instantly, refresh it in the
//   background. Only HTTP 200 same-origin responses are stored.
// - Everything else (non-GET, cross-origin): network-only.
// - Mutations are NOT cached or queued anywhere here: the app layer blocks
//   them while offline (axiosInstance + OfflineBanner).
//
// CACHE_NAME is versioned: bump it (ga-admin-v2, ...) whenever this file
// changes, and activate() deletes every older ga-admin-* cache.

const CACHE_NAME = 'ga-admin-v1'
const STATIC_EXT = /\.(?:js|css|png|jpg|jpeg|webp|svg|gif|woff|woff2|ttf|ico|json)$/i

self.addEventListener('install', () => {
  // Take over as soon as the new worker is installed; activate() cleans up.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // API calls: network-only, never cached.
  if (url.pathname.startsWith('/api/')) {
    return
  }
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return
  }

  // Navigations: network-first, cached app shell as the fallback.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put(request, response.clone())
        }
        return response
      } catch (err) {
        const cached = await caches.match(request, { ignoreSearch: true })
        if (cached) {
          return cached
        }
        throw err
      }
    })())
    return
  }

  // Static build assets: stale-while-revalidate.
  if (STATIC_EXT.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(request)
      const network = fetch(request).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          cache.put(request, response.clone())
        }
        return response
      })
      return cached || network
    })())
  }
})

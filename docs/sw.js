// Offline support: cache the app so it opens with no signal. Game files and
// saves are in IndexedDB already. Bump VERSION whenever app files change.
const VERSION = 'dc-v3'
const FILES = [
  './', 'index.html', 'app.js', 'engine.js', 'agent.js', 'voice.js', 'store.js', 'catalog.js', 'unzip.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/anthropic-sdk.js', 'vendor/emglken/git.js', 'vendor/emglken/git.wasm',
  'vendor/emglken/bocfel.js', 'vendor/emglken/bocfel.wasm', 'games/lantern-hill.ulx',
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Network first (so updates arrive), falling back to the cache when offline.
// Only same-origin GETs: API calls to Anthropic are never cached.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)) }
        return res
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  )
})

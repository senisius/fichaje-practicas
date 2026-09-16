// Service worker mínimo de Fichaje Prácticas.
// Solo ofrece una página "sin conexión" a las navegaciones. No cachea la app ni toca
// Firestore/Auth: fichar exige conexión siempre y las horas las pone el servidor.
// Si cambias offline.html o la lista PRECACHE, sube VERSION.
const VERSION = 'v2'
const CACHE_PREFIX = 'fichaje-offline-'
const CACHE = `${CACHE_PREFIX}${VERSION}`
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/icons/app-icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // cache: 'reload' evita guardar una copia antigua de la caché HTTP.
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
      )
      // Adelanta la petición de la página mientras arranca el service worker.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  // Solo navegaciones GET del mismo origen; todo lo demás va directo a la red.
  if (request.mode !== 'navigate' || request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Rutas reservadas de Firebase Hosting (/__/auth/…): no se tocan.
  if (url.pathname.startsWith('/__/')) return
  event.respondWith(networkFirst(event))
})

async function networkFirst(event) {
  try {
    const preloaded = await event.preloadResponse
    return preloaded ?? (await fetch(event.request))
  } catch {
    const offline = await caches.match(OFFLINE_URL, { cacheName: CACHE })
    return offline ?? Response.error()
  }
}

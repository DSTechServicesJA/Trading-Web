/* IT Guru – Service Worker (Feature 14: PWA / Push Notifications)
 *
 * Responsibilities:
 *  1. Cache static assets for offline access (App Shell strategy).
 *  2. Serve cached assets when the network is unavailable.
 *  3. Expose a push-notification path so the Web Push API can deliver
 *     true background notifications even when the browser tab is closed.
 */

const CACHE_NAME = "itguru-indicator-v1";

/* Static assets to pre-cache during install */
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./indicator.js",
  "./manifest.json"
];

/* ---- Install: pre-cache shell assets ---- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

/* ---- Activate: clean up old caches ---- */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

/* ---- Fetch: serve from cache, fallback to network ---- */
self.addEventListener("fetch", (event) => {
  /* Only handle same-origin GET requests */
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        /* Don't cache non-2xx or opaque responses */
        if (!response || response.status !== 200 || response.type === "opaque") {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, toCache));
        return response;
      });
    })
  );
});

/* ---- Push: handle incoming push messages ---- */
self.addEventListener("push", (event) => {
  let data = { title: "IT Guru Alert", body: "A new trading signal has fired.", icon: "./favicon.ico", badge: "./favicon.ico" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) { /* malformed JSON — use defaults */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    data.icon,
      badge:   data.badge,
      tag:     data.tag    || "itguru-signal",
      data:    data.url    || "/indicator/",
      vibrate: [200, 100, 200],
      requireInteraction: data.requireInteraction || false
    })
  );
});

/* ---- Notification click: focus / open the indicator tab ---- */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data || "/indicator/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/indicator/") && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

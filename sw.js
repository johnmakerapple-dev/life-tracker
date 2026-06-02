/* Service worker: кеширует оболочку приложения, чтобы оно работало оффлайн.
   Версию бампай при изменении файлов, чтобы кеш обновился. */
const CACHE = "tracker-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// cache-first for our own assets; network fallback otherwise
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;          // ignore cross-origin
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        // runtime-cache same-origin GETs
        if (e.request.method === "GET" && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit)
    )
  );
});

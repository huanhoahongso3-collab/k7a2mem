// Caches this app's own /api/img proxy responses (cache-first) so repeat
// visits don't even round-trip to Vercel, let alone Google's CDN — a
// second layer on top of the server-side edge cache in app/api/img.
// Everything else (index.html, app.js, styles.css, photos-data.js) is
// left to the normal HTTP cache.
const CACHE_NAME = "kyyeu-images-v2";
const IMAGE_PATH_PREFIX = "/api/img";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(IMAGE_PATH_PREFIX)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;

      try {
        const response = await fetch(event.request);
        // Opaque (cross-origin, no-cors) responses can still be cached and
        // replayed even though we can't inspect their status/body here.
        if (response && (response.ok || response.type === "opaque")) {
          cache.put(event.request, response.clone());
        }
        return response;
      } catch (err) {
        return cached || Response.error();
      }
    })
  );
});

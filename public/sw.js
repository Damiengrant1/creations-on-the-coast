const CACHE_NAME = "creations-app-shell-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([
      "/",
      "/event-pos",
      "/manifest.webmanifest",
    ]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      if (event.request.mode === "navigate") {
        return (await caches.match("/event-pos")) || new Response(
          "<h1>Creations on the Coast</h1><p>Open Event POS once while online before using it offline.</p>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }

      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            "<h1>Creations on the Coast</h1><p>You are offline. Reconnect to the internet to use the live business system.</p>",
            {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }
          )
      )
    );
  }
});

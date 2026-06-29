/* Helm — Investor Cockpit service worker.
   Offline-first app shell. Market-data requests (coingecko / yahoo) are always
   network-first so quotes stay fresh; the app itself works fully offline from
   cached state. The Phase-2 serverless data proxy will register under
   /api/ and is intentionally never cached. */
const CACHE = "helm-v1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "../icon-192.png",
  "../icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Live market data + future /api proxy: network-only, never served stale.
  const isData = /coingecko\.com|finance\.yahoo\.com/.test(url.hostname) || url.pathname.startsWith("/api/");
  if (isData) {
    event.respondWith(fetch(req).catch(() => new Response(JSON.stringify({ offline: true }), { headers: { "Content-Type": "application/json" } })));
    return;
  }

  // App shell: network-first so updates show when online, cache fallback offline.
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200 && url.origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});

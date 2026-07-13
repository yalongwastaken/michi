// sw.js — app-shell cache for the installed PWA. Makes Michi open instantly and
// survive a flaky connection, WITHOUT ever caching /api (your data stays fresh and
// private). Bump CACHE to invalidate old shells on the next visit.
const CACHE = "michi-shell-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") {
    return;
  }
  const url = new URL(req.url);
  // only handle our own origin; never touch the API (no stale/private data cached)
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  // navigations: network-first (freshest HTML when online), cached shell offline.
  // only store good responses — a 502 during a server restart must never become
  // the permanent offline shell. The cache write rides waitUntil so the browser
  // can't terminate the worker between responding and the put landing.
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            const copy = res.clone();
            e.waitUntil(caches.open(CACHE).then((c) => c.put("/index.html", copy)));
          }
          return res;
        } catch {
          const c = await caches.open(CACHE);
          return (await c.match("/index.html")) || Response.error();
        }
      })(),
    );
    return;
  }

  // hashed build assets (content-hashed → immutable): cache-first, then network +
  // store. A hash never changes content, so these are safe forever within CACHE.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      (async () => {
        const c = await caches.open(CACHE);
        const hit = await c.match(req);
        if (hit) {
          return hit;
        }
        try {
          const res = await fetch(req);
          if (res.ok) {
            e.waitUntil(c.put(req, res.clone())); // survive past the response
          }
          return res;
        } catch {
          return Response.error();
        }
      })(),
    );
    return;
  }

  // everything else (manifest, icons — stable names, mutable content):
  // stale-while-revalidate, so they load instantly but can't go permanently stale.
  e.respondWith(
    (async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      const refresh = fetch(req)
        .then(async (res) => {
          if (res.ok) {
            await c.put(req, res.clone());
          }
          return res;
        })
        .catch(() => hit || Response.error());
      // a cache hit answers instantly — waitUntil keeps the worker alive until
      // the background revalidation (and its write) actually finishes
      e.waitUntil(refresh);
      return hit || refresh;
    })(),
  );
});

// sw.js — app-shell cache for the installed PWA. Makes Michi open instantly and
// survive a flaky connection, WITHOUT ever caching /api (your data stays fresh and
// private). Bump CACHE to invalidate old shells on the next visit.
// v3: the persimmon/indigo repaint — recolored shell, icons, and favicon
// v4: web-push handlers for the Focus tab's end-of-block reminders
// v5: re-subscribe on pushsubscriptionchange (browser key rotation)
const CACHE = "michi-shell-v5";

self.addEventListener("install", () => self.skipWaiting());

// ── focus-block push reminders (opt-in from Settings → Notifications) ────────────
// The server sends one push when a running focus block ends; payload is a small
// {title, body} the SW turns into a notification. Tapping it focuses/opens the app.
self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data?.json() || {};
  } catch {
    /* non-JSON payload — show the generic fallback */
  }
  e.waitUntil(
    self.registration.showNotification(data.title || "Michi", {
      body: data.body || "Your focus block is done — take a break.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "michi-focus", // a newer reminder replaces an unread older one
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (wins.length) {
        return wins[0].focus();
      }
      return self.clients.openWindow("/");
    })(),
  );
});

// the browser can rotate a subscription (its endpoint changes); the server's stored
// endpoint then goes stale and every push fails silently forever. Re-subscribe with
// the current VAPID key and re-register, so notifications self-heal without the user
// re-toggling them in Settings.
function b64ToU8(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil(
    (async () => {
      try {
        const { key } = await (await fetch("/api/push/key")).json();
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToU8(key),
        });
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
      } catch {
        /* best-effort self-heal — the user can re-enable in Settings if it fails */
      }
    })(),
  );
});

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

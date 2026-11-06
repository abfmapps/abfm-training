/* Offline support. When you change files in assets/, bump VERSION here and the ?v= numbers in index.html and admin.html so browsers fetch the new files. */
const VERSION = "abfm-training-v43";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "manifest-admin.webmanifest",
  "assets/app.css", "assets/app.js", "assets/i18n.js", "assets/config.js", "assets/trades.js", "assets/icons.js",
  "assets/logo.png", "assets/icon-192.png", "assets/icon-512.png", "assets/favicon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/admin") ) return;
  // Video lists: always try the network first so new videos show up, fall back to the last copy offline.
  if (url.pathname.includes("/data/")) {
    const key = url.origin + url.pathname;
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(key, copy)); return r; })
      .catch(() => caches.match(key)));
    return;
  }
  // The page itself: network first (so updates arrive), but a slow network falls back to the saved copy after 2.5 s.
  if (e.request.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("index.html")) {
    e.respondWith(new Promise(resolve => {
      let done = false;
      const timer = setTimeout(() => caches.match(e.request, { ignoreSearch: true }).then(m => { if (m && !done) { done = true; resolve(m); } }), 2500);
      fetch(e.request, { cache: "no-cache" }).then(r => {
        clearTimeout(timer);
        if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
        if (!done) { done = true; resolve(r); }
      }).catch(() => { clearTimeout(timer); caches.match(e.request, { ignoreSearch: true }).then(m => { if (!done) { done = true; resolve(m || Response.error()); } }); });
    }));
    return;
  }
  // App files (css, js, images) carry ?v=NN in their address, so a saved copy is always right: serve it instantly.
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return r;
  })));
});

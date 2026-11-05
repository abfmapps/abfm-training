/* Offline support. Bump VERSION when you change files in assets/ so phones pick up the new version. */
const VERSION = "abfm-training-v14";
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "assets/app.css", "assets/app.js", "assets/i18n.js", "assets/config.js",
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
  // App files: serve the saved copy fast, refresh it in the background.
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});

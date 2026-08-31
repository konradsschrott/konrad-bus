/* Makes the page work with no network at all -- the point of the whole thing.
   A plain hosted page still fetches on launch, so in airplane mode it would
   show a connection error; this serves it from the cache instead.

   Bump CACHE whenever the files below change, so an installed copy replaces
   its old one rather than serving it forever. */
const CACHE = "guts-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  // Serve from cache at once, and refresh it in the background, so the page
  // opens instantly offline and still picks up a new version when online.
  // ignoreSearch keeps ?t=... (the test-time override) on the cached page.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const live = fetch(req)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);            // offline: the cached copy is the answer
      return hit || live;
    })
  );
});

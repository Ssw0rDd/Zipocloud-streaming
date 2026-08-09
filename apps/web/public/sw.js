/* ZiPo shell service worker — caches app shell only. Never caches /api/, sessions, or embeds. */
const CACHE_NAME = "zipo-shell-v1";
const SHELL_URLS = ["/", "/offline", "/pt/offline", "/en/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

function isShellAsset(url) {
  const { pathname } = new URL(url);
  if (pathname.startsWith("/api/")) return false;
  if (pathname.includes("/session")) return false;
  if (pathname.includes("embed")) return false;
  if (pathname.startsWith("/_next/static/")) return true;
  if (pathname.startsWith("/fonts/")) return true;
  if (SHELL_URLS.includes(pathname)) return true;
  if (pathname === "/zipo-icon.svg" || pathname === "/manifest.webmanifest") return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!isShellAsset(request.url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === "opaque") {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match("/offline").then((r) => r || caches.match("/pt/offline")));
    }),
  );
});

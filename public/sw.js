// Service worker — INFAS Prépa
// Stratégie : "network first, fallback cache" pour les pages et données (toujours essayer
// d'avoir la dernière version des matières/questions en ligne), "cache first" pour les
// ressources statiques (icônes, polices) qui ne changent presque jamais.
// Le nom du cache change à chaque nouvelle version du service worker : ça force la purge
// automatique de l'ancien cache et évite de rester bloqué sur une vieille version de l'app.
const CACHE_VERSION = "infas-prepa-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = ["/", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("infas-prepa-") && key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function isStaticAsset(url) {
  return /\.(png|jpg|jpeg|svg|webp|ico|woff2?|ttf)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // ne jamais mettre en cache les requêtes de connexion/écriture

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // laisser passer les appels externes (API Gemini, etc.) sans les intercepter

  // Ressources statiques (icônes, polices) : cache d'abord, réseau en secours si absent
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
            return response;
          })
      )
    );
    return;
  }

  // Pages et API : réseau d'abord (toujours la dernière version des matières/questions),
  // secours sur le cache uniquement si hors-ligne ou requête réseau impossible
  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) =>
            cached ||
            (request.mode === "navigate" ? caches.match("/") : undefined)
        )
      )
  );
});

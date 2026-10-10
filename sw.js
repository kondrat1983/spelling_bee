// Offline cache. Stale-while-revalidate: the app opens instantly from cache and
// picks up new files (e.g. an edited word list) on the next launch.
const CACHE = 'sbt-v2';
const FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/normalize.js',
  'js/store.js',
  'js/decks.js',
  'js/speech.js',
  'js/sound.js',
  'js/bee.js',
  'data/words.json',
  'data/hints.json',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) {
        e.waitUntil(fresh.catch(() => {}));
        return cached;
      }
      return fresh;
    }),
  );
});

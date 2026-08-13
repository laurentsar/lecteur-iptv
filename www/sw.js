/* sw.js — cache uniquement le shell de l'application (pages/scripts/styles).
 * Les flux vidéo, les appels API (Xtream, GitHub) et l'EPG ne sont jamais mis
 * en cache : ils viennent toujours du réseau, en direct. */
const CACHE = 'iptv-lecteur-v1.0';
const SHELL = [
  'index.html', 'styles.css',
  'store.js', 'm3u.js', 'xtream.js', 'epg.js', 'player.js', 'app.js', 'update-check.js',
  'vendor/hls.min.js',
  'manifest.webmanifest', 'img/icon-192.png', 'img/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // flux/API distants : jamais interceptés
  const path = url.pathname.replace(/^.*\/iptv-lecteur\//, '').replace(/^\//, '') || 'index.html';
  if (!SHELL.includes(path)) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

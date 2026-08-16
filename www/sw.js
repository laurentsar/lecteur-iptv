/* sw.js — cache uniquement le shell de l'application (pages/scripts/styles).
 * Les flux vidéo, les appels API (Xtream, GitHub) et l'EPG ne sont jamais mis
 * en cache : ils viennent toujours du réseau, en direct.
 *
 * IMPORTANT — CACHE doit être bumpé à CHAQUE version (en même temps que
 * window.APP_VERSION dans index.html et "version" dans version.json) :
 * un navigateur/WebView ne réexécute "install" (qui recharge le shell,
 * donc app.js/epg.js/player.js à jour) QUE si le fichier sw.js lui-même a
 * changé — comparaison strictement octet à octet du script par le
 * navigateur, rien à voir avec le contenu de CACHE en tant que tel. Ce
 * fichier étant resté identique de la v1.25 à la v1.62 (jamais retouché
 * pendant tout ce temps malgré des dizaines de releases), le
 * navigateur/la WebView n'a jamais détecté de mise à jour du service
 * worker sur les appareils où l'appli n'a pas été réinstallée à zéro
 * (donnée conservée entre deux mises à jour de l'APK) : le shell caché
 * pouvait rester bloqué sur une très vieille version indéfiniment, y
 * compris pour des correctifs déjà « publiés » depuis longtemps. */
const CACHE = 'iptv-lecteur-v1.67';
const SHELL = [
  'index.html', 'styles.css',
  'net.js', 'hls-native-loader.js', 'store.js', 'crypto.js', 'm3u.js', 'xtream.js', 'tmdb.js', 'epg.js', 'player.js', 'recorder.js', 'app.js', 'update-check.js',
  'vendor/hls.min.js', 'vendor/mpegts.min.js',
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
  // Chemin relatif à la racine de déploiement (scope du service worker), pas
  // un préfixe codé en dur : fonctionne aussi bien servi à la racine (APK,
  // domaine dédié) que sous un sous-dossier (ex. GitHub Pages /lecteur-iptv/).
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;
  const path = url.pathname.slice(scope.length) || 'index.html';
  if (!SHELL.includes(path)) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

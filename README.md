# 📺 Lecteur IPTV

Application Android (et PWA) pour lire tes flux IPTV : **En direct**, **Films**
et **Séries**, à partir d'une playlist **M3U/M3U8** ou d'un compte **Xtream
Codes** (serveur + identifiants) que tu fournis toi-même.

C'est un **lecteur**, pas un fournisseur de contenu : l'app n'héberge, ne
vend et ne recommande aucune chaîne, aucun film ni aucune série. Tout ce
qu'elle affiche vient de la source que tu as configurée.

## Fonctionnalités

| Onglet | Contenu |
|---|---|
| 🏠 **Accueil** | Playlist active (et sélecteur si tu en as plusieurs), accès rapide aux 3 catégories, nombre de favoris. |
| 📺 **En direct** | Chaînes en direct, recherche et filtre par catégorie/groupe, badge « en cours / à suivre » quand un guide EPG est disponible. |
| 🎬 **Films** | Catalogue VOD, recherche et filtre par catégorie. |
| 🎞️ **Séries** | Liste des séries, puis saisons et épisodes. Pour une playlist M3U, les séries sont détectées automatiquement dans les noms (`SxxExx`, `1x02`, …). |
| ⭐ **Favoris** | Chaînes, films et séries marqués d'un ☆, tous fournisseurs confondus. |
| 🗂️ **Playlists** | Ajoute, teste et supprime des sources M3U ou Xtream Codes ; plusieurs playlists peuvent être enregistrées et basculées à la volée. |
| ℹ️ **Infos** | Limites connues et confidentialité. |

## Sources prises en charge

- **Xtream Codes** : serveur + utilisateur + mot de passe. L'app interroge
  `player_api.php` (catégories et flux en direct/VOD/séries) et construit les
  URL de lecture (`.../live/…/….m3u8`, `.../movie/…`, `.../series/…`).
- **M3U / M3U8** : par URL ou par fichier importé. Les attributs `tvg-id`,
  `tvg-logo`, `group-title` sont lus s'ils sont présents. Le guide EPG
  (XMLTV) est chargé automatiquement si la playlist déclare `url-tvg` /
  `x-tvg-url`, ou peut être renseigné manuellement à l'ajout de la playlist.

## Limites connues

- **Codecs non supportés** (HEVC, audio AC3/DTS, courants sur des rips
  IPTV) : le navigateur ne les décode pas nativement. Quand la lecture
  directe d'un film/épisode échoue, l'app retente automatiquement en
  demandant la même URL avec l'extension `.m3u8` — beaucoup de panels
  Xtream Codes transcodent alors à la volée en HLS H264/AAC, lisible
  partout ; ça ne fonctionne pas sur tous les panels.
- Les flux **`.ts` bruts** (mpeg-ts en direct, hors HLS) sont lus via
  [mpegts.js](https://github.com/xqq/mpegts.js) (Apache-2.0).
- L'**EPG compressé** (`.gz`) n'est pas décompressé : il faut un lien XMLTV
  non compressé.
- **CORS** : beaucoup de serveurs IPTV bloquent les requêtes venant d'un
  navigateur (ils sont pensés pour des lecteurs natifs comme VLC). Sur
  l'**APK Android**, le chargement des playlists M3U et de l'API Xtream
  passe par le réseau natif de Capacitor (`www/net.js`) pour contourner ce
  blocage. Sur la **PWA**, il n'y a pas de contournement possible (aucun
  pont natif) : un serveur qui bloque le CORS y empêchera la playlist de se
  charger. La **lecture vidéo** (HLS et mpeg-ts) et l'**EPG** restent
  soumises au CORS du serveur de streaming dans les deux cas (Android et
  PWA) : `net.js` ne couvre que la playlist/l'API, pas les flux vidéo eux-
  mêmes, qui doivent rester lisibles en flux continu (impossible à
  contourner par le même mécanisme).
- La lecture nécessite une connexion réseau vers ton fournisseur : seule
  l'interface de l'app fonctionne hors ligne.

## Confidentialité

Playlists, identifiants et favoris restent **uniquement sur l'appareil**
(stockage local / IndexedDB). Rien n'est envoyé ailleurs qu'au serveur IPTV
que tu as toi-même renseigné.

## Installation

- **APK** : chaque push sur `main` publie une Release GitHub signée, taguée
  `vX.Y`. L'app vérifie elle-même s'il en existe une plus récente et propose
  le téléchargement.
- **PWA** : servir le dossier `www/` en HTTPS, puis « Ajouter à l'écran
  d'accueil ».

## Développement

```bash
npm install
npx cap sync android      # nécessite d'abord npx cap add android
python3 tools_gen_icon.py # régénère les icônes (aucune dépendance)
```

`android/` n'est pas versionné : le workflow le régénère à chaque build, puis
applique la signature (`ci/patch_signing.py`), la version (`ci/set_version.py`),
les icônes (`ci/set_icons.py`) et l'autorisation HTTP en clair pour les
serveurs IPTV en `http://` (`ci/patch_manifest.py`).

La clé de signature (`signing/release.keystore`) **est** versionnée dans ce
dépôt — un choix inhabituel, expliqué avec ses implications dans
[`signing/README.md`](signing/README.md).

## Structure

```
www/
  index.html     7 onglets
  net.js         requêtes réseau (contourne les CORS via Capacitor sur Android)
  store.js       persistance locale (playlists, favoris, cache)
  m3u.js         analyse des playlists M3U/M3U8, détection des séries
  xtream.js      client de l'API Xtream Codes
  epg.js         guide XMLTV (now/next)
  player.js      lecteur vidéo (hls.js pour le HLS, mpegts.js pour le .ts brut, natif sinon)
  app.js         interface, onglets, playlists, grilles
  vendor/hls.min.js     lecture HLS (Apache-2.0, video-dev/hls.js)
  vendor/mpegts.min.js  lecture mpeg-ts brut (Apache-2.0, xqq/mpegts.js)
```

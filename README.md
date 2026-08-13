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

- Les flux **`.ts` bruts** (mpeg-ts en direct, hors HLS) ne sont pas
  décodables par un navigateur — utilise la variante `.m3u8` de ton
  fournisseur quand elle existe.
- L'**EPG compressé** (`.gz`) n'est pas décompressé : il faut un lien XMLTV
  non compressé.
- Certains serveurs bloquent les requêtes venant d'un navigateur (**CORS**) :
  dans ce cas, la playlist ou l'API ne répond pas depuis l'app alors qu'elle
  fonctionnerait dans un lecteur natif (VLC, etc.).
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

La clé de signature n'est **pas** versionnée : le build release attend les
secrets GitHub `ANDROID_KEYSTORE_B64` (le fichier `.p12` encodé en base64) et
`ANDROID_KEYSTORE_PASSWORD` dans **Settings → Secrets and variables →
Actions** de ce dépôt.

## Structure

```
www/
  index.html     7 onglets
  store.js       persistance locale (playlists, favoris, cache)
  m3u.js         analyse des playlists M3U/M3U8, détection des séries
  xtream.js      client de l'API Xtream Codes
  epg.js         guide XMLTV (now/next)
  player.js      lecteur vidéo (hls.js pour le HLS, natif sinon)
  app.js         interface, onglets, playlists, grilles
  vendor/hls.min.js  lecture HLS dans le navigateur (Apache-2.0, video-dev/hls.js)
```

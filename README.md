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
| 📺 **En direct** | Chaînes en direct, recherche et filtre par catégorie/groupe, badge « en cours / à suivre » quand un guide EPG est disponible. Bascule **Liste / Mosaïque** (tuiles compactes centrées sur le logo). Bouton **Picture-in-Picture** dans le lecteur pour continuer à regarder en mini-fenêtre. |
| 🗓️ **Guide** | Agenda EPG heure par heure : une ligne par chaîne, défilement horizontal dans le temps, ligne « maintenant », navigation jour précédent/suivant, recherche. |
| 🎬 **Films** | Catalogue VOD, recherche et filtre par catégorie. Fiche détaillée par film (affiche, âge, note, durée, genre, descriptif — comptes Xtream Codes) avant de lancer la lecture. |
| 🎞️ **Séries** | Liste des séries, puis épisodes regroupés par saison (accordéon replié par défaut). Pour une playlist M3U, les séries sont détectées automatiquement dans les noms (`SxxExx`, `1x02`, …). |
| ⭐ **Favoris** | Chaînes, films et séries marqués d'un ☆, tous fournisseurs confondus. |
| 🗂️ **Playlists** | Ajoute, teste et supprime des sources M3U ou Xtream Codes ; plusieurs playlists peuvent être enregistrées et basculées à la volée. |
| ℹ️ **Infos** | Limites connues et confidentialité. |

## Diffusion vers une TV

Un bouton dans le lecteur permet d'envoyer le flux en cours sur une TV :

- **Chromecast** : sur l'APK Android (lecteur natif, bouton *MediaRouteButton*
  géré par Media3 `CastPlayer` + Google Play Services) et dans le lecteur
  web (bouton `<google-cast-launcher>` du Cast Sender SDK de Google, chargé
  à la demande) — fonctionne dans n'importe quel navigateur Chrome/Chromium.
- **AirPlay** : dans le lecteur web sur Safari (iPhone/Mac) — bouton dédié
  qui ouvre le sélecteur AirPlay natif (`webkitShowPlaybackTargetPicker`).
  Comme l'app n'a pas de version iOS installable, c'est la seule façon
  d'utiliser le lecteur sur iPhone (la PWA fonctionne dans Safari).
- Aucun compte ni inscription requis (récepteur Cast « par défaut » de
  Google, pas d'application Cast dédiée à enregistrer).

## Picture-in-Picture (direct uniquement)

Un bouton ⧉ dans le lecteur réduit la chaîne en cours en mini-fenêtre pour
continuer à la regarder pendant qu'on utilise le reste de l'app ou une
autre appli — proposé uniquement pour le **direct** (pas les films/séries,
pas de contrôles lecture/pause utiles depuis une mini-fenêtre pour de la VOD).

- **Lecteur web** (PWA et APK) : Picture-in-Picture standard du navigateur/
  WebView (`requestPictureInPicture`), ou mode présentation de Safari sur
  iPhone/Mac.
- **APK Android**, lecteur natif de secours (HEVC/audio non décodables par
  le navigateur) : PiP système Android (Media3 ExoPlayer), avec réduction
  automatique en appuyant sur le bouton Accueil pendant une lecture en direct.

## Langue audio et sous-titres

Un bouton 🌐 dans le lecteur ouvre la liste des pistes audio et sous-titres
disponibles pour le flux en cours, quand il y en a plusieurs.

- **Lecteur web** (PWA et APK) : pistes alternatives déclarées par le
  manifeste **HLS** (`#EXT-X-MEDIA`), lues par hls.js ou nativement par
  Safari. Pas de sélection possible pour les flux mpeg-ts bruts ni la
  lecture directe (mp4/mkv) — ces moteurs n'exposent pas de pistes
  alternatives navigables côté web.
- **APK Android**, lecteur natif de secours : sélection de piste via
  Media3 ExoPlayer, qui l'expose de la même façon quel que soit le
  conteneur (HLS, mp4, mkv…) — c'est justement le cas d'usage type de ce
  lecteur de secours (VOD HEVC/mkv multi-pistes).

## Sources prises en charge

- **Xtream Codes** : serveur + utilisateur + mot de passe. L'app interroge
  `player_api.php` (catégories et flux en direct/VOD/séries) et construit les
  URL de lecture (`.../live/…/….m3u8`, `.../movie/…`, `.../series/…`). Le
  guide EPG est chargé automatiquement via l'export XMLTV standard du panel
  (`xmltv.php`), sans configuration supplémentaire. La fiche d'un film
  (affiche, âge, note, durée, genre, descriptif) vient de `get_vod_info` —
  disponibilité variable selon la qualité du catalogue renseigné par le
  fournisseur (le champ « âge » en particulier n'est pas systématiquement
  fourni par tous les panels).
- **M3U / M3U8** : par URL ou par fichier importé. Les attributs `tvg-id`,
  `tvg-logo`, `group-title` sont lus s'ils sont présents. Le guide EPG
  (XMLTV) est chargé automatiquement si la playlist déclare `url-tvg` /
  `x-tvg-url`, ou peut être renseigné manuellement à l'ajout de la playlist.
  Une playlist M3U ne transportant ni âge ni descriptif, la fiche d'un film
  n'y affiche que l'affiche (logo), le titre et la catégorie.

## Limites connues

- **Codecs non supportés** (HEVC, audio AC3/E-AC3/DTS/TrueHD, courants sur
  des rips IPTV) : le navigateur ne les décode pas toujours. Quand la
  lecture web échoue, l'app retente dans l'ordre : (1) sur l'**APK
  Android**, le **lecteur vidéo natif** de l'appareil (`NativePlayerPlugin`,
  Media3 ExoPlayer — hors WebView, décode via MediaCodec pour la vidéo
  (HEVC…) et embarque en plus un décodeur **FFmpeg** vendorisé pour
  l'audio AC3/E-AC3/DTS/TrueHD, voir [`native/decoder-ffmpeg/NOTICE.md`]
  (native/decoder-ffmpeg/NOTICE.md)) ; (2) si indisponible (PWA) ou en
  échec, redemande la même URL avec l'extension `.m3u8` — certains panels
  Xtream Codes transcodent alors à la volée en HLS H264/AAC. Aucun des deux
  ne garantit la lecture de tout (codecs vidéo exotiques, flux
  réellement hors service, etc.).
- Les flux **`.ts` bruts** (mpeg-ts en direct, hors HLS) sont lus via
  [mpegts.js](https://github.com/xqq/mpegts.js) (Apache-2.0).
- L'**EPG compressé** (`.gz`) n'est pas décompressé : il faut un lien XMLTV
  non compressé.
- **CORS** : beaucoup de serveurs IPTV bloquent les requêtes venant d'un
  navigateur (ils sont pensés pour des lecteurs natifs comme VLC). Sur
  l'**APK Android**, le chargement des playlists M3U, de l'API Xtream et
  des flux **HLS** (manifeste + segments, via un loader hls.js dédié —
  `www/hls-native-loader.js`) passe par le réseau natif de Capacitor
  (`www/net.js`) pour contourner ce blocage. Sur la **PWA**, il n'y a pas
  de contournement possible (aucun pont natif) : un serveur qui bloque le
  CORS y empêchera la playlist ou la vidéo de se charger. Les flux
  **mpeg-ts bruts** (en direct, en continu — pas découpés en fichiers
  finis comme le HLS, donc impossible à charger via ce mécanisme) et
  l'**EPG** restent soumis au CORS du serveur dans les deux cas (Android
  et PWA).
- La lecture nécessite une connexion réseau vers ton fournisseur : seule
  l'interface de l'app fonctionne hors ligne.
- **Entrées décoratives de playlist** : certaines playlists M3U utilisent
  une chaîne factice comme séparateur visuel de catégorie (ex.
  `||--- |FR| GENERALISTES |FR| ---||`). L'app les détecte (forte
  proportion de caractères de ponctuation décorative dans le nom) et les
  affiche comme un titre de section pleine largeur, non cliquable, plutôt
  que comme une carte de chaîne cassée.
- **Flux qui ne démarre jamais** : si un flux ne déclenche ni lecture ni
  erreur dans les 20 secondes (chaîne hors service, entrée de playlist
  invalide), le lecteur (web comme natif) affiche un message explicite
  au lieu de rester bloqué indéfiniment sur 00:00.

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
les icônes (`ci/set_icons.py`), l'autorisation HTTP en clair pour les
serveurs IPTV en `http://` (`ci/patch_manifest.py`) et le lecteur vidéo natif
(`ci/patch_native_player.py` — injecte `NativePlayerPlugin` / Media3
ExoPlayer, voir plus bas).

La clé de signature (`signing/release.keystore`) **est** versionnée dans ce
dépôt — un choix inhabituel, expliqué avec ses implications dans
[`signing/README.md`](signing/README.md).

## Structure

```
www/
  index.html     7 onglets
  net.js         requêtes réseau playlist/API (contourne les CORS via Capacitor sur Android)
  hls-native-loader.js  chargeur hls.js natif (contourne les CORS sur les flux HLS, Android)
  store.js       persistance locale (playlists, favoris, cache)
  m3u.js         analyse des playlists M3U/M3U8, détection des séries
  xtream.js      client de l'API Xtream Codes
  epg.js         guide XMLTV (now/next)
  player.js      lecteur vidéo (hls.js pour le HLS, mpegts.js pour le .ts brut, natif sinon)
  app.js         interface, onglets, playlists, grilles
  vendor/hls.min.js     lecture HLS (Apache-2.0, video-dev/hls.js)
  vendor/mpegts.min.js  lecture mpeg-ts brut (Apache-2.0, xqq/mpegts.js)

ci/patch_native_player.py  injecte (à chaque build) dans android/ :
  NativePlayerPlugin.java     plugin Capacitor, ouvre l'écran natif
  NativePlayerActivity.java   lecteur plein écran (Media3 ExoPlayer + FFmpeg + Cast)
  CastOptionsProvider.java    config. Google Cast (récepteur par défaut)
  activity_native_player.xml  mise en page (PlayerView + titre + cast + fermer)

native/decoder-ffmpeg/  module Gradle vendorisé (voir NOTICE.md) :
  décodeur audio FFmpeg pour AC3/E-AC3/DTS/TrueHD, relié au projet
  Android par ci/patch_native_player.py (pas régénéré, contrairement à
  android/ — ce dossier contient du code source, pas des artefacts de build)
```

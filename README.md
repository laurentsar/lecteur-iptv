# 📺 Lecteur IPTV

Application Android (et PWA) pour lire tes flux IPTV : **En direct**, **Films**
et **Séries**, à partir d'une playlist **M3U/M3U8** ou d'un compte **Xtream
Codes** (serveur + identifiants) que tu fournis toi-même.

C'est un **lecteur**, pas un fournisseur de contenu : l'app n'héberge, ne
vend et ne recommande aucune chaîne, aucun film ni aucune série. Tout ce
qu'elle affiche vient de la source que tu as configurée.

🌐 **Version web (PWA)** : https://laurentsar.github.io/lecteur-iptv/ —
utilisable directement dans le navigateur, sans installation (voir les
limites de la PWA face à l'APK dans [Limites connues](#limites-connues)).

## Fonctionnalités

| Onglet | Contenu |
|---|---|
| 🏠 **Accueil** | Playlist active (et sélecteur si tu en as plusieurs), accès rapide aux 3 catégories, nombre de favoris. |
| 📺 **En direct** | Chaînes en direct, recherche et filtre par catégorie/groupe, badge « en cours / à suivre » quand un guide EPG est disponible. Bascule **Liste / Tuile** (cases carrées centrées sur le logo, nom et programme en cours visibles dessous). Bouton **Picture-in-Picture** dans le lecteur pour continuer à regarder en mini-fenêtre. Les chaînes en double dans la playlist (sources/qualités multiples) sont **regroupées** sous une seule carte, avec un sélecteur pour choisir la source. |
| 🗓️ **Guide** | Agenda EPG heure par heure : une ligne par chaîne, défilement horizontal dans le temps, ligne « maintenant », navigation jour précédent/suivant, recherche. Bouton ⏺ sur une émission à venir pour programmer son enregistrement (APK Android). |
| 🎬 **Films** | Catalogue VOD, recherche et filtre par catégorie. Fiche détaillée par film (affiche, âge, note, durée, genre, descriptif — comptes Xtream Codes) avant de lancer la lecture, complétée via TMDB si une clé est renseignée (voir plus bas). Les doublons (même film listé plusieurs fois) sont regroupés, comme pour les chaînes. |
| 🎞️ **Séries** | Liste des séries, puis épisodes regroupés par saison (accordéon replié par défaut). Pour une playlist M3U, les séries sont détectées automatiquement dans les noms (`SxxExx`, `1x02`, …). |
| ⭐ **Ma liste** | Favoris (chaînes/films/séries marqués d'un ☆) et enregistrements (programmés et terminés, APK Android) dans un seul onglet. |
| ⚙️ **Réglages** | Playlists (ajout/test/suppression), export/import chiffré de la config (voir plus bas) et infos (limites connues, réglages TMDB/PIN, confidentialité) — infos présentées en accordéon replié par défaut, pour ne pas encombrer l'écran. |

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

## Compatibilité TV Android et casque VR (Quest 3)

- **TV Android / boîtiers IPTV (APK)** : le manifeste déclare l'app
  compatible sans écran tactile (`android.hardware.touchscreen` et
  `android.software.leanback` en `required="false"`), donc installable et
  listée sur ces appareils. Ce n'est pas une intégration Leanback complète
  (pas de lanceur TV dédié à grosses tuiles) : l'app s'ouvre dans son
  interface habituelle, mais tous les éléments cliquables (cartes de
  chaînes/films, grille du Guide, cartes verrouillées par le PIN) sont
  navigables à la télécommande/D-pad — Entrée ou OK les active comme un
  clic, avec un contour visible autour de l'élément sélectionné.
- **Casque VR Meta Quest 3** : fonctionne déjà sans aucune adaptation,
  installée en side-load comme une app Android classique. Horizon OS
  l'exécute en mode « panneau 2D » flottant (comme n'importe quelle app
  téléphone/tablette non conçue pour la VR) : lecture, navigation tactile
  virtuelle et Cast fonctionnent normalement dans ce panneau.

## Compatibilité navigateur Tesla

La **version web** (PWA, https://laurentsar.github.io/lecteur-iptv/) est
utilisable dans le navigateur embarqué des Tesla : l'interface est tactile
par défaut, sans dépendance à la souris (`:hover`) ni raccourcis clavier
obligatoires, et le code ne s'appuie que sur des API web standard
supportées depuis longtemps par Chromium (pas de syntaxe JS récente type
`?.`/`??`).

**Limites connues, propres au navigateur Tesla et non à l'app :**
- Le navigateur est **désactivé pendant la conduite** (sécurité imposée par
  Tesla) — utilisable à l'arrêt (Parking), ou en continu sur l'écran
  passager des véhicules qui en ont un.
- Version de moteur Chromium embarquée historiquement en retrait des
  navigateurs grand public : la lecture vidéo (HLS via hls.js/MSE) devrait
  fonctionner, mais n'a pas pu être testée sur un véhicule réel lors du
  développement — un retour d'expérience est bienvenu si quelque chose ne
  s'affiche pas correctement.
- Pas de « Ajouter à l'écran d'accueil » ni de téléchargement de fichier
  dans ce navigateur : voir la section suivante pour transférer ta
  configuration sans tout retaper au clavier tactile.

## Sauvegarde et export de configuration (Tesla, autre appareil)

Dans **Réglages → 💾 Sauvegarde & export**, un code **chiffré** (phrase
secrète obligatoire, PBKDF2 + AES-GCM via l'API Web Crypto du navigateur)
résume tes playlists (et, au choix, favoris/clé TMDB) — le code PIN
parental n'est jamais inclus. Trois façons de le faire arriver sur un
autre appareil :

1. **Copier-coller** : Exporter → copier le code → Importer sur l'autre
   appareil avec la même phrase secrète.
2. **Lien direct** : ouvrir `…/lecteur-iptv/#import=<code>` ouvre
   directement la fenêtre d'import avec le code déjà rempli (il ne reste
   qu'à taper la phrase secrète).
3. **Lien court via GitHub** (le plus pratique sur un écran sans clavier
   physique comme une Tesla) : demande à Claude de publier ton code
   exporté dans `www/sync/<id>.json` sur ce dépôt — GitHub Pages le sert
   alors à `…/lecteur-iptv/?sync=<id>`, un lien court à taper une seule
   fois. Le fichier reste chiffré (inutilisable sans la phrase secrète)
   même s'il est hébergé sur un dépôt public.

## Code PIN (bouquet adulte)

Réglage facultatif dans l'onglet Réglages. Une fois un code défini, les
catégories dont le nom contient « adulte », « adult », « xxx » ou « 18+ »
(groupe M3U ou catégorie Xtream, détection sur le nom uniquement) sont
masquées dans **En direct**, **Films** et **Séries**, remplacées par une
carte « 🔒 N élément(s) protégé(s) » qui demande le code au clic. Une fois
déverrouillée, une catégorie le reste pour la session en cours (jusqu'au
prochain lancement de l'app). Tant qu'aucun code n'est défini, rien n'est
masqué. Le code reste uniquement sur l'appareil, comme le reste des
réglages.

## Enregistrement (DVR, APK Android uniquement)

Enregistre un flux en direct vers un fichier local, **y compris si l'app
est fermée** — via un service Android en avant-plan (notification
permanente, obligatoire pour qu'Android autorise une exécution prolongée
en arrière-plan).

- **Immédiat** : bouton ⏺ dans le lecteur d'une chaîne en direct.
  Enregistre jusqu'à l'arrêt manuel (bouton ⏹, ou depuis la notification),
  avec une limite de sécurité à 4 h.
- **Programmé** : bouton ⏺ sur une émission à venir dans le **Guide**.
  Une alarme système (`AlarmManager`) démarre l'enregistrement à l'heure
  prévue, même appli fermée ; réarmée automatiquement après un redémarrage
  du téléphone.
- Capture le flux tel quel (segments HLS concaténés, ou copie directe pour
  un flux brut) — pas de remuxage ni de transcodage. Le fichier obtenu
  (`.ts`) se lit comme n'importe quel contenu de l'app (mpeg-ts déjà
  vendorisé, avec repli automatique vers le lecteur natif si besoin).
- Consultation, lecture et suppression dans l'onglet **Ma liste**.
- **Un seul enregistrement à la fois.** Une programmation qui tombe
  pendant un enregistrement déjà en cours est ignorée.
- **Limite assumée** : certains téléphones (gestion de batterie agressive
  de certains constructeurs — Xiaomi, Huawei, Samsung…) peuvent malgré
  tout arrêter le service en arrière-plan, sauf si l'app est mise en
  exception manuellement dans les réglages de batterie. Aucune app ne peut
  garantir à 100 % l'exécution en arrière-plan sur Android — c'est une
  contrainte de la plateforme, pas un choix de conception.
- Non disponible sur la PWA/navigateur/iPhone : aucune exécution en
  arrière-plan fiable n'y existe.

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

## Enrichissement TMDB des fiches films (facultatif)

Quand un film n'a ni affiche, ni descriptif, ni âge (playlists M3U, ou
compte Xtream avec un catalogue peu renseigné), l'app peut compléter sa
fiche en interrogeant [TMDB](https://www.themoviedb.org/) (The Movie
Database) à partir du titre — réglage dans l'onglet Réglages (clé API TMDB
v3, gratuite).

- **Opt-in** : désactivé par défaut, tant qu'aucune clé n'est renseignée.
- **Ne remplace jamais** ce que le fournisseur IPTV a déjà donné —
  complète uniquement les champs manquants (affiche, descriptif, âge,
  note, durée, genre).
- Le titre nettoyé (année/qualité/tags entre parenthèses ou crochets
  retirés) est envoyé à TMDB pour la recherche — seule exception à la
  politique de confidentialité de l'app (voir plus bas), documentée dans
  l'onglet Réglages au moment d'activer le réglage.
- L'âge vient de la certification TMDB (France, sinon États-Unis ou
  Royaume-Uni en repli) — absente si TMDB ne l'a pas pour ce film.

## Chaînes et films en double, sélecteur de source

Beaucoup de playlists (surtout M3U) listent la même chaîne ou le même film
plusieurs fois sous des noms voisins — sources de secours, qualités
différentes ("TF1", "TF1 HD", "TF1 FHD (2)", "Inception 4K"...). Les
onglets **En direct** et **Films** les regroupent sous une seule carte à
partir d'une clé de nom normalisée (mentions de qualité/source et
ponctuation retirées) : l'affiche est celle de la meilleure version
disponible parmi le groupe, et un badge indique le nombre de sources.
Toucher la carte (ou le bouton « Regarder » d'une fiche film) ouvre un
sélecteur listant chaque version d'origine — pratique pour basculer
manuellement vers une source plus légère si le débit est faible. Une
entrée sans doublon s'ouvre directement, comme avant.

## Optimisations pour un débit faible

Les réglages de lecture priorisent la stabilité (pas de coupures) plutôt
que la qualité maximale ou la latence minimale :

- **HLS (hls.js)** : démarre toujours sur la qualité la plus basse
  disponible (l'ABR remonte ensuite si le réseau le permet), hypothèse de
  débit initiale prudente, remontée en qualité progressive pour éviter les
  allers-retours HD/SD qui aggravent les coupures, mémoire tampon étendue
  (jusqu'à 120 s) pour absorber des ralentissements plus longs sans
  décrocher.
- **mpeg-ts brut (mpegts.js)** : tampon initial plus grand (débit fixe,
  pas d'ABR possible pour ce format).
- **APK Android, lecteur natif de secours (ExoPlayer)** : mêmes principes
  via un `DefaultLoadControl` aux tampons étendus.

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
que tu as toi-même renseigné — seule exception, opt-in : si tu actives
l'enrichissement TMDB (voir plus haut), le titre des films consultés est
envoyé à TMDB pour compléter leur fiche.

## Installation

- **APK** : chaque push sur `main` publie une Release GitHub signée, taguée
  `vX.Y`. L'app vérifie elle-même s'il en existe une plus récente et propose
  le téléchargement.
- **PWA** : déjà servie en HTTPS via GitHub Pages —
  https://laurentsar.github.io/lecteur-iptv/ (redéployée automatiquement à
  chaque push sur `main` qui touche `www/`, voir
  `.github/workflows/deploy-pages.yml`). Ouvrir le lien puis « Ajouter à
  l'écran d'accueil » pour l'installer comme une app. Pour l'auto-héberger
  ailleurs, il suffit de servir le dossier `www/` en HTTPS.

## Développement

```bash
npm install
npx cap sync android      # nécessite d'abord npx cap add android
python3 tools_gen_icon.py # régénère les icônes (aucune dépendance)
```

`android/` n'est pas versionné : le workflow le régénère à chaque build, puis
applique la signature (`ci/patch_signing.py`), la version (`ci/set_version.py`),
les icônes (`ci/set_icons.py`), l'autorisation HTTP en clair pour les
serveurs IPTV en `http://` (`ci/patch_manifest.py`), le lecteur vidéo natif
(`ci/patch_native_player.py` — injecte `NativePlayerPlugin` / Media3
ExoPlayer, voir plus bas), l'enregistreur DVR (`ci/patch_recorder.py` —
injecte `RecorderPlugin` / `RecordingService`, voir « Enregistrement »
plus haut) et la restriction aux ABI de vrais téléphones (`ci/patch_abi.py`
— voir « Taille de l'APK » plus bas).

La clé de signature (`signing/release.keystore`) **est** versionnée dans ce
dépôt — un choix inhabituel, expliqué avec ses implications dans
[`signing/README.md`](signing/README.md).

## Taille de l'APK

L'APK ne cible que les ABI de vrais téléphones (`armeabi-v7a`, `arm64-v8a`)
— `x86`/`x86_64` ne servent qu'aux émulateurs, jamais à un appareil réel, et
doublaient inutilement la taille des libs natives (Media3 ExoPlayer, Google
Play Services Cast, extension FFmpeg vendorisée) en les embarquant pour
quatre ABI au lieu de deux (`ci/patch_abi.py`) : environ 10,0 Mo → 8,9 Mo
sur l'APK signé v1.16. Le code compilé (dex, ~5 Mo compressés — AndroidX +
Media3 + Google Play Services Cast) reste le plus gros poste ; le réduire
davantage nécessiterait d'activer la réduction de code R8 (`minifyEnabled`),
non fait pour l'instant : ça demande des règles `-keep` explicites pour le
plugin Capacitor maison (`NativePlayerPlugin`, découvert par réflexion) et
un test réel sur téléphone avant de pouvoir l'assumer sans risque de casser
silencieusement une fonctionnalité — pas quelque chose qu'on peut valider
uniquement par un build qui compile.

## Structure

```
www/
  index.html     7 onglets (Playlists+Infos et Favoris+Enregistrements regroupés)
  net.js         requêtes réseau playlist/API (contourne les CORS via Capacitor sur Android)
  hls-native-loader.js  chargeur hls.js natif (contourne les CORS sur les flux HLS, Android)
  store.js       persistance locale (playlists, favoris, cache)
  m3u.js         analyse des playlists M3U/M3U8, détection des séries
  xtream.js      client de l'API Xtream Codes
  tmdb.js        enrichissement TMDB des fiches films (facultatif)
  epg.js         guide XMLTV (now/next)
  player.js      lecteur vidéo (hls.js pour le HLS, mpegts.js pour le .ts brut, natif sinon)
  recorder.js    pont JS vers RecorderPlugin (DVR, APK Android uniquement)
  app.js         interface, onglets, playlists, grilles
  vendor/hls.min.js     lecture HLS (Apache-2.0, video-dev/hls.js)
  vendor/mpegts.min.js  lecture mpeg-ts brut (Apache-2.0, xqq/mpegts.js)

ci/patch_native_player.py  injecte (à chaque build) dans android/ :
  NativePlayerPlugin.java     plugin Capacitor, ouvre l'écran natif
  NativePlayerActivity.java   lecteur plein écran (Media3 ExoPlayer + FFmpeg + Cast)
  CastOptionsProvider.java    config. Google Cast (récepteur par défaut)
  activity_native_player.xml  mise en page (PlayerView + titre + cast + fermer)

ci/patch_recorder.py  injecte (à chaque build) dans android/ :
  RecorderPlugin.java             plugin Capacitor (start/stop/programmer/lister)
  RecordingService.java           service en avant-plan, capture HLS ou flux brut
  RecordingScheduleReceiver.java  déclenche un enregistrement programmé (AlarmManager)
  RecordingBootReceiver.java      réarme les programmations après redémarrage
  Recordings.java                 persistance (SharedPreferences + JSON)

native/decoder-ffmpeg/  module Gradle vendorisé (voir NOTICE.md) :
  décodeur audio FFmpeg pour AC3/E-AC3/DTS/TrueHD, relié au projet
  Android par ci/patch_native_player.py (pas régénéré, contrairement à
  android/ — ce dossier contient du code source, pas des artefacts de build)
```

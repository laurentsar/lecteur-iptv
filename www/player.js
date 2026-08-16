/* player.js — overlay de lecture vidéo : hls.js pour les flux .m3u8,
 * mpegts.js pour les flux .ts bruts (mpeg-ts en direct, très courants chez
 * les fournisseurs IPTV — le navigateur ne les décode pas nativement),
 * lecture native pour le reste (mp4, mkv...), HLS natif Safari s'il n'y a
 * ni hls.js ni mpegts.js utilisable (iPhone). Si la lecture échoue (codec
 * non supporté par le navigateur/WebView — HEVC, audio AC3/DTS, fréquents
 * sur des rips IPTV), deux replis dans l'ordre :
 *   1. le lecteur vidéo natif Android (NativePlayerPlugin, Media3
 *      ExoPlayer) — décode via MediaCodec, hors WebView, souvent capable
 *      là où le navigateur ne l'est pas ;
 *   2. si le plugin natif n'est pas disponible (PWA), retente la même URL
 *      avec l'extension .m3u8 : certains panels Xtream Codes transcodent
 *      alors à la volée en HLS H264/AAC, lisible partout.
 *
 * Diffusion vers une TV : AirPlay (Safari, natif au <video> — bouton
 * explicite ajouté ici) et Chromecast (Cast Sender SDK de Google, chargé à
 * la demande). Les deux sont indépendants du moteur de lecture local.
 *
 * Réglages pensés pour un débit faible/instable (connexions mobiles,
 * ADSL...), plutôt que pour la latence minimale : mémoire tampon plus
 * généreuse pour absorber les ralentissements sans décrocher, qualité de
 * départ estimée à partir du débit réseau connu de l'appareil (Network
 * Information API, sinon repli prudent sur la qualité la plus basse),
 * remontée en qualité prudente ensuite pour éviter les allers-retours HD/SD
 * qui aggravent les coupures. Un sélecteur manuel (bouton ⚙️) permet de
 * forcer une qualité précise si l'automatique ne convient pas.
 *
 * Note : capLevelToPlayerSize (plafonner l'auto au format d'affichage) a été
 * essayé puis retiré — il dépend de la taille réelle du <video> au moment où
 * hls.js l'évalue, pas toujours fiable dans la WebView Android au bon
 * moment, et pouvait bloquer le choix automatique sur une qualité trop
 * basse indépendamment du débit réel disponible. */
(function (global) {
  'use strict';

  var hls = null;
  var mpegtsPlayer = null;
  var currentEngine = '';
  var currentUrl = '', currentTitle = '';
  var currentVersions = null; // [{name,url,...}] quand la chaîne regroupe plusieurs sources — voir opts.versions dans open()
  var originalUrl = '', originalTitle = '';
  var currentIsLive = false; // PiP proposé uniquement pour le direct
  var currentIsRadio = false; // lecture en fond sonore natif quand l'appli passe en arrière-plan, voir setupRadioBackground()
  var currentLogo = '';
  var triedNativeFallback = false, triedM3u8Fallback = false;
  var overlay, video, titleEl, statusEl, closeBtn, airplayBtn, pipBtn, recordBtn, tracksBtn, tracksMenu, castLauncher;
  var remoteBtn, remotePanel;
  var fullscreenBtn, homeBtn;
  var zapBanner, zapBannerLogo, zapBannerName, zapBannerProg;
  var zapBannerTimer = null;
  var castSdkRequested = false;
  var loadTimeoutId = null;
  var LOAD_TIMEOUT_MS = 20000; // certaines entrées de playlist (séparateurs
  // de catégorie décoratifs, chaînes mortes) ne renvoient jamais d'erreur et
  // restent bloquées indéfiniment sans ce filet de sécurité.

  // hls.js : priorité à la stabilité sur un lien faible plutôt qu'à la
  // qualité ou la latence. startLevel:-1 = choix automatique du premier
  // palier à partir de abrEwmaDefaultEstimate (voir estimateStartBandwidth,
  // calculé à l'ouverture depuis le débit réseau connu de l'appareil quand
  // disponible ; repli prudent sur le palier le plus bas sinon) plutôt que
  // de forcer systématiquement la qualité la plus basse ; abrBandWidthUpFactor
  // bas = remonter en qualité seulement avec une marge confortable, pour
  // éviter les allers-retours qui provoquent des coupures ; buffers étendus
  // = encaisse des ralentissements plus longs avant de décrocher.
  var HLS_LOW_BANDWIDTH_CONFIG = {
    enableWorker: true,
    startLevel: -1,
    abrBandWidthFactor: 0.9,
    abrBandWidthUpFactor: 0.6,
    maxBufferLength: 60,
    maxMaxBufferLength: 120,
    maxBufferHole: 1
  };

  // Débit de départ estimé pour le choix automatique du premier palier HLS
  // (abrEwmaDefaultEstimate) : Network Information API si le navigateur/
  // WebView l'expose (Chrome Android — pas Safari/iOS), sinon repli prudent
  // identique au comportement précédent (démarrage sur le plus petit débit).
  function estimateStartBandwidth() {
    var conn = global.navigator && (navigator.connection || navigator.mozConnection || navigator.webkitConnection);
    if (conn && conn.downlink) {
      // downlink en Mbit/s, converti en bit/s avec une marge de sécurité
      // (60 %) pour ne pas surestimer et provoquer un premier segment trop
      // gros au lancement.
      return Math.max(300000, Math.round(conn.downlink * 1000000 * 0.6));
    }
    return 300000; // ~300 kb/s : identique à l'ancien réglage fixe.
  }

  // mpegts.js (flux mpeg-ts bruts, débit fixe — pas d'ABR possible) : un
  // tampon initial plus grand absorbe les micro-coupures réseau avant de
  // devoir mettre la lecture en pause pour recharger.
  var MPEGTS_LOW_BANDWIDTH_CONFIG = {
    enableStashBuffer: true,
    stashInitialSize: 1024 * 1024 // 1 Mo (défaut mpegts.js : ~384 Ko)
  };

  function ensureDom() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'playerOverlay';
    overlay.className = 'player-overlay';
    overlay.innerHTML =
      '<div class="player-top">' +
      '  <span id="playerTitle" class="player-title"></span>' +
      '  <google-cast-launcher id="castLauncher" class="player-cast" style="display:none"></google-cast-launcher>' +
      '  <button id="playerAirplay" class="player-cast" aria-label="AirPlay" style="display:none">📡</button>' +
      '  <button id="playerRemote" class="player-cast" aria-label="Télécommande" style="display:none">🕹️</button>' +
      '  <button id="playerPip" class="player-cast" aria-label="Picture-in-Picture" style="display:none">⧉</button>' +
      '  <button id="playerRecord" class="player-cast" aria-label="Enregistrer" style="display:none">⏺</button>' +
      '  <button id="playerTracks" class="player-cast" aria-label="Qualité, langue et sous-titres" style="display:none">⚙️</button>' +
      '  <button id="playerFullscreen" class="player-cast" aria-label="Plein écran" style="display:none">⛶</button>' +
      '  <button id="playerHome" class="player-cast" aria-label="Accueil">🏠</button>' +
      '  <button id="playerClose" class="player-close" aria-label="Fermer">✕</button>' +
      '</div>' +
      '<div id="playerTracksMenu" class="tracks-menu" style="display:none">' +
      '  <div class="tracks-title">Sources</div>' +
      '  <div id="tracksSourcesList"></div>' +
      '  <div class="tracks-title">Qualité</div>' +
      '  <div id="tracksQualityList"></div>' +
      '  <div class="tracks-title">Audio</div>' +
      '  <div id="tracksAudioList"></div>' +
      '  <div class="tracks-title">Sous-titres</div>' +
      '  <div id="tracksSubList"></div>' +
      '</div>' +
      '<video id="playerVideo" playsinline controls autoplay></video>' +
      '<div id="playerStatus" class="player-status"></div>' +
      '<div id="zapBanner" class="zap-banner">' +
      '  <img id="zapBannerLogo" class="zap-banner-logo" alt="" style="display:none" />' +
      '  <div class="zap-banner-txt">' +
      '    <div id="zapBannerName" class="zap-banner-name"></div>' +
      '    <div id="zapBannerProg" class="zap-banner-prog"></div>' +
      '  </div>' +
      '</div>' +
      '<div id="remotePanel" class="remote-panel" style="display:none">' +
      '  <div class="remote-panel-card">' +
      '    <div class="remote-zap-row">' +
      '      <button id="remoteZapPrev" class="ghost" aria-label="Chaîne précédente">▼</button>' +
      '      <button id="remotePanelClose" class="ghost" aria-label="Fermer la télécommande">✕</button>' +
      '      <button id="remoteZapNext" class="ghost" aria-label="Chaîne suivante">▲</button>' +
      '    </div>' +
      '    <input type="text" inputmode="numeric" pattern="[0-9]*" id="remoteChno" placeholder="Aller au n°…" />' +
      '    <input type="search" id="remoteSearch" placeholder="Chercher…" />' +
      '    <div class="cat-title">⭐ Favoris</div>' +
      '    <div id="remoteFavoris"></div>' +
      '    <div class="cat-title">📺 Chaînes</div>' +
      '    <div id="remoteChannels"></div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(overlay);
    video = overlay.querySelector('#playerVideo');
    titleEl = overlay.querySelector('#playerTitle');
    statusEl = overlay.querySelector('#playerStatus');
    closeBtn = overlay.querySelector('#playerClose');
    airplayBtn = overlay.querySelector('#playerAirplay');
    pipBtn = overlay.querySelector('#playerPip');
    recordBtn = overlay.querySelector('#playerRecord');
    tracksBtn = overlay.querySelector('#playerTracks');
    tracksMenu = overlay.querySelector('#playerTracksMenu');
    castLauncher = overlay.querySelector('#castLauncher');
    remoteBtn = overlay.querySelector('#playerRemote');
    remotePanel = overlay.querySelector('#remotePanel');
    fullscreenBtn = overlay.querySelector('#playerFullscreen');
    zapBanner = overlay.querySelector('#zapBanner');
    zapBannerLogo = overlay.querySelector('#zapBannerLogo');
    zapBannerName = overlay.querySelector('#zapBannerName');
    zapBannerProg = overlay.querySelector('#zapBannerProg');
    homeBtn = overlay.querySelector('#playerHome');
    closeBtn.addEventListener('click', close);
    homeBtn.addEventListener('click', function () {
      close();
      if (global.AppNav) global.AppNav.goHome();
    });
    video.addEventListener('error', function () {
      clearLoadTimeout();
      attemptFallbackOrFail('Lecture impossible (' + currentEngine + ') — ' + describeMediaError(video.error));
    });
    video.addEventListener('playing', function () { clearLoadTimeout(); setStatus(''); });
    setupAirplay();
    setupChromecast();
    setupPip();
    setupTracks();
    setupRecording();
    setupZapSwipe();
    setupRemote();
    setupFullscreen();
    setupTapFullscreen();
    setupSelectFullscreen();
    setupRadioBackground();
    setupResume();
    setupChnoKeys();
  }

  // ---------- Reprise de lecture (films/séries uniquement) ----------
  // Position mémorisée par URL (Store.getProgress/setProgress, voir
  // store.js). Ignore le tout début (rien à reprendre) et la toute fin
  // (considéré comme terminé) pour ne pas proposer une reprise absurde.
  var RESUME_MIN_RATIO = 0.03, RESUME_MAX_RATIO = 0.95, RESUME_MIN_DURATION = 60;
  var lastProgressSaveAt = 0;

  function formatTime(s) {
    s = Math.max(0, Math.round(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var mm = (h ? String(m).padStart(2, '0') : String(m));
    var ss = String(sec).padStart(2, '0');
    return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  function saveProgress(force) {
    if (currentIsLive || !global.Store || !originalUrl) return;
    var dur = video.duration;
    if (!dur || !isFinite(dur) || dur < RESUME_MIN_DURATION) return;
    var now = Date.now();
    if (!force && now - lastProgressSaveAt < 5000) return;
    lastProgressSaveAt = now;
    var ratio = video.currentTime / dur;
    if (ratio < RESUME_MIN_RATIO || ratio > RESUME_MAX_RATIO) {
      Store.clearProgress(originalUrl); // terminé ou jamais vraiment commencé
      return;
    }
    Store.setProgress(originalUrl, { position: video.currentTime, duration: dur, title: originalTitle });
  }

  function setupResume() {
    video.addEventListener('loadedmetadata', function () {
      if (currentIsLive || !global.Store) return;
      var saved = Store.getProgress(originalUrl);
      if (!saved || !video.duration || !isFinite(video.duration)) return;
      var ratio = saved.position / video.duration;
      if (ratio < RESUME_MIN_RATIO || ratio > RESUME_MAX_RATIO) return;
      video.currentTime = saved.position;
      setStatus('Reprise à ' + formatTime(saved.position));
    });
    video.addEventListener('timeupdate', function () { saveProgress(false); });
    video.addEventListener('pause', function () { saveProgress(true); });
  }

  // ---------- Plein écran / paysage forcé ----------
  // Deux mécanismes distincts selon le contexte :
  //  - APK Android : plugin natif @capacitor/screen-orientation
  //    (Activity.setRequestedOrientation côté Android), pas la Fullscreen
  //    API du navigateur. .player-overlay couvre déjà tout le viewport en
  //    CSS (position:fixed;inset:0) — il n'y a pas de barre de navigateur à
  //    masquer sur l'APK — et Element.requestFullscreen() sur un conteneur
  //    non-vidéo est mal supporté dans la WebView embarquée par Capacitor
  //    (a provoqué un plantage constaté). screen.orientation.lock() du
  //    navigateur a aussi été écarté : Chromium exige que le document soit
  //    déjà en plein écran DOM pour l'accepter (rejeté sinon), ce qui
  //    recréait le même problème. Le plugin natif ne dépend d'aucun des
  //    deux et verrouille directement au niveau de l'Activity Android.
  //  - PWA/navigateur : Fullscreen API standard + screen.orientation.lock()
  //    (fonctionnent normalement dans un vrai navigateur).
  function isNativeApp() {
    return !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
  }
  function nativeScreenOrientation() {
    return (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.ScreenOrientation) || null;
  }
  function fullscreenSupported() { return !!(overlay.requestFullscreen || overlay.webkitRequestFullscreen); }
  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }

  // webkitRequestFullscreen/webkitExitFullscreen (anciens WebKit) ne
  // renvoient pas de Promise contrairement à la version standard — on ne
  // chaîne .catch() que si c'en est bien une.
  function requestFs() {
    if (overlay.requestFullscreen) return overlay.requestFullscreen();
    if (overlay.webkitRequestFullscreen) overlay.webkitRequestFullscreen();
    return null;
  }
  function exitFs() {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    return null;
  }

  function lockLandscape() {
    if (!(global.screen && screen.orientation && screen.orientation.lock)) return Promise.reject(new Error('non supporté'));
    try { return screen.orientation.lock('landscape'); } catch (e) { return Promise.reject(e); }
  }
  function unlockOrientation() {
    try { if (global.screen && screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); }
    catch (e) {}
  }
  var nativeLandscapeLocked = false;

  function releaseNativeLandscapeLock() {
    if (!nativeLandscapeLocked) return;
    var so = nativeScreenOrientation();
    if (so) so.unlock().catch(function () {});
    nativeLandscapeLocked = false;
    if (fullscreenBtn) fullscreenBtn.classList.remove('active');
  }

  // Bascule plein écran / mode classique — partagée entre le bouton ⛶ et un
  // simple tap sur la vidéo en cours de lecture (voir setupTapFullscreen),
  // pour tous les contenus (direct, films, séries, radio) puisque c'est le
  // même lecteur partagé qui s'ouvre depuis tous les onglets.
  function toggleFullscreen() {
    if (isNativeApp()) {
      var so = nativeScreenOrientation();
      if (!so) return;
      if (nativeLandscapeLocked) { releaseNativeLandscapeLock(); return; }
      so.lock({ orientation: 'landscape' }).then(function () {
        nativeLandscapeLocked = true;
        fullscreenBtn.classList.add('active');
      }).catch(function () { setStatus('Rotation en paysage indisponible sur cet appareil.'); });
      return;
    }
    if (!fullscreenSupported()) return;
    try {
      var p = isFullscreen() ? exitFs() : requestFs();
      if (p && typeof p.catch === 'function') p.catch(function () { setStatus('Plein écran indisponible sur cet appareil.'); });
    } catch (e) { setStatus('Plein écran indisponible sur cet appareil.'); }
  }

  function setupFullscreen() {
    if (isNativeApp()) {
      var so = nativeScreenOrientation();
      if (!so) { fullscreenBtn.style.display = 'none'; return; }
      fullscreenBtn.style.display = '';
      fullscreenBtn.addEventListener('click', toggleFullscreen);
      return;
    }

    if (!fullscreenSupported()) { fullscreenBtn.style.display = 'none'; return; }
    fullscreenBtn.style.display = '';
    fullscreenBtn.addEventListener('click', toggleFullscreen);
    function sync() {
      var fs = isFullscreen();
      fullscreenBtn.classList.toggle('active', fs);
      if (fs) lockLandscape().catch(function () {}); else unlockOrientation();
    }
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
  }

  // Clic souris sur la vidéo = bascule plein écran, pour la souris/PWA
  // desktop uniquement (le tap tactile est géré dans setupZapSwipe ci-
  // dessus, plus fiable sur mobile — voir le commentaire à cet endroit ;
  // sur un appareil tactile ce clic synthétique est étouffé par le
  // preventDefault() du tap, donc jamais atteint ici).
  function setupTapFullscreen() {
    video.addEventListener('click', function () { toggleFullscreen(); });
  }

  // Équivalent télécommande du tap ci-dessus : la touche OK/Sélection d'une
  // télécommande (physique, Bluetooth, ou boîtier TV) arrive comme un
  // évènement clavier "Enter" (parfois " ") dans la WebView, exactement
  // comme un clic simple sur la vidéo — sauf quand le focus est sur un
  // contrôle qui doit garder son propre sens pour cette touche (bouton,
  // champ, chaîne de la télécommande virtuelle rendue focusable par
  // makeFocusable() dans app.js) : dans ce cas on la laisse faire son
  // travail normal plutôt que de basculer le plein écran à sa place.
  function setupSelectFullscreen() {
    document.addEventListener('keydown', function (e) {
      if (!overlay || !overlay.classList.contains('show')) return;
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var a = document.activeElement;
      var onOwnControl = a && a !== video && a !== overlay && a !== document.body &&
        (/^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.tabIndex >= 0);
      if (onOwnControl) return;
      e.preventDefault();
      toggleFullscreen();
    });
  }

  // ---------- Radio en fond sonore (APK Android uniquement) ----------
  // Contrairement à la TV, une radio doit continuer à jouer quand l'appli
  // passe en arrière-plan (écran verrouillé, autre appli au premier plan)
  // — comme n'importe quelle appli radio. La WebView elle-même est
  // suspendue dans ce cas (le <video> s'arrête), donc on relaie la
  // lecture le temps que l'appli n'est pas au premier plan à un service
  // Android en avant-plan (RadioPlayerPlugin/RadioPlaybackService, natif —
  // voir ci/patch_radio_background.py), avec notification et contrôles
  // lecture/pause/arrêt. Ce service tourne indépendamment de la WebView :
  // il continue même si l'appli est ensuite fermée depuis les tâches
  // récentes, jusqu'à l'arrêt explicite (notification) ou le retour au
  // premier plan.
  function radioPlayerPlugin() {
    return (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.RadioPlayer) || null;
  }

  function setupRadioBackground() {
    if (!(isNativeApp() && global.Capacitor.Plugins && global.Capacitor.Plugins.App)) return;
    global.Capacitor.Plugins.App.addListener('appStateChange', function (state) {
      var rp = radioPlayerPlugin();
      if (!rp || !overlay || !overlay.classList.contains('show') || !currentIsRadio) return;
      if (!state.isActive) {
        video.pause();
        rp.play({ url: originalUrl, title: originalTitle, logo: currentLogo }).catch(function () {});
      } else {
        rp.stop().catch(function () {});
        video.play().catch(function () {});
      }
    });
  }

  // ---------- Télécommande virtuelle (chaînes en direct uniquement) ----------
  // Panneau alternatif au swipe pour changer de chaîne : suivante/précédente,
  // ou choisir directement dans les favoris ou la liste des chaînes
  // actuellement connue de l'app (voir AppZap dans app.js).
  function updateRemoteVisibility() {
    remoteBtn.style.display = (currentIsLive && !isCasting()) ? '' : 'none';
    if (!currentIsLive) closeRemote();
  }

  function closeRemote() { remotePanel.style.display = 'none'; }

  function remoteList(container, items, emptyMsg) {
    container.innerHTML = '';
    if (!items.length) { container.appendChild(el('div', 'hint', emptyMsg)); return; }
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.className = 'version-item' + (it.url === originalUrl ? ' active' : '');
      b.textContent = (it.url === originalUrl ? '▶ ' : '') + it.name;
      b.addEventListener('click', function () { closeRemote(); open(it.url, it.name, { live: true, epgKey: it.epgKey, logo: it.logo }); });
      container.appendChild(b);
    });
  }

  function renderRemotePanel() {
    var favoris = (global.AppZap && global.AppZap.favoris()) || [];
    var channels = (global.AppZap && global.AppZap.list()) || [];
    var q = overlay.querySelector('#remoteSearch').value.trim().toLowerCase();
    if (q) {
      favoris = favoris.filter(function (it) { return it.name.toLowerCase().indexOf(q) !== -1; });
      channels = channels.filter(function (it) { return it.name.toLowerCase().indexOf(q) !== -1; });
    }
    remoteList(overlay.querySelector('#remoteFavoris'), favoris, 'Aucun favori en direct — touche ☆ sur une chaîne dans l’app.');
    remoteList(overlay.querySelector('#remoteChannels'), channels,
      'Ouvre l’onglet Direct ou Guide dans l’app pour lister les chaînes ici.');
  }

  function setupRemote() {
    remoteBtn.addEventListener('click', function () {
      var showing = remotePanel.style.display !== 'none';
      if (showing) { closeRemote(); return; }
      renderRemotePanel();
      remotePanel.style.display = 'flex';
    });
    overlay.querySelector('#remotePanelClose').addEventListener('click', closeRemote);
    remotePanel.addEventListener('click', function (e) { if (e.target === remotePanel) closeRemote(); });
    overlay.querySelector('#remoteSearch').addEventListener('input', renderRemotePanel);
    overlay.querySelector('#remoteZapNext').addEventListener('click', function () { zapStep(1); renderRemotePanel(); });
    overlay.querySelector('#remoteZapPrev').addEventListener('click', function () { zapStep(-1); renderRemotePanel(); });
    var chnoInput = overlay.querySelector('#remoteChno');
    chnoInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && chnoInput.value.trim()) { goToChno(chnoInput.value.trim()); chnoInput.value = ''; chnoInput.blur(); }
    });
  }

  // ---------- Zapping par numéro de chaîne ----------
  // Numéro tel que fourni par la playlist (tvg-chno en M3U, num chez
  // Xtream — voir AppZap dans app.js). Deux entrées : le petit champ du
  // mini panneau télécommande (tactile), et la saisie au clavier/à la
  // télécommande physique directement sur le lecteur (touches 0-9,
  // accumulées puis validées après une pause — comme un vrai décodeur TV).
  function goToChno(num) {
    var item = global.AppZap && global.AppZap.byNumber && global.AppZap.byNumber(num);
    if (!item) { setStatus('Aucune chaîne n°' + num + '.'); return; }
    open(item.url, item.name, { live: true, epgKey: item.epgKey, logo: item.logo });
  }

  var chnoBuffer = '', chnoBufferTimer = null;
  var CHNO_COMMIT_DELAY = 1500;

  function setupChnoKeys() {
    document.addEventListener('keydown', function (e) {
      if (!overlay || !overlay.classList.contains('show') || !currentIsLive) return;
      if (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return; // ne pas gêner la saisie texte
      if (e.key < '0' || e.key > '9') return;
      chnoBuffer += e.key;
      setStatus('Chaîne n° ' + chnoBuffer);
      clearTimeout(chnoBufferTimer);
      chnoBufferTimer = setTimeout(function () { goToChno(chnoBuffer); chnoBuffer = ''; }, CHNO_COMMIT_DELAY);
    });
  }

  // ---------- Swipe (zapping) et tap (plein écran) sur la vidéo ----------
  // Un seul et même couple touchstart/touchend distingue les deux gestes :
  // un tap bref sans déplacement bascule le plein écran (voir
  // toggleFullscreen), un swipe vertical net change de chaîne (direct
  // uniquement). Volontairement PAS un simple "click" sur la vidéo pour le
  // tap : avec l'attribut controls natif, le clic issu du tap tactile n'est
  // pas fiable dans la WebView Android (contrôles natifs superposés qui
  // interceptent le geste) — touchstart/touchend, déjà utilisés et fiables
  // pour le swipe, le sont aussi pour ça. preventDefault() sur le touchend
  // d'un tap étouffe le clic de souris synthétique qui suivrait sinon,
  // pour ne pas basculer deux fois (une fois ici, une fois via le
  // gestionnaire "click" ci-dessous qui ne sert alors qu'à la souris/PWA
  // desktop, jamais atteint sur un appareil tactile).
  var ZAP_MIN_DISTANCE = 60, ZAP_MAX_DURATION = 600;
  var TAP_MAX_MOVEMENT = 12, TAP_MAX_DURATION = 300;
  var zapStartX = 0, zapStartY = 0, zapStartT = 0;

  function setupZapSwipe() {
    video.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      zapStartX = e.touches[0].clientX;
      zapStartY = e.touches[0].clientY;
      zapStartT = Date.now();
    }, { passive: true });
    video.addEventListener('touchend', function (e) {
      if (!zapStartT) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - zapStartX, dy = t.clientY - zapStartY;
      var dt = Date.now() - zapStartT;
      zapStartT = 0;
      if (dt <= TAP_MAX_DURATION && Math.abs(dx) <= TAP_MAX_MOVEMENT && Math.abs(dy) <= TAP_MAX_MOVEMENT) {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (!currentIsLive) return;
      if (dt > ZAP_MAX_DURATION) return;
      if (Math.abs(dy) < ZAP_MIN_DISTANCE || Math.abs(dy) < Math.abs(dx) * 1.5) return;
      zapStep(dy < 0 ? 1 : -1);
    }, { passive: false });
  }

  function zapStep(delta) {
    var list = (global.AppZap && global.AppZap.list()) || [];
    if (list.length < 2) {
      setStatus('Zapping indisponible — ouvre l’onglet Direct ou Guide dans l’app pour charger la liste des chaînes.');
      return;
    }
    var idx = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].url === originalUrl) { idx = i; break; } }
    if (idx === -1) {
      setStatus('Chaîne actuelle absente de cette liste — impossible de zapper depuis ici.');
      return;
    }
    var next = list[(idx + delta + list.length) % list.length];
    open(next.url, next.name, { live: true, epgKey: next.epgKey, logo: next.logo });
  }

  // ---------- Bandeau au zapping (chaînes en direct uniquement) ----------
  // Petit bandeau temporaire (nom + programme en cours/suivant via l'EPG,
  // voir AppZap.epgNow dans app.js) affiché à chaque prise d'antenne d'une
  // chaîne, comme le zapping d'un vrai décodeur TV.
  function showZapBanner(name, epgKey, logo) {
    clearTimeout(zapBannerTimer);
    zapBannerName.textContent = name || '';
    var info = (global.AppZap && global.AppZap.epgNow) ? global.AppZap.epgNow(epgKey) : null;
    zapBannerProg.textContent = info && info.now
      ? '▶ ' + info.now.titre + (info.next ? ' · ensuite : ' + info.next.titre : '')
      : '';
    if (logo) {
      zapBannerLogo.src = logo;
      zapBannerLogo.style.display = '';
      zapBannerLogo.onerror = function () { zapBannerLogo.style.display = 'none'; };
    } else {
      zapBannerLogo.style.display = 'none';
    }
    zapBanner.classList.add('show');
    zapBannerTimer = setTimeout(function () { zapBanner.classList.remove('show'); }, 3000);
  }

  // ---------- Enregistrement (chaînes en direct uniquement, APK Android —
  // service natif en arrière-plan, voir recorder.js). Continue de tourner
  // si on ferme le lecteur ou l'appli : ce bouton ne fait que démarrer/
  // arrêter, il ne « possède » pas l'enregistrement. ----------
  function updateRecordVisibility() {
    recordBtn.style.display = (currentIsLive && global.Recorder && Recorder.isAvailable() && !isCasting()) ? '' : 'none';
  }

  function syncRecordButtonState() {
    if (!global.Recorder || !Recorder.isAvailable()) return;
    Recorder.isRecording().then(function (r) {
      var recording = !!(r && r.recording && r.title === currentTitle);
      recordBtn.classList.toggle('active', recording);
      recordBtn.textContent = recording ? '⏹' : '⏺';
    });
  }

  function setupRecording() {
    recordBtn.addEventListener('click', function () {
      Recorder.isRecording().then(function (r) {
        if (r && r.recording) {
          Recorder.stop().then(function () {
            recordBtn.classList.remove('active');
            recordBtn.textContent = '⏺';
            setStatus('Enregistrement arrêté.');
          });
        } else {
          Recorder.startNow({ url: currentUrl, name: currentTitle }, 4 * 60 * 60 * 1000).then(function () {
            recordBtn.classList.add('active');
            recordBtn.textContent = '⏹';
            setStatus('Enregistrement démarré — continue même si tu fermes le lecteur ou l’app.');
          }).catch(function (err) { setStatus('Enregistrement impossible : ' + err.message); });
        }
      });
    });
  }

  // ---------- Picture-in-Picture (chaînes en direct uniquement) ----------
  // Continuer à regarder le direct en mini-fenêtre pendant qu'on utilise le
  // reste de l'app ou une autre appli. Standard (Chrome/Android WebView) ou
  // webkit (Safari) selon ce que le moteur expose.
  function pipSupported() {
    return !!(document.pictureInPictureEnabled ||
      (typeof video.webkitSupportsPresentationMode === 'function' && video.webkitSupportsPresentationMode('picture-in-picture')));
  }

  function updatePipVisibility() {
    pipBtn.style.display = (currentIsLive && pipSupported() && !isCasting()) ? '' : 'none';
  }

  function setupPip() {
    pipBtn.addEventListener('click', function () {
      if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(function () {}); return; }
      if (video.webkitPresentationMode === 'picture-in-picture') { video.webkitSetPresentationMode('inline'); return; }
      if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
        video.requestPictureInPicture().catch(function () { setStatus('Picture-in-Picture indisponible.'); });
      } else if (typeof video.webkitSetPresentationMode === 'function') {
        video.webkitSetPresentationMode('picture-in-picture');
      }
    });
    video.addEventListener('enterpictureinpicture', function () { pipBtn.classList.add('active'); });
    video.addEventListener('leavepictureinpicture', function () { pipBtn.classList.remove('active'); });
    video.addEventListener('webkitpresentationmodechanged', function () {
      pipBtn.classList.toggle('active', video.webkitPresentationMode === 'picture-in-picture');
    });
  }

  // ---------- Langue audio / sous-titres ----------
  // hls.js expose les pistes alternatives déclarées par le manifeste HLS
  // (#EXT-X-MEDIA) ; Safari fait de même nativement via video.audioTracks /
  // video.textTracks pour son moteur HLS interne. Pas de support pour les
  // flux mpeg-ts bruts (mpegts.js) ni la lecture directe (mp4/mkv) : ces
  // moteurs n'exposent pas de pistes alternatives navigables côté web — le
  // lecteur natif Android (ExoPlayer) prend le relais pour ces cas.
  function getAudioTracks() {
    if (hls) return hls.audioTracks.map(function (t, i) { return { id: i, label: t.name || t.lang || ('Piste ' + (i + 1)) }; });
    if (video.audioTracks && video.audioTracks.length > 1) {
      return Array.prototype.map.call(video.audioTracks, function (t, i) { return { id: i, label: t.label || t.language || ('Piste ' + (i + 1)) }; });
    }
    return [];
  }

  function getCurrentAudioTrack() {
    if (hls) return hls.audioTrack;
    if (video.audioTracks) {
      for (var i = 0; i < video.audioTracks.length; i++) if (video.audioTracks[i].enabled) return i;
    }
    return -1;
  }

  function setAudioTrack(id) {
    if (hls) { hls.audioTrack = id; renderTracksMenu(); return; }
    if (video.audioTracks) {
      for (var i = 0; i < video.audioTracks.length; i++) video.audioTracks[i].enabled = (i === id);
      renderTracksMenu();
    }
  }

  function getSubtitleTracks() {
    if (hls) return hls.subtitleTracks.map(function (t, i) { return { id: i, label: t.name || t.lang || ('Piste ' + (i + 1)) }; });
    if (video.textTracks && video.textTracks.length) {
      return Array.prototype.filter.call(video.textTracks, function (t) { return t.kind === 'subtitles' || t.kind === 'captions'; })
        .map(function (t, i) { return { id: i, label: t.label || t.language || ('Piste ' + (i + 1)) }; });
    }
    return [];
  }

  function getCurrentSubtitleTrack() {
    if (hls) return hls.subtitleDisplay ? hls.subtitleTrack : -1;
    if (video.textTracks) {
      for (var i = 0; i < video.textTracks.length; i++) if (video.textTracks[i].mode === 'showing') return i;
    }
    return -1;
  }

  function setSubtitleTrack(id) {
    if (hls) {
      if (id === -1) { hls.subtitleDisplay = false; } else { hls.subtitleTrack = id; hls.subtitleDisplay = true; }
      renderTracksMenu();
      return;
    }
    if (video.textTracks) {
      for (var i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = (i === id) ? 'showing' : 'disabled';
      renderTracksMenu();
    }
  }

  // ---------- Sources (chaînes/radios regroupant plusieurs flux sous le
  // même nom — voir groupChannels dans app.js) ----------
  // La lecture démarre directement sur la première source dès l'ouverture
  // (plus de sélecteur bloquant avant lecture, voir openChannelVersions
  // dans app.js) ; ce menu permet de basculer vers une autre source pendant
  // que ça joue déjà, sans interrompre la navigation dans l'app.
  function getSourceVersions() {
    if (!currentVersions || currentVersions.length < 2) return [];
    return currentVersions.map(function (v, i) { return { id: i, label: v.name }; });
  }
  function getCurrentSourceIndex() {
    if (!currentVersions) return -1;
    for (var i = 0; i < currentVersions.length; i++) { if (currentVersions[i].url === originalUrl) return i; }
    return -1;
  }
  function setSourceVersion(id) {
    if (!currentVersions || !currentVersions[id]) return;
    var v = currentVersions[id];
    open(v.url, v.name, { live: currentIsLive, versions: currentVersions, epgKey: v.epgKey, logo: v.logo });
  }

  // ---------- Qualité (chaînes/flux HLS uniquement — pas d'ABR pour le
  // mpeg-ts brut ni la lecture directe, voir MPEGTS_LOW_BANDWIDTH_CONFIG) ----------
  // Choix manuel en plus de la sélection automatique (voir
  // estimateStartBandwidth) : utile si l'auto ne convient pas (image figée
  // en 4G limitée, ou au contraire trop basse sur une bonne connexion).
  function getQualityLevels() {
    if (!hls || !hls.levels) return [];
    return hls.levels.map(function (lvl, i) {
      var label = lvl.height ? lvl.height + 'p' : 'Palier ' + (i + 1);
      if (lvl.bitrate) label += ' · ' + Math.round(lvl.bitrate / 1000) + ' kb/s';
      return { id: i, label: label };
    });
  }

  function getCurrentQualityLevel() { return hls ? hls.currentLevel : -1; } // -1 = auto

  function setQualityLevel(id) {
    if (!hls) return;
    hls.currentLevel = id;
    renderTracksMenu();
  }

  function updateTracksVisibility() {
    var hasChoice = getAudioTracks().length > 1 || getSubtitleTracks().length > 0 || getQualityLevels().length > 1 || getSourceVersions().length > 1;
    tracksBtn.style.display = hasChoice ? '' : 'none';
    if (!hasChoice) tracksMenu.style.display = 'none';
  }

  function tracksMenuList(container, tracks, current, onOff, onPick, offLabel) {
    container.innerHTML = '';
    if (onOff) {
      var off = document.createElement('button');
      off.className = 'tracks-item' + (current === -1 ? ' active' : '');
      off.textContent = (current === -1 ? '✓ ' : '') + (offLabel || 'Désactivés');
      off.addEventListener('click', function () { onPick(-1); });
      container.appendChild(off);
    }
    if (!tracks.length) {
      container.appendChild(el('div', 'hint', onOff ? 'Aucune piste disponible.' : 'Une seule piste.'));
      return;
    }
    tracks.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tracks-item' + (t.id === current ? ' active' : '');
      b.textContent = (t.id === current ? '✓ ' : '') + t.label;
      b.addEventListener('click', function () { onPick(t.id); });
      container.appendChild(b);
    });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderTracksMenu() {
    tracksMenuList(overlay.querySelector('#tracksSourcesList'), getSourceVersions(), getCurrentSourceIndex(), false, setSourceVersion);
    tracksMenuList(overlay.querySelector('#tracksQualityList'), getQualityLevels(), getCurrentQualityLevel(), true, setQualityLevel, 'Auto');
    tracksMenuList(overlay.querySelector('#tracksAudioList'), getAudioTracks(), getCurrentAudioTrack(), false, setAudioTrack);
    tracksMenuList(overlay.querySelector('#tracksSubList'), getSubtitleTracks(), getCurrentSubtitleTrack(), true, setSubtitleTrack);
  }

  function setupTracks() {
    tracksBtn.addEventListener('click', function () {
      var showing = tracksMenu.style.display !== 'none';
      if (showing) { tracksMenu.style.display = 'none'; return; }
      renderTracksMenu();
      tracksMenu.style.display = '';
    });
    video.addEventListener('loadedmetadata', updateTracksVisibility);
  }

  // ---------- AirPlay (Safari / iPhone) ----------
  function setupAirplay() {
    if (typeof video.webkitShowPlaybackTargetPicker !== 'function') return; // pas Safari/WebKit
    if (global.WebKitPlaybackTargetAvailabilityEvent) {
      video.addEventListener('webkitplaybacktargetavailabilitychanged', function (e) {
        airplayBtn.style.display = e.availability === 'available' ? '' : 'none';
      });
    } else {
      airplayBtn.style.display = ''; // pas d'évènement de disponibilité : afficher quand même
    }
    airplayBtn.addEventListener('click', function () { video.webkitShowPlaybackTargetPicker(); });
  }

  // ---------- Chromecast (Cast Sender SDK Google) ----------
  function setupChromecast() {
    if (castSdkRequested) return;
    castSdkRequested = true;
    global['__onGCastApiAvailable'] = function (isAvailable) {
      if (!isAvailable || !global.cast || !global.chrome || !global.chrome.cast) return;
      cast.framework.CastContext.getInstance().setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
      });
      cast.framework.CastContext.getInstance().addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        function (e) {
          if (e.sessionState === cast.framework.SessionState.SESSION_STARTED ||
            e.sessionState === cast.framework.SessionState.SESSION_RESUMED) {
            castCurrentMedia();
          }
          if (pipBtn) updatePipVisibility();
          if (recordBtn) updateRecordVisibility();
          if (remoteBtn) updateRemoteVisibility();
        }
      );
    };
    var s = document.createElement('script');
    s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    document.head.appendChild(s);
  }

  function isCasting() {
    return !!(global.cast && cast.framework && cast.framework.CastContext.getInstance().getCurrentSession());
  }

  function castMimeType(url) {
    if (isM3u8(url)) return 'application/x-mpegurl';
    if (/\.mkv(\?|#|$)/i.test(url)) return 'video/x-matroska';
    if (isDirectFile(url)) return 'video/mp4';
    return 'video/mp2t'; // mpeg-ts brut : support variable selon le récepteur Cast
  }

  function castCurrentMedia() {
    var session = cast.framework.CastContext.getInstance().getCurrentSession();
    if (!session || !currentUrl) return;
    clearLoadTimeout();
    destroyPlayers();
    video.pause();
    var mediaInfo = new chrome.cast.media.MediaInfo(currentUrl, castMimeType(currentUrl));
    mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.title = currentTitle || '';
    var request = new chrome.cast.media.LoadRequest(mediaInfo);
    setStatus('Connexion à ' + (session.getCastDevice() ? session.getCastDevice().friendlyName : 'la TV') + '…');
    session.loadMedia(request).then(
      function () { setStatus('▶ Diffusion sur ' + (session.getCastDevice() ? session.getCastDevice().friendlyName : 'la TV')); },
      function (err) { setStatus('Diffusion impossible : ' + (err && err.description ? err.description : err)); }
    );
  }

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }

  // Le navigateur donne un code d'erreur précis sur l'élément <video> :
  // s'appuyer dessus plutôt que sur un message générique qui ne distingue
  // pas « serveur injoignable » de « codec non pris en charge ».
  function describeMediaError(err) {
    if (!err) return 'cause inconnue.';
    switch (err.code) {
      case 1: return 'lecture interrompue.';
      case 2: return 'flux injoignable (erreur réseau) — vérifie l’URL, l’abonnement, ou si le serveur est en ligne.';
      case 3: return 'flux corrompu ou codec non décodable par cet appareil.';
      case 4: return 'format ou codec non pris en charge par cet appareil (HEVC, AC3/DTS et certains conteneurs sont courants sur des rips IPTV et pas toujours décodables sur mobile).';
      default: return 'cause inconnue (code ' + err.code + ').';
    }
  }

  function destroyPlayers() {
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (mpegtsPlayer) { try { mpegtsPlayer.destroy(); } catch (e) {} mpegtsPlayer = null; }
  }

  function clearLoadTimeout() {
    if (loadTimeoutId) { clearTimeout(loadTimeoutId); loadTimeoutId = null; }
  }

  function armLoadTimeout() {
    clearLoadTimeout();
    loadTimeoutId = setTimeout(function () {
      attemptFallbackOrFail('Le flux ne répond pas (délai dépassé) — probablement hors service ou une entrée de playlist invalide.');
    }, LOAD_TIMEOUT_MS);
  }

  function isM3u8(url) { return /\.m3u8(\?|#|$)/i.test(url); }
  // Les flux "live" IPTV qui ne sont pas du HLS sont presque toujours du
  // mpeg-ts brut, avec ou sans extension .ts explicite dans l'URL (beaucoup
  // de panels Xtream Codes n'en mettent pas). On ne traite comme "fichier
  // direct" (mp4/mkv...) que les extensions de VOD reconnues.
  function isDirectFile(url) { return /\.(mp4|mkv|webm|mov|m4v|avi)(\?|#|$)/i.test(url); }

  // Remplace (ou ajoute) l'extension de l'URL par .m3u8, en préservant une
  // éventuelle query string / ancre.
  function swapExtToM3u8(url) {
    var m = /^([^?#]*)([?#].*)?$/.exec(url);
    var base = (m ? m[1] : url).replace(/\.[a-zA-Z0-9]+$/, '');
    return base + '.m3u8' + (m && m[2] ? m[2] : '');
  }

  function attemptFallbackOrFail(reasonMsg) {
    if (!triedNativeFallback) {
      triedNativeFallback = true;
      if (tryNativePlayer(originalUrl, originalTitle)) return;
    }
    if (!triedM3u8Fallback && !isM3u8(currentUrl)) {
      triedM3u8Fallback = true;
      setStatus('Échec — nouvelle tentative en HLS transcodé…');
      startPlayback(swapExtToM3u8(currentUrl), currentTitle);
    } else {
      setStatus(reasonMsg);
    }
  }

  // Dernier recours avant d'abandonner : le lecteur vidéo natif Android
  // (Media3 ExoPlayer, hors WebView). Décode souvent des flux que le
  // navigateur refuse (codec, CORS). Renvoie false si indisponible (PWA,
  // ou plugin absent) pour laisser la suite de la chaîne de repli agir.
  function tryNativePlayer(url, title) {
    var nativePlayer = global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform() &&
      global.Capacitor.Plugins && global.Capacitor.Plugins.NativePlayer;
    if (!nativePlayer) return false;
    setStatus('Échec — nouvelle tentative avec le lecteur vidéo natif de l’appareil…');
    nativePlayer.open({ url: url, title: title || '', live: currentIsLive }).then(function () {
      close();
    }).catch(function () {
      setStatus('Lecture impossible, y compris avec le lecteur vidéo natif de l’appareil.');
    });
    return true;
  }

  function startPlayback(url, title) {
    currentUrl = url;
    currentTitle = title || '';
    titleEl.textContent = currentTitle;

    if (isCasting()) { castCurrentMedia(); return; }

    armLoadTimeout();
    destroyPlayers();
    tracksBtn.style.display = 'none';
    tracksMenu.style.display = 'none';
    video.removeAttribute('src');
    video.load();

    if (isM3u8(url) && global.Hls && global.Hls.isSupported()) {
      var useNativeLoader = global.Net && global.Net.isNative() && global.CapacitorHttpLoader;
      currentEngine = 'HLS' + (useNativeLoader ? ' natif' : '');
      setStatus('Connexion au flux (HLS)…');
      var hlsConfig = Object.assign({}, HLS_LOW_BANDWIDTH_CONFIG,
        { abrEwmaDefaultEstimate: estimateStartBandwidth() },
        useNativeLoader ? { loader: global.CapacitorHttpLoader } : {});
      hls = new global.Hls(hlsConfig);
      hls.on(global.Hls.Events.ERROR, function (evt, data) {
        if (data && data.fatal) attemptFallbackOrFail('Flux HLS interrompu (' + data.type + (data.details ? ' — ' + data.details : '') + ') — le serveur bloque peut-être ce flux depuis un navigateur (CORS).');
      });
      hls.on(global.Hls.Events.AUDIO_TRACKS_UPDATED, updateTracksVisibility);
      hls.on(global.Hls.Events.SUBTITLE_TRACKS_UPDATED, updateTracksVisibility);
      hls.on(global.Hls.Events.MANIFEST_PARSED, updateTracksVisibility);
      hls.loadSource(url);
      hls.attachMedia(video);
      video.play().catch(function () {});
    } else if (isM3u8(url) && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari (iPhone/Mac) décode le HLS nativement — pas besoin de hls.js,
      // et ça permet à AirPlay de fonctionner directement sur ce <video>.
      currentEngine = 'HLS natif (Safari)';
      setStatus('Connexion au flux (HLS)…');
      video.src = url;
      video.play().catch(function () {});
    } else if (!isDirectFile(url) && !isM3u8(url) && global.mpegts && global.mpegts.isSupported()) {
      currentEngine = 'mpeg-ts';
      setStatus('Connexion au flux (mpeg-ts)…');
      mpegtsPlayer = global.mpegts.createPlayer({ type: 'mpegts', isLive: true, url: url }, MPEGTS_LOW_BANDWIDTH_CONFIG);
      mpegtsPlayer.on(global.mpegts.Events.ERROR, function () {
        attemptFallbackOrFail('Flux mpeg-ts interrompu — le serveur bloque peut-être ce flux depuis un navigateur (CORS), ou le flux est hors service.');
      });
      mpegtsPlayer.attachMediaElement(video);
      mpegtsPlayer.load();
      mpegtsPlayer.play().catch(function () {});
    } else {
      currentEngine = !isDirectFile(url) && global.mpegts && !global.mpegts.isSupported() ? 'direct — mpeg-ts non supporté par cet appareil' : 'direct';
      setStatus('Connexion au flux (' + currentEngine + ')…');
      video.src = url;
      video.play().catch(function () {});
    }
  }

  function open(url, title, opts) {
    if (overlay) saveProgress(true); // mémorise la position du contenu quitté avant de basculer
    originalUrl = url;
    originalTitle = title || '';
    currentIsLive = !!(opts && opts.live);
    currentIsRadio = !!(opts && opts.radio);
    currentLogo = (opts && opts.logo) || '';
    currentVersions = (opts && opts.versions) || null;
    triedNativeFallback = false;
    triedM3u8Fallback = false;
    ensureDom();
    overlay.classList.add('show');
    updatePipVisibility();
    updateRecordVisibility();
    updateRemoteVisibility();
    startPlayback(url, title);
    syncRecordButtonState();
    updateTracksVisibility();
    if (currentIsLive) showZapBanner(originalTitle, opts && opts.epgKey, opts && opts.logo);
    else if (zapBanner) zapBanner.classList.remove('show');
  }

  function close() {
    clearLoadTimeout();
    saveProgress(true);
    if (document.pictureInPictureElement === video) { document.exitPictureInPicture().catch(function () {}); }
    destroyPlayers();
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    if (tracksMenu) tracksMenu.style.display = 'none';
    if (remotePanel) closeRemote();
    releaseNativeLandscapeLock();
    if (currentIsRadio) { var rp = radioPlayerPlugin(); if (rp) rp.stop().catch(function () {}); }
    if (overlay) overlay.classList.remove('show');
  }

  function isOpen() { return !!(overlay && overlay.classList.contains('show')); }

  global.Player = { open: open, close: close, isOpen: isOpen };
})(window);

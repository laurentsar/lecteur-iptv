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
 * la demande). Les deux sont indépendants du moteur de lecture local. */
(function (global) {
  'use strict';

  var hls = null;
  var mpegtsPlayer = null;
  var currentEngine = '';
  var currentUrl = '', currentTitle = '';
  var originalUrl = '', originalTitle = '';
  var triedNativeFallback = false, triedM3u8Fallback = false;
  var overlay, video, titleEl, statusEl, closeBtn, airplayBtn, castLauncher;
  var castSdkRequested = false;
  var loadTimeoutId = null;
  var LOAD_TIMEOUT_MS = 20000; // certaines entrées de playlist (séparateurs
  // de catégorie décoratifs, chaînes mortes) ne renvoient jamais d'erreur et
  // restent bloquées indéfiniment sans ce filet de sécurité.

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
      '  <button id="playerClose" class="player-close" aria-label="Fermer">✕</button>' +
      '</div>' +
      '<video id="playerVideo" playsinline controls autoplay></video>' +
      '<div id="playerStatus" class="player-status"></div>';
    document.body.appendChild(overlay);
    video = overlay.querySelector('#playerVideo');
    titleEl = overlay.querySelector('#playerTitle');
    statusEl = overlay.querySelector('#playerStatus');
    closeBtn = overlay.querySelector('#playerClose');
    airplayBtn = overlay.querySelector('#playerAirplay');
    castLauncher = overlay.querySelector('#castLauncher');
    closeBtn.addEventListener('click', close);
    video.addEventListener('error', function () {
      clearLoadTimeout();
      attemptFallbackOrFail('Lecture impossible (' + currentEngine + ') — ' + describeMediaError(video.error));
    });
    video.addEventListener('playing', function () { clearLoadTimeout(); setStatus(''); });
    setupAirplay();
    setupChromecast();
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
    nativePlayer.open({ url: url, title: title || '' }).then(function () {
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
    video.removeAttribute('src');
    video.load();

    if (isM3u8(url) && global.Hls && global.Hls.isSupported()) {
      var useNativeLoader = global.Net && global.Net.isNative() && global.CapacitorHttpLoader;
      currentEngine = 'HLS' + (useNativeLoader ? ' natif' : '');
      setStatus('Connexion au flux (HLS)…');
      hls = new global.Hls(useNativeLoader ? { enableWorker: true, loader: global.CapacitorHttpLoader } : { enableWorker: true });
      hls.on(global.Hls.Events.ERROR, function (evt, data) {
        if (data && data.fatal) attemptFallbackOrFail('Flux HLS interrompu (' + data.type + (data.details ? ' — ' + data.details : '') + ') — le serveur bloque peut-être ce flux depuis un navigateur (CORS).');
      });
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
      mpegtsPlayer = global.mpegts.createPlayer({ type: 'mpegts', isLive: true, url: url });
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

  function open(url, title) {
    originalUrl = url;
    originalTitle = title || '';
    triedNativeFallback = false;
    triedM3u8Fallback = false;
    ensureDom();
    overlay.classList.add('show');
    startPlayback(url, title);
  }

  function close() {
    clearLoadTimeout();
    destroyPlayers();
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    if (overlay) overlay.classList.remove('show');
  }

  global.Player = { open: open, close: close };
})(window);

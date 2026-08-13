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
  var currentIsLive = false; // PiP proposé uniquement pour le direct
  var triedNativeFallback = false, triedM3u8Fallback = false;
  var overlay, video, titleEl, statusEl, closeBtn, airplayBtn, pipBtn, tracksBtn, tracksMenu, castLauncher;
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
      '  <button id="playerPip" class="player-cast" aria-label="Picture-in-Picture" style="display:none">⧉</button>' +
      '  <button id="playerTracks" class="player-cast" aria-label="Langue et sous-titres" style="display:none">🌐</button>' +
      '  <button id="playerClose" class="player-close" aria-label="Fermer">✕</button>' +
      '</div>' +
      '<div id="playerTracksMenu" class="tracks-menu" style="display:none">' +
      '  <div class="tracks-title">Audio</div>' +
      '  <div id="tracksAudioList"></div>' +
      '  <div class="tracks-title">Sous-titres</div>' +
      '  <div id="tracksSubList"></div>' +
      '</div>' +
      '<video id="playerVideo" playsinline controls autoplay></video>' +
      '<div id="playerStatus" class="player-status"></div>';
    document.body.appendChild(overlay);
    video = overlay.querySelector('#playerVideo');
    titleEl = overlay.querySelector('#playerTitle');
    statusEl = overlay.querySelector('#playerStatus');
    closeBtn = overlay.querySelector('#playerClose');
    airplayBtn = overlay.querySelector('#playerAirplay');
    pipBtn = overlay.querySelector('#playerPip');
    tracksBtn = overlay.querySelector('#playerTracks');
    tracksMenu = overlay.querySelector('#playerTracksMenu');
    castLauncher = overlay.querySelector('#castLauncher');
    closeBtn.addEventListener('click', close);
    video.addEventListener('error', function () {
      clearLoadTimeout();
      attemptFallbackOrFail('Lecture impossible (' + currentEngine + ') — ' + describeMediaError(video.error));
    });
    video.addEventListener('playing', function () { clearLoadTimeout(); setStatus(''); });
    setupAirplay();
    setupChromecast();
    setupPip();
    setupTracks();
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

  function updateTracksVisibility() {
    var hasChoice = getAudioTracks().length > 1 || getSubtitleTracks().length > 0;
    tracksBtn.style.display = hasChoice ? '' : 'none';
    if (!hasChoice) tracksMenu.style.display = 'none';
  }

  function tracksMenuList(container, tracks, current, onOff, onPick) {
    container.innerHTML = '';
    if (onOff) {
      var off = document.createElement('button');
      off.className = 'tracks-item' + (current === -1 ? ' active' : '');
      off.textContent = (current === -1 ? '✓ ' : '') + 'Désactivés';
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
      hls = new global.Hls(useNativeLoader ? { enableWorker: true, loader: global.CapacitorHttpLoader } : { enableWorker: true });
      hls.on(global.Hls.Events.ERROR, function (evt, data) {
        if (data && data.fatal) attemptFallbackOrFail('Flux HLS interrompu (' + data.type + (data.details ? ' — ' + data.details : '') + ') — le serveur bloque peut-être ce flux depuis un navigateur (CORS).');
      });
      hls.on(global.Hls.Events.AUDIO_TRACKS_UPDATED, updateTracksVisibility);
      hls.on(global.Hls.Events.SUBTITLE_TRACKS_UPDATED, updateTracksVisibility);
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

  function open(url, title, opts) {
    originalUrl = url;
    originalTitle = title || '';
    currentIsLive = !!(opts && opts.live);
    triedNativeFallback = false;
    triedM3u8Fallback = false;
    ensureDom();
    overlay.classList.add('show');
    updatePipVisibility();
    startPlayback(url, title);
  }

  function close() {
    clearLoadTimeout();
    if (document.pictureInPictureElement === video) { document.exitPictureInPicture().catch(function () {}); }
    destroyPlayers();
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    if (tracksMenu) tracksMenu.style.display = 'none';
    if (overlay) overlay.classList.remove('show');
  }

  global.Player = { open: open, close: close };
})(window);

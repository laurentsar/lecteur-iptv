/* player.js — overlay de lecture vidéo : hls.js pour les flux .m3u8,
 * mpegts.js pour les flux .ts bruts (mpeg-ts en direct, très courants chez
 * les fournisseurs IPTV — le navigateur ne les décode pas nativement),
 * lecture native pour le reste (mp4, mkv...). */
(function (global) {
  'use strict';

  var hls = null;
  var mpegtsPlayer = null;
  var currentEngine = '';
  var overlay, video, titleEl, statusEl, closeBtn;

  function ensureDom() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'playerOverlay';
    overlay.className = 'player-overlay';
    overlay.innerHTML =
      '<div class="player-top">' +
      '  <span id="playerTitle" class="player-title"></span>' +
      '  <button id="playerClose" class="player-close" aria-label="Fermer">✕</button>' +
      '</div>' +
      '<video id="playerVideo" playsinline controls autoplay></video>' +
      '<div id="playerStatus" class="player-status"></div>';
    document.body.appendChild(overlay);
    video = overlay.querySelector('#playerVideo');
    titleEl = overlay.querySelector('#playerTitle');
    statusEl = overlay.querySelector('#playerStatus');
    closeBtn = overlay.querySelector('#playerClose');
    closeBtn.addEventListener('click', close);
    video.addEventListener('error', function () {
      setStatus('Lecture impossible (' + currentEngine + ') — flux hors service, serveur injoignable, ou format/CORS non pris en charge par cet appareil.');
    });
    video.addEventListener('playing', function () { setStatus(''); });
  }

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }

  function destroyPlayers() {
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (mpegtsPlayer) { try { mpegtsPlayer.destroy(); } catch (e) {} mpegtsPlayer = null; }
  }

  function isM3u8(url) { return /\.m3u8(\?|#|$)/i.test(url); }
  // Les flux "live" IPTV qui ne sont pas du HLS sont presque toujours du
  // mpeg-ts brut, avec ou sans extension .ts explicite dans l'URL (beaucoup
  // de panels Xtream Codes n'en mettent pas). On ne traite comme "fichier
  // direct" (mp4/mkv...) que les extensions de VOD reconnues.
  function isDirectFile(url) { return /\.(mp4|mkv|webm|mov|m4v|avi)(\?|#|$)/i.test(url); }

  function open(url, title) {
    ensureDom();
    overlay.classList.add('show');
    titleEl.textContent = title || '';
    destroyPlayers();
    video.removeAttribute('src');
    video.load();

    if (isM3u8(url) && global.Hls && global.Hls.isSupported()) {
      currentEngine = 'HLS';
      setStatus('Connexion au flux (HLS)…');
      hls = new global.Hls({ enableWorker: true });
      hls.on(global.Hls.Events.ERROR, function (evt, data) {
        if (data && data.fatal) setStatus('Flux HLS interrompu (' + data.type + ') — le serveur bloque peut-être ce flux depuis un navigateur (CORS).');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      video.play().catch(function () {});
    } else if (!isDirectFile(url) && global.mpegts && global.mpegts.isSupported()) {
      currentEngine = 'mpeg-ts';
      setStatus('Connexion au flux (mpeg-ts)…');
      mpegtsPlayer = global.mpegts.createPlayer({ type: 'mpegts', isLive: true, url: url });
      mpegtsPlayer.on(global.mpegts.Events.ERROR, function () {
        setStatus('Flux mpeg-ts interrompu — le serveur bloque peut-être ce flux depuis un navigateur (CORS), ou le flux est hors service.');
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

  function close() {
    destroyPlayers();
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    if (overlay) overlay.classList.remove('show');
  }

  global.Player = { open: open, close: close };
})(window);

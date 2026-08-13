/* player.js — overlay de lecture vidéo : hls.js pour les flux .m3u8, lecture
 * native pour le reste (mp4, mkv...). Les flux .ts bruts (mpeg-ts en direct,
 * hors HLS) ne sont pas décodables par le navigateur : voir README/Infos. */
(function (global) {
  'use strict';

  var hls = null;
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
    video.addEventListener('error', function () { setStatus('Lecture impossible — flux hors service, format non pris en charge, ou serveur injoignable.'); });
    video.addEventListener('playing', function () { setStatus(''); });
  }

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }

  function destroyHls() {
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
  }

  function isM3u8(url) { return /\.m3u8(\?|#|$)/i.test(url); }

  function open(url, title) {
    ensureDom();
    overlay.classList.add('show');
    titleEl.textContent = title || '';
    setStatus('Connexion au flux…');
    destroyHls();
    video.removeAttribute('src');
    video.load();

    if (isM3u8(url) && global.Hls && global.Hls.isSupported()) {
      hls = new global.Hls({ enableWorker: true });
      hls.on(global.Hls.Events.ERROR, function (evt, data) {
        if (data && data.fatal) setStatus('Flux interrompu (' + data.type + ').');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      video.play().catch(function () {});
    } else {
      video.src = url;
      video.play().catch(function () {});
    }
  }

  function close() {
    destroyHls();
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    if (overlay) overlay.classList.remove('show');
  }

  global.Player = { open: open, close: close };
})(window);

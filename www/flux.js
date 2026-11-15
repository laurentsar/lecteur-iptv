/* flux.js — ce que le lecteur web sait des flux, sans état d'interface :
 * réglages de hls.js et mpegts.js, formes d'URL (HLS, fichier direct,
 * variante .m3u8), type envoyé au Chromecast, texte d'une erreur <video>,
 * durée et bandeau « en cours / ensuite ». Sorti de player.js, qui reprend
 * ces noms tels quels. */
(function (global) {
  'use strict';

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

  function isM3u8(url) { return /\.m3u8(\?|#|$)/i.test(url); }
  // Les flux "live" IPTV qui ne sont pas du HLS sont presque toujours du
  // mpeg-ts brut, avec ou sans extension .ts explicite dans l'URL (beaucoup
  // de panels Xtream Codes n'en mettent pas). On ne traite comme "fichier
  // direct" (mp4/mkv...) que les extensions de VOD reconnues — plus les
  // extensions audio brutes des radios icecast/shoutcast (mp3, aac...) :
  // ce ne sont pas des conteneurs mpeg-ts/FLV, mpegts.js échoue donc à les
  // démultiplexer et boucle en reconnexion sans fin (ex. FIP en .mp3) alors
  // que le <video> les décode nativement sans le moindre besoin de démux.
  function isDirectFile(url) { return /\.(mp4|mkv|webm|mov|m4v|avi|mp3|aac|m4a|ogg|oga|opus|wav|flac)(\?|#|$)/i.test(url); }

  // Remplace (ou ajoute) l'extension de l'URL par .m3u8, en préservant une
  // éventuelle query string / ancre.
  function swapExtToM3u8(url) {
    var m = /^([^?#]*)([?#].*)?$/.exec(url);
    var base = (m ? m[1] : url).replace(/\.[a-zA-Z0-9]+$/, '');
    return base + '.m3u8' + (m && m[2] ? m[2] : '');
  }

  function castMimeType(url) {
    if (isM3u8(url)) return 'application/x-mpegurl';
    if (/\.mkv(\?|#|$)/i.test(url)) return 'video/x-matroska';
    return 'video/mp4';
  }

  // Le récepteur Cast par défaut ne lit pas le MPEG-TS brut, format habituel
  // des liens IPTV en direct : on lui envoie la variante HLS de la même
  // chaîne (même bascule que le repli de lecture, voir swapExtToM3u8).
  function castUrl(url) {
    if (isM3u8(url) || isDirectFile(url)) return url;
    return swapExtToM3u8(url);
  }

  function formatTime(s) {
    s = Math.max(0, Math.round(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var mm = (h ? String(m).padStart(2, '0') : String(m));
    var ss = String(sec).padStart(2, '0');
    return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

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

  function heure(ms) {
    var d = new Date(ms);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  // « ▶ JT (20:00–20:45) · Ensuite 20:45 Météo » : texte fixe pour une
  // même émission (pas de « encore 12 min »), sinon le bandeau natif
  // ressurgirait à chaque rafraîchissement.
  function texteMaintenantEnsuite(epg) {
    if (!epg || !epg.now) return '';
    var t = '▶ ' + epg.now.titre;
    if (epg.now.start != null && epg.now.stop != null) t += ' (' + heure(epg.now.start) + '–' + heure(epg.now.stop) + ')';
    if (epg.next && epg.next.titre) t += '\nEnsuite ' + (epg.next.start != null ? heure(epg.next.start) + ' ' : '') + epg.next.titre;
    return t;
  }

  var Flux = {
    HLS_LOW_BANDWIDTH_CONFIG: HLS_LOW_BANDWIDTH_CONFIG, MPEGTS_LOW_BANDWIDTH_CONFIG: MPEGTS_LOW_BANDWIDTH_CONFIG,
    estimateStartBandwidth: estimateStartBandwidth, formatTime: formatTime, castMimeType: castMimeType,
    castUrl: castUrl, describeMediaError: describeMediaError, isM3u8: isM3u8, isDirectFile: isDirectFile,
    swapExtToM3u8: swapExtToM3u8, heure: heure, texteMaintenantEnsuite: texteMaintenantEnsuite
  };
  global.Flux = Flux;
  if (typeof module !== 'undefined' && module.exports) module.exports = Flux;
})(typeof window !== 'undefined' ? window : globalThis);

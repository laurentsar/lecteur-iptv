/* net.js — requêtes réseau qui évitent les CORS sur Android.
 *
 * La plupart des serveurs IPTV (M3U, Xtream Codes) sont pensés pour des
 * lecteurs natifs (VLC, apps mobiles) : ils ne renvoient pas les en-têtes
 * CORS qu'un navigateur exige pour un fetch() JS, qui échoue alors avec
 * "Failed to fetch" même si le serveur répond correctement.
 *
 * Sur l'APK Android, on route donc ces requêtes par le plugin natif
 * CapacitorHttp (réseau natif, jamais soumis aux CORS puisque ce n'est pas
 * un navigateur). Sur la PWA (aucun pont natif disponible), on reste sur le
 * fetch() du navigateur — la limite CORS documentée dans Infos s'y applique
 * toujours. La lecture vidéo (hls.js) n'est volontairement pas touchée ici :
 * elle continue d'utiliser fetch/XHR du navigateur normalement.
 */
(function (global) {
  'use strict';

  function nativeHttp() {
    var cap = global.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
    return (cap.Plugins && cap.Plugins.CapacitorHttp) || null;
  }

  function fetchText(url) {
    var http = nativeHttp();
    if (http) {
      return http.request({ url: url, method: 'GET', responseType: 'text' }).then(function (res) {
        if (res.status && (res.status < 200 || res.status >= 300)) throw new Error('HTTP ' + res.status);
        return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      });
    }
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  function fetchJson(url) {
    var http = nativeHttp();
    if (http) {
      return http.request({ url: url, method: 'GET' }).then(function (res) {
        if (res.status && (res.status < 200 || res.status >= 300)) throw new Error('HTTP ' + res.status);
        return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      });
    }
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  global.Net = { fetchText: fetchText, fetchJson: fetchJson, isNative: function () { return !!nativeHttp(); } };
})(window);

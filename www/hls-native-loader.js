/* hls-native-loader.js — chargeur hls.js qui passe par le réseau natif
 * Capacitor (CapacitorHttp) au lieu du fetch/XHR du navigateur.
 *
 * hls.js télécharge lui-même la manifeste et chaque segment vidéo via
 * fetch/XHR, qui applique les CORS du navigateur — net.js (playlist/API)
 * ne couvre pas ces requêtes. Beaucoup de serveurs IPTV bloquent aussi le
 * CORS sur leurs flux vidéo, ce qui interrompt la lecture même quand le
 * flux HLS existe bel et bien. Ce chargeur, utilisé uniquement sur l'APK
 * Android (voir player.js), route chaque requête (manifeste + segments)
 * par CapacitorHttp, qui n'est pas soumis aux CORS.
 *
 * Simplification assumée : pas de support des requêtes par plage d'octets
 * (Range) — un segment est toujours chargé en entier, ce qui correspond à
 * l'usage standard des flux IPTV (pas de HLS basse latence). */
(function (global) {
  'use strict';

  function base64ToArrayBuffer(b64) {
    var binary = atob(b64);
    var len = binary.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function CapacitorHttpLoader(config) {
    this.config = config;
    this.aborted = false;
    this.stats = {
      aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, first: 0, end: 0 }
    };
  }

  CapacitorHttpLoader.prototype.destroy = function () {};
  CapacitorHttpLoader.prototype.abort = function () { this.aborted = true; };

  CapacitorHttpLoader.prototype.load = function (context, config, callbacks) {
    var self = this;
    var http = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.CapacitorHttp;
    var isBinary = context.responseType === 'arraybuffer';
    var start = self.stats.loading.start = performance.now();

    if (!http) {
      callbacks.onError({ code: 0, text: 'CapacitorHttp indisponible' }, context, null);
      return;
    }

    http.request({ url: context.url, method: 'GET', responseType: isBinary ? 'arraybuffer' : 'text' })
      .then(function (res) {
        if (self.aborted) return;
        var now = performance.now();
        self.stats.loading.first = now;
        self.stats.loading.end = now;

        if (res.status && (res.status < 200 || res.status >= 300)) {
          callbacks.onError({ code: res.status, text: 'HTTP ' + res.status }, context, null);
          return;
        }

        var data;
        if (isBinary) {
          data = typeof res.data === 'string' ? base64ToArrayBuffer(res.data) : res.data;
          self.stats.loaded = self.stats.total = data.byteLength || 0;
        } else {
          data = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
          self.stats.loaded = self.stats.total = data.length;
        }
        callbacks.onSuccess({ url: context.url, data: data }, self.stats, context, null);
      })
      .catch(function (err) {
        if (self.aborted) return;
        callbacks.onError({ code: 0, text: (err && err.message) || 'erreur réseau' }, context, null);
      });
  };

  global.CapacitorHttpLoader = CapacitorHttpLoader;
})(window);

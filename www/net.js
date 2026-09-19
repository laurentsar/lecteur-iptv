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

  // Aucune des deux voies réseau ci-dessous (CapacitorHttp natif ou fetch()
  // du navigateur) n'a de délai par défaut : une requête qui ne répond
  // jamais (DNS qui traîne, connexion TCP ouverte mais silencieuse, serveur
  // hors service qui ne renvoie ni erreur ni fermeture...) reste sinon en
  // attente indéfiniment, avec l'appli bloquée sur « Chargement… » sans
  // jamais afficher d'erreur ni permettre de réessayer — constaté sur un
  // boîtier TV Android dont le réseau vers le serveur Xtream restait
  // silencieux. Au-delà de ce délai, on abandonne et on remonte une erreur
  // exploitable plutôt que de rester bloqué pour toujours.
  var REQUEST_TIMEOUT_MS = 20000;
  // Le même délai ne peut pas servir aux deux usages : 20 s conviennent à une
  // réponse d'API ou à une playlist (quelques centaines de kilooctets), mais
  // pas au guide TV, dont le XMLTV pèse couramment des dizaines de mégaoctets
  // — sur un boîtier TV en Wi-Fi moyen, un téléchargement qui progresse
  // normalement était tué en plein milieu et remonté comme « le serveur ne
  // répond pas ». Ni CapacitorHttp ni fetch() sur le chemin natif ne donnent
  // d'événement de progression exploitable ici : on ne peut pas compter les
  // octets, seulement laisser une marge honnête au transfert.
  var BYTES_TIMEOUT_MS = 120000;

  function withTimeout(promise, delai) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('le serveur ne répond pas (délai dépassé)'));
      }, delai || REQUEST_TIMEOUT_MS);
      promise.then(function (v) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      }, function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function nativeHttp() {
    var cap = global.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
    return (cap.Plugins && cap.Plugins.CapacitorHttp) || null;
  }

  // Certains réseaux/boîtiers filtrent le trafic sortant d'une appli tierce
  // sur la base d'heuristiques anti-piratage (parfois juste l'en-tête
  // User-Agent générique envoyé par défaut par le client HTTP natif
  // d'Android, très différent de celui d'un navigateur) — constaté sur un
  // boîtier TV où l'appli échouait à joindre un serveur Xtream alors que
  // d'autres applis du même boîtier, sur le même réseau, y arrivaient très
  // bien. Se faire passer pour un navigateur ordinaire ne coûte rien sur les
  // appareils où ça fonctionne déjà, et peut débloquer ceux où ce filtrage
  // existe.
  var BROWSER_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

  // Repli sur fetch() du navigateur si le réseau natif échoue (erreur de
  // connexion, pas un simple statut HTTP d'erreur) : sur un boîtier dont le
  // système bloque les sockets natifs d'une appli tierce tout en laissant
  // passer la WebView, ce chemin peut réussir là où CapacitorHttp échoue.
  // S'il échoue aussi (probable si c'est vraiment le réseau qui est en
  // cause, ou par CORS si le serveur ne renvoie pas les en-têtes
  // nécessaires), on remonte l'erreur native d'origine — plus parlante
  // ("Failed to connect...") qu'une erreur CORS générique ("Failed to
  // fetch").
  function withNativeFallback(nativeAttempt, browserAttempt) {
    return nativeAttempt.catch(function (nativeErr) {
      return browserAttempt().catch(function () { throw nativeErr; });
    });
  }

  // Certains fournisseurs IPTV distribuent des URLs en https:// dont le
  // serveur ne parle en réalité que du HTTP en clair sur ce port (panel mal
  // configuré, ou URL copiée depuis un autre service) — constaté en usage
  // réel : "Impossible de charger la playlist : Unable to parse TLS packet
  // header", une erreur de handshake TLS bas niveau plutôt qu'un simple
  // statut HTTP. Une tentative de repli en http:// suffit à débloquer ces
  // cas ; limité aux erreurs qui ressemblent explicitement à un échec
  // TLS/SSL pour ne pas masquer une vraie panne réseau derrière un second
  // essai inutile. "handshake" est inclus séparément de "tls"/"ssl" : sur
  // Android, ce même scénario (poignée de main TLS tentée contre un
  // serveur qui ne parle pas TLS) remonte parfois un message du genre
  // "Handshake failed" (SSLHandshakeException) qui ne contient ni "tls" ni
  // "ssl" en tant que mot isolé — constaté en usage réel, la playlist
  // restait bloquée alors que ce repli aurait dû s'appliquer.
  function isTlsFailure(err) {
    return /\btls\b|\bssl\b|\bhandshake\b/i.test(String((err && err.message) || err || ''));
  }

  // Page servie en https:// (PWA GitHub Pages) qui tente de joindre un
  // serveur IPTV en http:// (le cas quasi général — la plupart des panels
  // Xtream/M3U n'ont pas de certificat) : tous les navigateurs bloquent ce
  // "contenu mixte" avant même d'émettre la requête, aucune en-tête
  // serveur ni code JS ne peut lever cette restriction — contrairement au
  // CORS (qui dépend du serveur), c'est une politique fixe du navigateur.
  // Sans ce contrôle, l'échec remonte comme "Load failed" (Safari) ou
  // "Failed to fetch" (Chrome), indiscernable d'une vraie panne réseau —
  // constaté en usage réel sur iPhone. On le détecte ici pour donner tout
  // de suite un message exploitable, plutôt que de tenter un fetch() voué
  // à l'échec.
  function isMixedContentBlocked(url) {
    return !!(global.location && global.location.protocol === 'https:' && /^http:\/\//i.test(url));
  }

  function mixedContentError() {
    return new Error('le navigateur bloque l’accès à un serveur en http:// (non sécurisé) depuis ' +
      'cette page en https:// — restriction de sécurité systématique, sans contournement possible ' +
      'ici. Utilise l’APK Android (pas soumise à cette limite), ou une adresse de serveur en ' +
      'https:// si ton fournisseur IPTV en propose une.');
  }

  // Factorise le contrôle de contenu mixte ci-dessus sur les 6 points
  // d'appel à fetch() du fichier (texte/octets/JSON × natif absent ou en
  // repli) : rejette tout de suite plutôt que de laisser fetch() échouer
  // avec un message générique.
  function browserFetch(url, transform, timeout) {
    if (isMixedContentBlocked(url)) {
      // Relais Home Assistant configuré (voir hasync.js et
      // homeassistant/iptv_proxy) : la requête passe par lui, en https://,
      // au lieu d'échouer directement — sinon, message d'erreur clair
      // plutôt qu'un fetch() voué à l'échec.
      var relais = (global.HaSync && global.HaSync.proxyActif && global.HaSync.proxyActif())
        ? global.HaSync.proxyUrl(url) : null;
      if (relais) return withTimeout(fetch(relais).then(transform), timeout);
      return Promise.reject(mixedContentError());
    }
    return withTimeout(fetch(url).then(transform), timeout);
  }

  function withHttpsDowngrade(url, attempt) {
    return attempt(url).catch(function (err) {
      if (!/^https:\/\//i.test(url) || !isTlsFailure(err)) throw err;
      return attempt(url.replace(/^https:\/\//i, 'http://'));
    });
  }

  function fetchText(url) {
    return withHttpsDowngrade(url, fetchTextAttempt);
  }

  function fetchTextAttempt(url) {
    var http = nativeHttp();
    if (http) {
      return withNativeFallback(
        withTimeout(http.request({ url: url, method: 'GET', responseType: 'text', headers: { 'User-Agent': BROWSER_UA } }).then(function (res) {
          if (res.status && (res.status < 200 || res.status >= 300)) throw new Error('HTTP ' + res.status);
          return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        })),
        function () {
          return browserFetch(url, function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
          });
        }
      );
    }
    return browserFetch(url, function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  // Octets bruts (pour l'EPG XMLTV, potentiellement gzip — voir epg.js) :
  // sur natif, CapacitorHttp ne peut renvoyer un binaire qu'encodé en
  // base64 à travers le pont JS (pas d'ArrayBuffer direct possible),
  // décodé ici avec atob().
  function fetchBytes(url) {
    return withHttpsDowngrade(url, fetchBytesAttempt);
  }

  function fetchBytesAttempt(url) {
    var http = nativeHttp();
    if (http) {
      return withNativeFallback(
        withTimeout(http.request({ url: url, method: 'GET', responseType: 'arraybuffer', headers: { 'User-Agent': BROWSER_UA } }).then(function (res) {
          if (res.status && (res.status < 200 || res.status >= 300)) throw new Error('HTTP ' + res.status);
          var bin = atob(res.data);
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return bytes.buffer;
        }), BYTES_TIMEOUT_MS),
        function () {
          return browserFetch(url, function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.arrayBuffer();
          }, BYTES_TIMEOUT_MS);
        }
      );
    }
    return browserFetch(url, function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }, BYTES_TIMEOUT_MS);
  }

  function fetchJson(url) {
    return withHttpsDowngrade(url, fetchJsonAttempt);
  }

  function fetchJsonAttempt(url) {
    var http = nativeHttp();
    if (http) {
      return withNativeFallback(
        withTimeout(http.request({ url: url, method: 'GET', headers: { 'User-Agent': BROWSER_UA } }).then(function (res) {
          if (res.status && (res.status < 200 || res.status >= 300)) throw new Error('HTTP ' + res.status);
          return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        })),
        function () {
          return browserFetch(url, function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          });
        }
      );
    }
    return browserFetch(url, function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  global.Net = {
    fetchText: fetchText, fetchJson: fetchJson, fetchBytes: fetchBytes,
    isNative: function () { return !!nativeHttp(); },
    isMixedContentBlocked: isMixedContentBlocked
  };
})(window);

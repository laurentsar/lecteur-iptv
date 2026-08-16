/* epg.js — guide des programmes. Deux sources possibles :
 *   - XMLTV (playlists M3U qui déclarent url-tvg / x-tvg-url) : non compressé
 *     uniquement, le .gz n'est pas décompressé ici.
 *   - Xtream Codes : get_short_epg, déjà géré dans xtream.js. */
(function (global) {
  'use strict';

  // "YYYYMMDDHHmmss +ZZZZ" -> timestamp ms
  function parseXmltvDate(s) {
    if (!s) return null;
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/.exec(s.trim());
    if (!m) return null;
    var d = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (m[7]) {
      var sign = m[7][0] === '-' ? 1 : -1;
      var offMin = (+m[7].slice(1, 3)) * 60 + (+m[7].slice(3, 5));
      d += sign * offMin * 60000;
    }
    return d;
  }

  function looksGzip(buf) {
    var b = new Uint8Array(buf.slice(0, 2));
    return b[0] === 0x1f && b[1] === 0x8b;
  }

  // Nom de chaîne réduit à ses lettres/chiffres, sans accents/casse/
  // décorations courantes de fournisseur, pour comparer un nom M3U/Xtream
  // à un <display-name> XMLTV en restant sur une égalité stricte (pas de
  // correspondance partielle, qui confondrait par exemple « France 2 » et
  // « France 24 ») : « |FR|| FRANCE 3 FHD » et « France 3 » doivent tous
  // les deux réduire à « france3 » pour matcher, voir progsFor() plus bas.
  var CHAN_PREFIX = /^\s*[[|]?\s*[a-z]{2,3}\s*[\]|]+\s*/i; // "|FR|| ", "[FR] "...
  var CHAN_SUFFIX = /\s*(\b(?:fhd|uhd|hd|sd|4k|hevc)\b|\+\d+)\s*$/i; // "FHD", "+1"...
  function normalizeChanName(s) {
    var n = String(s || '').replace(CHAN_PREFIX, '');
    var prev;
    do { prev = n; n = n.replace(CHAN_SUFFIX, ''); } while (n !== prev);
    return n.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  function parseXmltvText(text) {
    var xml = new DOMParser().parseFromString(text, 'text/xml');
    if (xml.querySelector('parsererror')) throw new Error('XMLTV invalide (ou EPG compressé .gz non pris en charge)');
    var byChannel = {};
    xml.querySelectorAll('programme').forEach(function (p) {
      var ch = p.getAttribute('channel');
      if (!ch) return;
      var titleEl = p.querySelector('title');
      var entry = {
        start: parseXmltvDate(p.getAttribute('start')),
        stop: parseXmltvDate(p.getAttribute('stop')),
        titre: titleEl ? titleEl.textContent : ''
      };
      (byChannel[ch] = byChannel[ch] || []).push(entry);
    });
    Object.keys(byChannel).forEach(function (ch) {
      byChannel[ch].sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
    });
    // Alias par nom d'affichage XMLTV (<channel id="X"><display-name>) : le
    // tvg-id d'une playlist M3U ne correspond pas toujours à l'identifiant
    // XMLTV du fournisseur EPG (souvent un tiers, distinct du fournisseur
    // de la playlist) — c'est la cause la plus fréquente d'un Guide sans
    // aucun programme alors que l'EPG s'est bien chargé. Repli par nom de
    // chaîne normalisé si la recherche par identifiant échoue, voir
    // progsFor() plus bas.
    xml.querySelectorAll('channel').forEach(function (c) {
      var id = c.getAttribute('id');
      if (!id || !byChannel[id]) return;
      c.querySelectorAll('display-name').forEach(function (dn) {
        var norm = normalizeChanName(dn.textContent);
        if (norm) byChannel['name:' + norm] = byChannel[id];
      });
    });
    return byChannel;
  }

  // Programmes d'une chaîne : par identifiant EPG (tvg-id / stream_id)
  // d'abord, par nom de chaîne normalisé ensuite si l'identifiant ne
  // correspond à rien (voir alias construits dans parseXmltvText).
  function progsFor(byChannel, channelId, name) {
    if (!byChannel) return null;
    if (channelId && byChannel[channelId]) return byChannel[channelId];
    var norm = normalizeChanName(name);
    return (norm && byChannel['name:' + norm]) || null;
  }

  // Beaucoup de fournisseurs servent leur XMLTV compressé (epg.xml.gz),
  // parfois sans l'en-tête HTTP Content-Encoding qui permettrait une
  // décompression transparente par le client réseau — d'où la
  // décompression manuelle ici, via l'API standard DecompressionStream
  // (supportée par la WebView Android comme par les navigateurs récents,
  // aucune dépendance externe nécessaire).
  function gunzipToText(buf) {
    if (typeof global.DecompressionStream !== 'function') {
      return Promise.reject(new Error('EPG compressé (.gz) : décompression non supportée par cette WebView/ce navigateur.'));
    }
    var stream = new Response(buf).body.pipeThrough(new global.DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer().then(function (decompressed) {
      return new TextDecoder('utf-8').decode(decompressed);
    });
  }

  // Octets bruts dans tous les cas (natif ou navigateur) : nécessaire pour
  // détecter un éventuel gzip par ses magic bytes avant de décoder en
  // texte — sur l'APK Android, on passe par le réseau natif (Net) pour
  // éviter les blocages CORS des panels IPTV, comme pour les playlists et
  // l'API Xtream.
  function fetchXmltv(url) {
    var bytesPromise = (global.Net && global.Net.isNative())
      ? global.Net.fetchBytes(url)
      : fetch(url).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        });
    return bytesPromise.then(function (buf) {
      return looksGzip(buf) ? gunzipToText(buf) : new TextDecoder('utf-8').decode(buf);
    }).then(parseXmltvText);
  }

  function nowNext(byChannel, channelId, name, at) {
    var list = progsFor(byChannel, channelId, name);
    if (!list || !list.length) return null;
    var t = at || Date.now();
    var now = null, next = null;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.start != null && p.stop != null && t >= p.start && t < p.stop) { now = p; next = list[i + 1] || null; break; }
      if (p.start != null && p.start > t) { next = p; break; }
    }
    return (now || next) ? { now: now, next: next } : null;
  }

  global.Epg = { fetchXmltv: fetchXmltv, nowNext: nowNext, parseXmltvDate: parseXmltvDate, progsFor: progsFor, normalizeChanName: normalizeChanName };
})(window);

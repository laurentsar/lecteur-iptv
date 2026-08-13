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

  function fetchXmltv(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      if (looksGzip(buf)) throw new Error('EPG compressé (.gz) non pris en charge — utilise un lien XMLTV non compressé.');
      var text = new TextDecoder('utf-8').decode(buf);
      var xml = new DOMParser().parseFromString(text, 'text/xml');
      if (xml.querySelector('parsererror')) throw new Error('XMLTV invalide');
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
      return byChannel;
    });
  }

  function nowNext(byChannel, channelId, at) {
    var list = byChannel && byChannel[channelId];
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

  global.Epg = { fetchXmltv: fetchXmltv, nowNext: nowNext, parseXmltvDate: parseXmltvDate };
})(window);

/* m3u.js — analyse d'une playlist M3U/M3U8 étendue (#EXTINF) et répartition
 * heuristique des entrées en direct / films / séries. */
(function (global) {
  'use strict';

  var RE_ATTR = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

  function parseAttrs(line) {
    var attrs = {};
    var m;
    RE_ATTR.lastIndex = 0;
    while ((m = RE_ATTR.exec(line))) attrs[m[1].toLowerCase()] = m[2];
    return attrs;
  }

  // Détecte "Nom S01E02", "Nom 1x02", "Nom - Saison 1 Episode 2".
  var RE_SERIES = /^(.*?)[\s._-]+s(?:eason)?\s*(\d{1,2})\s*[ex.]?\s*(?:e(?:pisode)?)?\s*(\d{1,3})\b/i;
  var RE_SERIES_ALT = /^(.*?)[\s._-]+(\d{1,2})x(\d{1,3})\b/i;

  function detectSeries(name) {
    var m = RE_SERIES.exec(name) || RE_SERIES_ALT.exec(name);
    if (!m) return null;
    return { serie: m[1].trim().replace(/[\s._-]+$/, ''), saison: parseInt(m[2], 10), episode: parseInt(m[3], 10) };
  }

  var VOD_HINTS = /(film|movie|vod|cinema|ciné)/i;
  var SERIES_HINTS = /(s[ée]rie|series|show)/i;

  function classifyGroup(groupTitle, name) {
    var g = groupTitle || '';
    var serie = detectSeries(name || '');
    if (serie) return 'series';
    if (SERIES_HINTS.test(g)) return 'series';
    if (VOD_HINTS.test(g)) return 'vod';
    return 'live';
  }

  function parse(text) {
    var lines = String(text || '').split(/\r?\n/);
    var items = [];
    var epgUrl = null;
    var pending = null;

    if (lines[0] && /^#EXTM3U/i.test(lines[0])) {
      var head = parseAttrs(lines[0]);
      epgUrl = head['url-tvg'] || head['x-tvg-url'] || null;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('#EXTINF') === 0) {
        var attrs = parseAttrs(line);
        var afterComma = line.slice(line.indexOf(',') + 1).trim();
        pending = {
          tvgId: attrs['tvg-id'] || '',
          tvgLogo: attrs['tvg-logo'] || '',
          groupTitle: attrs['group-title'] || 'Sans groupe',
          name: afterComma || attrs['tvg-name'] || 'Sans nom'
        };
      } else if (line.indexOf('#') === 0) {
        continue; // autre directive M3U (#EXTGRP, #EXTVLCOPT, ...) ignorée
      } else if (pending) {
        pending.url = line;
        pending.key = 'm3u:' + pending.url;
        var kind = classifyGroup(pending.groupTitle, pending.name);
        pending.kind = kind;
        if (kind === 'series') pending.series = detectSeries(pending.name);
        items.push(pending);
        pending = null;
      }
    }
    return { epgUrl: epgUrl, items: items };
  }

  // Regroupe les items "series" détectés en { serie, saisons: { n: [episodes] } }
  function groupSeries(items) {
    var byName = {};
    items.forEach(function (it) {
      if (it.kind !== 'series') return;
      var s = it.series || { serie: it.name, saison: 1, episode: 0 };
      var key = s.serie.toLowerCase();
      if (!byName[key]) byName[key] = { nom: s.serie, logo: it.tvgLogo, groupTitle: it.groupTitle, saisons: {} };
      if (!byName[key].saisons[s.saison]) byName[key].saisons[s.saison] = [];
      byName[key].saisons[s.saison].push(Object.assign({ saison: s.saison, episode: s.episode }, it));
    });
    return Object.keys(byName).sort().map(function (k) { return byName[k]; });
  }

  global.M3U = { parse: parse, classifyGroup: classifyGroup, detectSeries: detectSeries, groupSeries: groupSeries };
})(window);

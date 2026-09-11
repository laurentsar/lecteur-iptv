/* xtream.js — client minimal pour l'API Xtream Codes (player_api.php),
 * utilisée par la plupart des fournisseurs IPTV « serveur + identifiants ». */
(function (global) {
  'use strict';

  function baseUrl(serveur) {
    var s = String(serveur || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
  }

  function api(cfg, action, extra) {
    var url = baseUrl(cfg.serveur) + '/player_api.php?username=' + encodeURIComponent(cfg.utilisateur) +
      '&password=' + encodeURIComponent(cfg.motDePasse) +
      (action ? '&action=' + action : '') +
      (extra || '');
    return global.Net.fetchJson(url);
  }

  function auth(cfg) { return api(cfg, ''); }

  function liveCategories(cfg) { return api(cfg, 'get_live_categories'); }
  function liveStreams(cfg, categoryId) {
    return api(cfg, 'get_live_streams', categoryId ? '&category_id=' + encodeURIComponent(categoryId) : '');
  }
  function vodCategories(cfg) { return api(cfg, 'get_vod_categories'); }
  function vodStreams(cfg, categoryId) {
    return api(cfg, 'get_vod_streams', categoryId ? '&category_id=' + encodeURIComponent(categoryId) : '');
  }
  function seriesCategories(cfg) { return api(cfg, 'get_series_categories'); }
  function seriesList(cfg, categoryId) {
    return api(cfg, 'get_series', categoryId ? '&category_id=' + encodeURIComponent(categoryId) : '');
  }
  function seriesInfo(cfg, seriesId) {
    return api(cfg, 'get_series_info', '&series_id=' + encodeURIComponent(seriesId));
  }
  function vodInfo(cfg, vodId) {
    return api(cfg, 'get_vod_info', '&vod_id=' + encodeURIComponent(vodId));
  }
  function shortEpg(cfg, streamId, limit) {
    return api(cfg, 'get_short_epg', '&stream_id=' + encodeURIComponent(streamId) + '&limit=' + (limit || 2));
  }

  function xmltvUrl(cfg) {
    return baseUrl(cfg.serveur) + '/xmltv.php?username=' + encodeURIComponent(cfg.utilisateur) +
      '&password=' + encodeURIComponent(cfg.motDePasse);
  }

  // Une playlist M3U servie par un panel Xtream Codes (.../get.php?username=
  // ...&password=...) expose son guide au même endroit, en XMLTV :
  // .../xmltv.php avec les mêmes identifiants. Beaucoup de panels ne
  // déclarent pas d'url-tvg en tête de M3U — le guide paraissait alors
  // inexistant alors qu'il suffisait de le demander à la bonne adresse.
  function xmltvFromM3uUrl(m3uUrl) {
    if (!m3uUrl) return null;
    try {
      var u = new URL(m3uUrl);
      if (!/\/get\.php$/i.test(u.pathname)) return null;
      var utilisateur = u.searchParams.get('username');
      var motDePasse = u.searchParams.get('password');
      if (!utilisateur || !motDePasse) return null;
      return u.origin + u.pathname.replace(/get\.php$/i, 'xmltv.php') +
        '?username=' + encodeURIComponent(utilisateur) +
        '&password=' + encodeURIComponent(motDePasse);
    } catch (e) {
      return null; // URL non analysable : pas de guide déductible
    }
  }

  function streamUrl(cfg, kind, streamId, ext) {
    var b = baseUrl(cfg.serveur);
    var u = encodeURIComponent(cfg.utilisateur), p = encodeURIComponent(cfg.motDePasse);
    if (kind === 'live') return b + '/live/' + u + '/' + p + '/' + streamId + '.' + (ext || 'm3u8');
    if (kind === 'vod') return b + '/movie/' + u + '/' + p + '/' + streamId + '.' + (ext || 'mp4');
    return b + '/series/' + u + '/' + p + '/' + streamId + '.' + (ext || 'mp4');
  }

  function b64decode(s) {
    try { return decodeURIComponent(escape(atob(s))); } catch (e) { try { return atob(s); } catch (e2) { return ''; } }
  }

  global.Xtream = {
    auth: auth,
    liveCategories: liveCategories, liveStreams: liveStreams,
    vodCategories: vodCategories, vodStreams: vodStreams,
    seriesCategories: seriesCategories, seriesList: seriesList, seriesInfo: seriesInfo, vodInfo: vodInfo,
    shortEpg: shortEpg, streamUrl: streamUrl, xmltvUrl: xmltvUrl, xmltvFromM3uUrl: xmltvFromM3uUrl,
    baseUrl: baseUrl, b64decode: b64decode
  };
})(window);

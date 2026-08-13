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
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
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
  function shortEpg(cfg, streamId, limit) {
    return api(cfg, 'get_short_epg', '&stream_id=' + encodeURIComponent(streamId) + '&limit=' + (limit || 2));
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
    seriesCategories: seriesCategories, seriesList: seriesList, seriesInfo: seriesInfo,
    shortEpg: shortEpg, streamUrl: streamUrl, baseUrl: baseUrl, b64decode: b64decode
  };
})(window);

/* tmdb.js — complète les fiches films (affiche, descriptif, âge) via l'API
 * TMDB (The Movie Database) quand le fournisseur IPTV ne les fournit pas
 * (playlists M3U, ou comptes Xtream Codes avec un catalogue peu renseigné).
 *
 * Facultatif et opt-in : n'est appelé que si une clé API TMDB est enregistrée
 * (réglage local, voir Store.getTmdbKey / l'onglet Infos). Contrairement au
 * reste de l'app, ceci envoie le titre du film à un tiers (TMDB) — documenté
 * explicitement dans l'onglet Infos. */
(function (global) {
  'use strict';

  var BASE = 'https://api.themoviedb.org/3';
  var IMG_BASE = 'https://image.tmdb.org/t/p/w500';
  var CERT_PREF = ['FR', 'US', 'GB'];

  function hasKey() { return !!global.Store.getTmdbKey(); }

  // Les catalogues IPTV ajoutent souvent l'année, la qualité ou la langue au
  // titre ("Mon Film (2021) [4K] VF") : bruit qui fait échouer la recherche.
  function cleanTitle(name) {
    return String(name || '')
      .replace(/\(\d{4}\)|\[[^\]]*\]/g, '')
      .replace(/\b(4K|HD|FHD|UHD|VOSTFR|VF|VO|MULTI)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function searchMovie(key, query) {
    var url = BASE + '/search/movie?api_key=' + encodeURIComponent(key) +
      '&language=fr-FR&query=' + encodeURIComponent(query);
    return global.Net.fetchJson(url).then(function (data) {
      return (data && data.results && data.results[0]) || null;
    });
  }

  function movieDetails(key, id) {
    var url = BASE + '/movie/' + id + '?api_key=' + encodeURIComponent(key) +
      '&language=fr-FR&append_to_response=release_dates';
    return global.Net.fetchJson(url);
  }

  function certification(details) {
    var results = details && details.release_dates && details.release_dates.results;
    if (!results) return null;
    for (var i = 0; i < CERT_PREF.length; i++) {
      var entry = results.filter(function (r) { return r.iso_3166_1 === CERT_PREF[i]; })[0];
      if (!entry) continue;
      var cert = entry.release_dates.map(function (d) { return d.certification; }).filter(Boolean)[0];
      if (cert) return cert;
    }
    return null;
  }

  function formatDuration(minutes) {
    if (!minutes) return null;
    var h = Math.floor(minutes / 60), m = minutes % 60;
    return h ? (h + 'h' + (m < 10 ? '0' : '') + m) : (m + ' min');
  }

  // Résout { cover_big, plot, age, rating, duration, genre, releasedate } ou
  // null si pas de clé configurée, pas de résultat, ou erreur réseau.
  function enrich(name) {
    var key = global.Store.getTmdbKey();
    if (!key) return Promise.resolve(null);
    var query = cleanTitle(name);
    if (!query) return Promise.resolve(null);
    return searchMovie(key, query).then(function (hit) {
      if (!hit) return null;
      return movieDetails(key, hit.id).then(function (details) {
        if (!details) return null;
        return {
          cover_big: details.poster_path ? IMG_BASE + details.poster_path : null,
          plot: details.overview || null,
          age: certification(details),
          rating: details.vote_average || null,
          duration: formatDuration(details.runtime),
          genre: (details.genres || []).map(function (g) { return g.name; }).join(', ') || null,
          releasedate: details.release_date || null
        };
      });
    }).catch(function () { return null; });
  }

  global.Tmdb = { enrich: enrich, hasKey: hasKey };
})(window);

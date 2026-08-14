/* store.js — persistance locale (localStorage pour les réglages, IndexedDB pour
 * les grosses données : texte M3U importé, listes de chaînes mises en cache).
 * Tout reste sur l'appareil : aucune donnée n'est envoyée nulle part. */
(function (global) {
  'use strict';

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function lsGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  var K_PLAYLISTS = 'iptv:playlists';
  var K_ACTIVE = 'iptv:active';
  var K_FAVORIS = 'iptv:favoris';
  var K_TMDB = 'iptv:tmdbKey';
  var K_PIN = 'iptv:parentalPin';

  function getPlaylists() { return lsGet(K_PLAYLISTS, []); }
  function savePlaylists(list) { return lsSet(K_PLAYLISTS, list); }
  function addPlaylist(p) {
    var list = getPlaylists();
    p.id = p.id || uid();
    p.creeLe = p.creeLe || Date.now();
    list.push(p);
    savePlaylists(list);
    if (!getActivePlaylistId()) setActivePlaylistId(p.id);
    return p;
  }
  function updatePlaylist(id, patch) {
    var list = getPlaylists();
    var i = list.findIndex(function (p) { return p.id === id; });
    if (i === -1) return null;
    list[i] = Object.assign({}, list[i], patch);
    savePlaylists(list);
    return list[i];
  }
  function removePlaylist(id) {
    var list = getPlaylists().filter(function (p) { return p.id !== id; });
    savePlaylists(list);
    idbDel('cache:' + id);
    if (getActivePlaylistId() === id) setActivePlaylistId(list[0] ? list[0].id : null);
  }
  function getActivePlaylistId() { return lsGet(K_ACTIVE, null); }
  function setActivePlaylistId(id) { lsSet(K_ACTIVE, id); }

  // Clé API TMDB (facultative) : n'est utilisée que pour compléter les fiches
  // films quand le fournisseur IPTV ne renseigne pas l'affiche/le descriptif/
  // l'âge — voir tmdb.js. Reste locale comme le reste des réglages.
  function getTmdbKey() { return lsGet(K_TMDB, null); }
  function setTmdbKey(key) { return lsSet(K_TMDB, key || null); }

  // Code PIN local (contrôle parental, catégories « adulte ») — stocké tel
  // quel comme le reste des réglages (rien n'est envoyé nulle part) ;
  // facultatif, aucune catégorie n'est masquée tant qu'il n'est pas défini.
  function getParentalPin() { return lsGet(K_PIN, null); }
  function setParentalPin(pin) { return lsSet(K_PIN, pin || null); }

  // Export/import de config (sauvegarde, transfert vers un autre appareil —
  // ex. le navigateur embarqué d'une Tesla, où retaper un compte Xtream au
  // clavier tactile est pénible). Le code PIN n'est volontairement jamais
  // inclus : un export peut circuler (lien, fichier) hors de cet appareil.
  function exportConfig(opts) {
    opts = opts || {};
    var cfg = { v: 1, playlists: getPlaylists() };
    if (opts.favoris !== false) cfg.favoris = getFavoris();
    if (opts.tmdbKey !== false) { var k = getTmdbKey(); if (k) cfg.tmdbKey = k; }
    return cfg;
  }
  function importConfig(cfg) {
    var added = { playlists: 0, favoris: 0, tmdbKey: false };
    (cfg.playlists || []).forEach(function (p) {
      var clean = Object.assign({}, p); delete clean.id; delete clean.creeLe;
      var dup = getPlaylists().some(function (e) {
        return e.type === clean.type &&
          (clean.type === 'm3u' ? e.m3uUrl === clean.m3uUrl : (e.serveur === clean.serveur && e.utilisateur === clean.utilisateur));
      });
      if (!dup) { addPlaylist(clean); added.playlists++; }
    });
    if (cfg.favoris && cfg.favoris.length) {
      var favoris = getFavoris();
      var keys = favoris.map(function (f) { return f.key; });
      cfg.favoris.forEach(function (f) {
        if (keys.indexOf(f.key) === -1) { favoris.push(f); keys.push(f.key); added.favoris++; }
      });
      lsSet(K_FAVORIS, favoris);
    }
    if (cfg.tmdbKey && !getTmdbKey()) { setTmdbKey(cfg.tmdbKey); added.tmdbKey = true; }
    return added;
  }

  function getFavoris() { return lsGet(K_FAVORIS, []); }
  function isFavori(key) { return getFavoris().some(function (f) { return f.key === key; }); }
  function toggleFavori(item) {
    var list = getFavoris();
    var i = list.findIndex(function (f) { return f.key === item.key; });
    if (i === -1) { list.push(item); } else { list.splice(i, 1); }
    lsSet(K_FAVORIS, list);
    return i === -1; // true si on vient d'ajouter
  }

  // ---------- IndexedDB : cache des playlists chargées (peut être volumineux) ----------
  var DB_NAME = 'iptv-lecteur';
  var STORE = 'cache';
  var dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in global)) { reject(new Error('IndexedDB indisponible')); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }
  function idbSet(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () { return false; });
  }
  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }).catch(function () { return undefined; });
  }
  function idbDel(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  global.Store = {
    uid: uid,
    getPlaylists: getPlaylists, addPlaylist: addPlaylist,
    updatePlaylist: updatePlaylist, removePlaylist: removePlaylist,
    getActivePlaylistId: getActivePlaylistId, setActivePlaylistId: setActivePlaylistId,
    getTmdbKey: getTmdbKey, setTmdbKey: setTmdbKey,
    getParentalPin: getParentalPin, setParentalPin: setParentalPin,
    getFavoris: getFavoris, isFavori: isFavori, toggleFavori: toggleFavori,
    exportConfig: exportConfig, importConfig: importConfig,
    cacheGet: function (playlistId) { return idbGet('cache:' + playlistId); },
    cacheSet: function (playlistId, data) { return idbSet('cache:' + playlistId, data); },
    rawGet: function (playlistId) { return idbGet('raw:' + playlistId); },
    rawSet: function (playlistId, text) { return idbSet('raw:' + playlistId, text); }
  };
})(window);

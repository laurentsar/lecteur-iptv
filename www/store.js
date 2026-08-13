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
    getFavoris: getFavoris, isFavori: isFavori, toggleFavori: toggleFavori,
    cacheGet: function (playlistId) { return idbGet('cache:' + playlistId); },
    cacheSet: function (playlistId, data) { return idbSet('cache:' + playlistId, data); },
    rawGet: function (playlistId) { return idbGet('raw:' + playlistId); },
    rawSet: function (playlistId, text) { return idbSet('raw:' + playlistId, text); }
  };
})(window);

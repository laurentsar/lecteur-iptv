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
    try {
      var brut = JSON.stringify(value);
      localStorage.setItem(key, brut);
      memo[key] = value;
      if (key === K_FAVORIS) favKeysMemo = null;
      miroirEcrire(key, brut);
      return true;
    }
    catch (e) { return false; }
  }

  // ---------- Mémo des lectures très répétées ----------
  // isFavori() est appelé une fois PAR CARTE d'une grille, et getProgress()
  // une fois par carte de film : sans mémo, afficher un écran de 60 cartes
  // déclenchait une centaine de localStorage.getItem + JSON.parse de listes
  // entières (jusqu'à 300 entrées pour la reprise de lecture) — refaits
  // intégralement à chaque frappe dans un champ de recherche.
  // Le mémo n'est correct que parce que TOUTE écriture de ces clés passe par
  // lsSet() (qui le remet à jour) ou par hydrate() (qui le vide) : rien
  // d'autre n'écrit dans localStorage sur ces clés-là. Les valeurs mémorisées
  // sont en lecture seule : les fonctions qui modifient une liste repartent
  // d'une relecture fraîche (getFavoris/getPlaylists) puis appellent lsSet.
  var memo = {};
  var favKeysMemo = null;
  function memoGet(key, fallback) {
    if (!(key in memo)) memo[key] = lsGet(key, fallback);
    return memo[key];
  }
  function memoVider() { memo = {}; favKeysMemo = null; }

  var K_PLAYLISTS = 'iptv:playlists';
  var K_ACTIVE = 'iptv:active';
  var K_FAVORIS = 'iptv:favoris';
  var K_TMDB = 'iptv:tmdbKey';
  var K_PIN = 'iptv:parentalPin';
  // Lecteur utilisé dans l'APK : natif (Media3/ExoPlayer, hors WebView) par
  // défaut, décochable pour revenir au lecteur web. Sans effet en PWA, où le
  // lecteur natif n'existe pas.
  var K_NATIF = 'iptv:lecteurNatif';
  // Guide : n'afficher que les chaînes pour lesquelles la source EPG a
  // réellement des programmes (cas courant : un bouquet de plusieurs
  // milliers de chaînes dont seules quelques centaines sont guidées).
  var K_GUIDE_EPG = 'iptv:guideAvecProgramme';
  // Affichage « TV » : caractères et cibles agrandis pour une lecture à
  // plusieurs mètres (voir body.tv dans styles.css).
  var K_MODE_TV = 'iptv:modeTv';
  // Filtre lumière bleue (confort visuel en soirée) : superposition teintée
  // ambre sur toute l'appli, voir body.filtre-nuit dans styles.css.
  var K_FILTRE_NUIT = 'iptv:filtreNuit';

  // ---------- Miroir natif (Capacitor Preferences) ----------
  // Symptôme corrigé ici : les playlists disparaissaient à chaque mise à jour
  // de l'APK. Une réinstallation « par-dessus » conserve pourtant le dossier
  // de données de l'app — mais le stockage du WebView (localStorage,
  // IndexedDB) n'appartient pas à l'app : il est géré par le WebView système,
  // qui peut le réinitialiser pour son propre compte (mise à jour du WebView
  // ou de Chrome, changement de profil, nettoyage de stockage Android). Rien
  // ne le protège côté app.
  //
  // Les Preferences Capacitor, elles, sont des SharedPreferences Android :
  // un fichier XML dans le dossier de l'app, indépendant du WebView. On y
  // recopie donc les CLÉS LÉGÈRES (playlists, favoris, réglages — pas les
  // caches de chaînes, trop volumineux et reconstructibles), et on rehydrate
  // le localStorage au démarrage quand il revient vide.
  var MIROIR = [K_PLAYLISTS, K_ACTIVE, K_FAVORIS, K_TMDB, K_PIN, K_NATIF, K_GUIDE_EPG, K_MODE_TV];
  var PREFIXE_MIROIR = 'mirror:';

  function prefsPlugin() {
    return global.Capacitor && global.Capacitor.Plugins &&
      global.Capacitor.Plugins.Preferences;
  }
  // Une valeur « vide » ne doit jamais écraser une valeur pleine, dans un sens
  // comme dans l'autre : c'est la seule garde qui empêche une restauration
  // ratée d'effacer ce qui restait.
  function estVide(brut) {
    return brut == null || brut === '' || brut === 'null' ||
      brut === '[]' || brut === '{}';
  }
  function miroirEcrire(key, brut) {
    var P = prefsPlugin();
    if (!P || MIROIR.indexOf(key) === -1) return;
    try { P.set({ key: PREFIXE_MIROIR + key, value: String(brut) }); } catch (e) {}
  }
  // Appelée avant le premier rendu (app.js) : renvoie le nombre de clés
  // effectivement restaurées. Sur le web, sans plugin natif, ne fait rien.
  function hydrate() {
    var P = prefsPlugin();
    if (!P) return Promise.resolve(0);
    return Promise.all(MIROIR.map(function (k) {
      var local = null;
      try { local = localStorage.getItem(k); } catch (e) {}
      if (!estVide(local)) {                       // le local fait foi
        return P.set({ key: PREFIXE_MIROIR + k, value: local })
          .then(function () { return 0; }, function () { return 0; });
      }
      return P.get({ key: PREFIXE_MIROIR + k }).then(function (r) {
        var v = r && r.value;
        if (estVide(v)) return 0;
        try { localStorage.setItem(k, v); } catch (e) { return 0; }
        return 1;
      }, function () { return 0; });
    })).then(function (n) {
      memoVider();   // hydrate() écrit localStorage sans passer par lsSet()
      return n.reduce(function (a, b) { return a + b; }, 0);
    });
  }

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

  // Par défaut à vrai : le lecteur natif décode ce que la WebView refuse
  // (HEVC, audio AC3/E-AC3/DTS) et tient mieux la charge sur un boîtier TV.
  function getLecteurNatif() { return lsGet(K_NATIF, true) !== false; }
  function setLecteurNatif(actif) { return lsSet(K_NATIF, !!actif); }

  function getModeTv() { return lsGet(K_MODE_TV, false) === true; }
  function setModeTv(actif) { return lsSet(K_MODE_TV, !!actif); }

  function getFiltreNuit() { return lsGet(K_FILTRE_NUIT, false) === true; }
  function setFiltreNuit(actif) { return lsSet(K_FILTRE_NUIT, !!actif); }

  function getGuideAvecProgramme() { return lsGet(K_GUIDE_EPG, true) !== false; }
  function setGuideAvecProgramme(actif) { return lsSet(K_GUIDE_EPG, !!actif); }

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
  // Remplace toute la liste d'un coup — utilisé par la synchronisation Home
  // Assistant (hasync.js), qui fusionne local et distant avant d'écrire.
  function setFavoris(list) { lsSet(K_FAVORIS, list || []); }
  function isFavori(key) {
    if (!favKeysMemo) {
      favKeysMemo = {};
      getFavoris().forEach(function (f) { if (f && f.key) favKeysMemo[f.key] = true; });
    }
    return !!favKeysMemo[key];
  }
  function toggleFavori(item) {
    var list = getFavoris();
    var i = list.findIndex(function (f) { return f.key === item.key; });
    if (i === -1) { list.push(item); } else { list.splice(i, 1); }
    lsSet(K_FAVORIS, list);
    return i === -1; // true si on vient d'ajouter
  }

  // ---------- Reprise de lecture (films/séries) — position mémorisée par URL
  // de flux. Purge les entrées les plus anciennes au-delà de PROGRESS_MAX
  // pour ne pas laisser grossir indéfiniment le localStorage.
  var K_PROGRESS = 'iptv:progress';
  var PROGRESS_MAX = 300;
  function getProgressMap() { return memoGet(K_PROGRESS, {}); }
  function getProgress(url) { return getProgressMap()[url] || null; }
  function setProgress(url, data) {
    var map = getProgressMap();
    map[url] = Object.assign({}, data, { updatedAt: Date.now() });
    var keys = Object.keys(map);
    if (keys.length > PROGRESS_MAX) {
      keys.sort(function (a, b) { return map[a].updatedAt - map[b].updatedAt; });
      keys.slice(0, keys.length - PROGRESS_MAX).forEach(function (k) { delete map[k]; });
    }
    lsSet(K_PROGRESS, map);
  }
  // Lectures en cours, de la plus récente à la plus ancienne — pour la section
  // « Reprendre » de l'accueil. Les entrées à peine commencées ou quasiment
  // terminées sont écartées : les proposer n'a pas de sens (mêmes seuils que
  // la barre de progression des vignettes).
  function getEnCours(max) {
    var map = getProgressMap();
    return Object.keys(map)
      .map(function (url) { return Object.assign({ url: url }, map[url]); })
      .filter(function (e) {
        if (!e.duration || !e.position) return false;
        var r = e.position / e.duration;
        return r > 0.03 && r < 0.95;
      })
      .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })
      .slice(0, max || 12);
  }

  function clearProgress(url) {
    var map = getProgressMap();
    if (url in map) { delete map[url]; lsSet(K_PROGRESS, map); }
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

  // ---------- Cache du guide TV (EPG) ----------
  // Un XMLTV de panel IPTV pèse couramment plusieurs dizaines de mégaoctets :
  // le retélécharger ET le réanalyser à chaque lancement coûte, sur un boîtier
  // TV, de longues secondes pendant lesquelles le Guide reste vide. La carte
  // déjà analysée est donc conservée dans IndexedDB (structure de données
  // simple, clonable telle quelle) et rechargée au démarrage suivant tant
  // qu'elle n'a pas dépassé EPG_TTL_MS — ce qui rend aussi le Guide
  // consultable hors ligne, ou quand la source EPG est momentanément morte.
  // La clé inclut l'URL : changer de playlist (donc de source) invalide.
  var EPG_TTL_MS = 6 * 3600 * 1000;
  function epgGet(url) {
    if (!url) return Promise.resolve(null);
    return idbGet('epg:' + url).then(function (rec) {
      if (!rec || !rec.map || !rec.at) return null;
      if (Date.now() - rec.at > EPG_TTL_MS) return null;
      return rec.map;
    });
  }
  function epgSet(url, map) {
    if (!url || !map) return Promise.resolve(false);
    return idbSet('epg:' + url, { at: Date.now(), map: map });
  }

  global.Store = {
    uid: uid, hydrate: hydrate,
    epgGet: epgGet, epgSet: epgSet,
    getPlaylists: getPlaylists, addPlaylist: addPlaylist,
    updatePlaylist: updatePlaylist, removePlaylist: removePlaylist,
    getActivePlaylistId: getActivePlaylistId, setActivePlaylistId: setActivePlaylistId,
    getTmdbKey: getTmdbKey, setTmdbKey: setTmdbKey,
    getParentalPin: getParentalPin, setParentalPin: setParentalPin,
    getLecteurNatif: getLecteurNatif, setLecteurNatif: setLecteurNatif,
    getGuideAvecProgramme: getGuideAvecProgramme, setGuideAvecProgramme: setGuideAvecProgramme,
    getModeTv: getModeTv, setModeTv: setModeTv,
    getFiltreNuit: getFiltreNuit, setFiltreNuit: setFiltreNuit,
    getFavoris: getFavoris, setFavoris: setFavoris, isFavori: isFavori, toggleFavori: toggleFavori,
    getProgress: getProgress, setProgress: setProgress, clearProgress: clearProgress,
    getEnCours: getEnCours,
    exportConfig: exportConfig, importConfig: importConfig,
    cacheGet: function (playlistId) { return idbGet('cache:' + playlistId); },
    cacheSet: function (playlistId, data) { return idbSet('cache:' + playlistId, data); },
    rawGet: function (playlistId) { return idbGet('raw:' + playlistId); },
    rawSet: function (playlistId, text) { return idbSet('raw:' + playlistId, text); }
  };
})(window);

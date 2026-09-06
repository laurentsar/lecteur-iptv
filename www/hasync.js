/* hasync.js — synchronisation des favoris entre appareils via Home Assistant.
 *
 * Les favoris vivent dans le localStorage de chaque installation : téléphone,
 * TV du salon et Freebox Player en avaient trois listes indépendantes. Plutôt
 * qu'un service cloud de plus, on se sert de HA, déjà présent à la maison :
 * l'app écrit et relit un état (`sensor.lecteur_iptv_favoris`) par l'API REST.
 *
 * Fusion, pas écrasement : chaque appareil compare l'état distant à ce qu'il a
 * envoyé la dernière fois (l'« instantané »). Ce qui a été ajouté localement
 * depuis est poussé ; ce qui a été retiré localement devient une pierre
 * tombale datée, pour qu'une suppression ne soit pas ressuscitée par le
 * premier appareil qui se synchronise. La date la plus récente gagne.
 *
 * LIMITE : un état posé par /api/states n'est pas persistant côté HA, il
 * disparaît à son redémarrage. Sans conséquence ici : chaque appareil garde sa
 * copie locale et la republie à la synchronisation suivante.
 *
 * CORS : sur l'APK, les requêtes passent par CapacitorHttp (réseau natif, hors
 * navigateur). Sur la PWA, HA doit autoriser l'origine
 * (http: cors_allowed_origins dans configuration.yaml).
 */
(function (global) {
  'use strict';

  var ENTITY = 'sensor.lecteur_iptv_favoris';
  var CFG_KEY = 'iptv:hasync';          // { url, token, on }
  var SNAP_KEY = 'iptv:hasync:snapshot'; // { keys: [], at: ms }
  var TOMB_KEY = 'iptv:hasync:tombes';   // { key: ts }
  var PERIODE_MS = 60000;
  var TOMBE_MAX_MS = 90 * 24 * 3600 * 1000; // au-delà, la suppression est oubliée

  function lsGet(k, def) {
    try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); }
    catch (e) { return def; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function cfg() { return lsGet(CFG_KEY, { url: '', token: '', on: false }); }
  function setCfg(c) { lsSet(CFG_KEY, c); }
  function actif() { var c = cfg(); return !!(c.on && c.url && c.token); }

  function nativeHttp() {
    var cap = global.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
    return (cap.Plugins && cap.Plugins.CapacitorHttp) || null;
  }

  function requete(methode, corps) {
    var c = cfg();
    var base = String(c.url || '').replace(/\/+$/, '');
    var url = base + '/api/states/' + ENTITY;
    var headers = { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' };
    var http = nativeHttp();
    if (http) {
      return http.request({
        url: url, method: methode, headers: headers,
        data: corps || undefined, responseType: 'json'
      }).then(function (res) {
        if (res.status === 404) return null;      // entité pas encore créée
        if (res.status < 200 || res.status >= 300) throw new Error('HTTP ' + res.status);
        return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      });
    }
    return fetch(url, {
      method: methode, headers: headers,
      body: corps ? JSON.stringify(corps) : undefined
    }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function maintenant() { return Date.now(); }

  function parCle(list) {
    var m = {};
    (list || []).forEach(function (f) { if (f && f.key) m[f.key] = f; });
    return m;
  }

  function purgerTombes(t) {
    var limite = maintenant() - TOMBE_MAX_MS, out = {};
    Object.keys(t || {}).forEach(function (k) { if (t[k] > limite) out[k] = t[k]; });
    return out;
  }

  // Cœur de la fusion. Renvoie { favoris, tombes, change } où `change` dit si
  // la liste locale a bougé (l'appelant rafraîchit alors l'affichage).
  function fusion(local, distant) {
    var maintenantMs = maintenant();
    var snap = lsGet(SNAP_KEY, { keys: [] });
    var snapKeys = snap.keys || [];
    var tombes = purgerTombes(lsGet(TOMB_KEY, {}));

    var locauxParCle = parCle(local);
    var distantsParCle = parCle(distant && distant.items);
    var tombesDistantes = purgerTombes((distant && distant.tombes) || {});

    // Ce que CET appareil a fait depuis sa dernière synchro.
    Object.keys(locauxParCle).forEach(function (k) {
      if (snapKeys.indexOf(k) === -1 && !locauxParCle[k].ts) locauxParCle[k].ts = maintenantMs;
    });
    snapKeys.forEach(function (k) {
      if (!locauxParCle[k] && !tombes[k]) tombes[k] = maintenantMs; // retiré ici
    });
    Object.keys(tombesDistantes).forEach(function (k) {
      if (!tombes[k] || tombesDistantes[k] > tombes[k]) tombes[k] = tombesDistantes[k];
    });

    // Union des deux côtés, puis suppressions plus récentes que l'ajout.
    var fusionnes = {};
    Object.keys(distantsParCle).forEach(function (k) { fusionnes[k] = distantsParCle[k]; });
    Object.keys(locauxParCle).forEach(function (k) {
      var a = fusionnes[k], b = locauxParCle[k];
      if (!a || (b.ts || 0) >= (a.ts || 0)) fusionnes[k] = b;
    });
    Object.keys(tombes).forEach(function (k) {
      var item = fusionnes[k];
      if (item && (item.ts || 0) > tombes[k]) return; // ré-ajouté après coup
      delete fusionnes[k];
    });

    var liste = Object.keys(fusionnes).map(function (k) { return fusionnes[k]; });
    var avant = Object.keys(locauxParCle).filter(function (k) { return !tombes[k] || (locauxParCle[k].ts || 0) > tombes[k]; }).sort().join('|');
    var apres = liste.map(function (f) { return f.key; }).sort().join('|');
    return { favoris: liste, tombes: tombes, change: avant !== apres };
  }

  var enCours = false;
  var dernierEtat = '';

  function sync(silencieux) {
    if (!actif() || enCours || !global.Store) return Promise.resolve(false);
    enCours = true;
    return requete('GET').then(function (etat) {
      var distant = etat && etat.attributes ? etat.attributes : null;
      var r = fusion(Store.getFavoris(), distant);
      Store.setFavoris(r.favoris);
      lsSet(TOMB_KEY, r.tombes);
      lsSet(SNAP_KEY, { keys: r.favoris.map(function (f) { return f.key; }), at: maintenant() });
      return requete('POST', {
        state: String(r.favoris.length),
        attributes: {
          friendly_name: 'Lecteur IPTV — favoris',
          icon: 'mdi:star',
          items: r.favoris,
          tombes: r.tombes,
          maj: new Date().toISOString()
        }
      }).then(function () {
        dernierEtat = 'Synchronisé — ' + r.favoris.length + ' favori(s), ' +
          new Date().toLocaleTimeString('fr-FR');
        if (r.change && global.AppFavoris) global.AppFavoris.refresh();
        return r.change;
      });
    }).catch(function (err) {
      dernierEtat = 'Échec : ' + (err && err.message ? err.message : err);
      if (!silencieux && global.AppToast) global.AppToast('Synchro HA impossible — ' + dernierEtat);
      return false;
    }).then(function (v) { enCours = false; majStatut(); return v; });
  }

  function majStatut() {
    var el = document.getElementById('haSyncStatut');
    if (el) el.textContent = dernierEtat || (actif() ? 'Prêt.' : 'Désactivée.');
  }

  // ---------- panneau de réglages ----------
  function mount(el) {
    if (!el) return;
    var c = cfg();
    el.innerHTML = '';
    var grille = document.createElement('div');
    grille.className = 'grid2';
    grille.innerHTML =
      '<label>URL de Home Assistant' +
      '  <input type="text" id="haSyncUrl" placeholder="http://192.168.1.172:8123" />' +
      '</label>' +
      '<label>Jeton d\'accès longue durée' +
      '  <input type="password" id="haSyncToken" placeholder="collé depuis ton profil HA" autocomplete="off" />' +
      '</label>';
    el.appendChild(grille);

    var ligne = document.createElement('div');
    ligne.className = 'row';
    ligne.innerHTML =
      '<label class="hint"><input type="checkbox" id="haSyncOn" /> Synchroniser les favoris</label>' +
      '<button id="haSyncNow" class="ghost">Synchroniser maintenant</button>';
    el.appendChild(ligne);

    var statut = document.createElement('p');
    statut.className = 'hint';
    statut.id = 'haSyncStatut';
    el.appendChild(statut);

    document.getElementById('haSyncUrl').value = c.url || '';
    document.getElementById('haSyncToken').value = c.token || '';
    document.getElementById('haSyncOn').checked = !!c.on;

    function enregistrer() {
      setCfg({
        url: document.getElementById('haSyncUrl').value.trim(),
        token: document.getElementById('haSyncToken').value.trim(),
        on: document.getElementById('haSyncOn').checked
      });
      majStatut();
    }
    ['haSyncUrl', 'haSyncToken'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', enregistrer);
    });
    document.getElementById('haSyncOn').addEventListener('change', function () { enregistrer(); sync(); });
    document.getElementById('haSyncNow').addEventListener('click', function () { enregistrer(); sync(); });
    majStatut();
  }

  function start() {
    if (!actif()) return;
    sync(true);
    setInterval(function () { if (!document.hidden) sync(true); }, PERIODE_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(true); });
  }

  global.HaSync = { mount: mount, sync: sync, start: start, actif: actif };
})(window);

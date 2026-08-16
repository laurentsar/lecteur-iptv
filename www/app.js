/* app.js — interface du Lecteur IPTV : onglets, playlists, grilles de
 * chaînes/films/séries, favoris, lecture. Toutes les données (playlists,
 * identifiants, favoris) restent en local (localStorage / IndexedDB). */
(function () {
  'use strict';

  var PAGE_SIZE = 60;
  var GUIDE_PAGE = 25;
  var PX_PER_MIN = 2; // échelle de l'agenda : 1h = 120px, 24h = 2880px
  var DAY_MS = 86400000;

  var state = {
    playlist: null,
    m3uData: null,        // { epgUrl, items }
    epgMap: null,          // XMLTV : { channelId: [{start,stop,titre}] }
    epgLoading: false,
    epgError: null,        // message si le chargement du guide TV a échoué (voir kickEpg), affiché dans l'onglet Guide
    epgFailedUrl: null,    // dernière URL EPG en échec, pour ne pas la retenter à chaque rendu du Guide
    epgDebug: null,        // { url, channelCount } — diagnostic affiché dans le Guide (chargement réussi mais sans correspondance)
    xtreamCats: { direct: null, films: null, series: null }, // [{id,label}]
    activeCategory: { direct: '', films: '', series: '' },
    shown: { direct: PAGE_SIZE, films: PAGE_SIZE, series: PAGE_SIZE, guide: GUIDE_PAGE, radio: PAGE_SIZE },
    xtreamItems: { direct: null, films: null, series: null }, // chargés à la demande par catégorie
    directView: 'bouquets',   // 'liste' | 'bouquets'
    guideDayOffset: 0,
    unlockedAdult: {}, // catégories « adulte » déverrouillées cette session (code PIN) — remis à zéro à chaque lancement de l'app
    zapList: [], // chaînes en direct actuellement listées (Direct + Guide) — pour le swipe/télécommande de zapping dans le lecteur
    searchCache: {}, // pools chargés pour la recherche universelle (Accueil), par kindKey — voir searchPool()
    xtreamAllDirectCache: null, // Promise mémorisée du fetch « toutes les chaînes » (Xtream), voir ensureAllDirectItems()
    bouquetsAllCountries: false // vue Bouquets : false = seulement les bouquets français par défaut (voir renderBouquetTiles)
  };

  // Liste consultée par player.js pour zapper à la chaîne suivante/précédente
  // (swipe, télécommande virtuelle, numéro de chaîne) : mise à jour à chaque
  // rendu d'une liste de chaînes en direct, dans l'ordre affiché.
  function setZapList(items) {
    state.zapList = items
      .filter(function (it) { return it.url && !looksLikeSeparator(it.name); })
      .map(function (it) { return { url: it.url, name: it.name, epgKey: it.epgKey || null, logo: it.logo || null, chno: it.chno || '' }; });
  }
  // Chaînes favorites (direct uniquement), pour la section « Favoris » de la
  // télécommande virtuelle du lecteur — toujours disponible via Store, même
  // si l'onglet Direct/Guide n'a pas encore été ouvert cette session.
  function zapFavoris() {
    return Store.getFavoris()
      .filter(function (f) { return (f.kind === 'direct' || f.kind === 'live') && !isHiddenChannel(f.name); })
      .map(function (f) { return { url: f.url, name: f.name, logo: f.logo || null }; });
  }
  window.AppZap = {
    list: function () { return state.zapList; },
    favoris: zapFavoris,
    epgNow: function (epgKey, name) { return (epgKey || name) ? Epg.nowNext(state.epgMap, epgKey, name) : null; },
    byNumber: function (num) {
      num = String(num).replace(/^0+(?=\d)/, '');
      return state.zapList.filter(function (it) { return it.chno; })
        .find(function (it) { return String(it.chno).replace(/^0+(?=\d)/, '') === num; }) || null;
    }
  };

  // ---------- utilitaires ----------
  function $(sel) { return document.querySelector(sel); }
  function $id(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // Rend un <div> cliquable navigable au clavier/D-pad (télécommande TV) :
  // un <div> n'entre pas dans l'ordre de tabulation par défaut, contrairement
  // à <button>. Entrée/Espace déclenchent le clic, comme un vrai bouton.
  function makeFocusable(node) {
    node.tabIndex = 0;
    node.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        node.click();
      }
    });
    return node;
  }
  var toastTimer;
  function toast(msg) {
    var t = $id('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  // ---------- onglets ----------
  function goTab(name) {
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + name); });
    if (name === 'accueil') renderAccueil();
    else if (name === 'direct') renderKind('direct');
    else if (name === 'films') { $id('filmDetail').style.display = 'none'; $id('filmsRacine').style.display = ''; renderKind('films'); }
    else if (name === 'series') { $id('serieDetail').style.display = 'none'; $id('seriesRacine').style.display = ''; renderKind('series'); }
    else if (name === 'guide') renderGuide(true);
    else if (name === 'radio') renderRadio();
    else if (name === 'maliste') { renderFavoris(); renderEnregistrements(); }
    else if (name === 'reglages') renderPlaylists();
  }
  document.getElementById('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (b) goTab(b.dataset.tab);
  });
  window.AppNav = { goHome: function () { goTab('accueil'); } };

  // Touche « Maison » (clavier physique/Bluetooth, ou télécommande TV quand
  // le navigateur/WebView la reçoit encore comme un évènement clavier — le
  // vrai bouton HOME Android est intercepté par le système avant l'appli et
  // ne peut pas être capté ici) : ramène directement à l'onglet Accueil,
  // comme le bouton 🏠 du lecteur.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Home') return;
    if (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (window.Player) Player.close();
    goTab('accueil');
  });

  // Bouton « retour » matériel — téléphone (bouton/geste système Android)
  // ou télécommande (touche Retour), les deux envoient le même évènement
  // système KEYCODE_BACK côté Android, relayé ici par le plugin Capacitor
  // « App » (contrairement à Maison ci-dessus, jamais reçu comme un simple
  // évènement clavier) : ferme d'abord le lecteur ou le détail ouvert,
  // sinon revient à l'onglet Accueil, sinon quitte l'appli.
  // Ordre du plus « au-dessus » au plus « en dessous » : chaque étape ne
  // referme QUE l'élément le plus haut actuellement visible, jamais deux
  // d'un coup — un retour = un pas en arrière, jamais un saut qui
  // surprend l'utilisateur. Chaque cas est vérifié par sa propre
  // condition de visibilité plutôt que supposé à partir d'un autre état,
  // pour rester correct même si plusieurs éléments se retrouvaient
  // ouverts en même temps.
  function goBack() {
    var confirmModal = $id('confirmModal');
    if (confirmModal && confirmModal.style.display !== 'none') { closeConfirmModal(false); return; }
    var pinModal = $id('pinModal');
    if (pinModal && pinModal.style.display !== 'none') { closePinModal(false); return; }
    var versionPicker = $id('versionPicker');
    if (versionPicker && versionPicker.style.display !== 'none') { hideVersionPicker(); return; }
    if (window.Player && Player.isOpen && Player.isOpen()) {
      // Sous-panneaux internes au lecteur (télécommande, menu Sources/
      // Qualité/Audio/Sous-titres) : un premier retour les referme sans
      // quitter la lecture, un second ferme le lecteur lui-même.
      if (Player.closeTopOverlay && Player.closeTopOverlay()) return;
      Player.close();
      return;
    }
    var filmDetail = $id('filmDetail');
    if (filmDetail && filmDetail.style.display !== 'none') { filmDetail.style.display = 'none'; $id('filmsRacine').style.display = ''; return; }
    var serieDetail = $id('serieDetail');
    if (serieDetail && serieDetail.style.display !== 'none') { serieDetail.style.display = 'none'; $id('seriesRacine').style.display = ''; return; }
    var activeTab = document.querySelector('.tab.active');
    // Depuis la liste des chaînes d'un bouquet (onglet Direct), un premier
    // retour ramène à la grille des bouquets — l'étape de navigation
    // intermédiaire équivalente aux fiches film/série ci-dessus — avant de
    // quitter l'onglet au retour suivant.
    if (activeTab && activeTab.dataset.tab === 'direct' && state.directView === 'liste') { switchDirectView('bouquets'); return; }
    if (activeTab && activeTab.dataset.tab !== 'accueil') { goTab('accueil'); return; }
    if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App && Capacitor.Plugins.App.exitApp) Capacitor.Plugins.App.exitApp();
  }
  if (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.Plugins && Capacitor.Plugins.App) {
    Capacitor.Plugins.App.addListener('backButton', goBack);
  }

  // ---------- chargement de la playlist active ----------
  function xtreamCfg(pl) { return { serveur: pl.serveur, utilisateur: pl.utilisateur, motDePasse: pl.motDePasse }; }

  function setActivePlaylist(id) {
    Store.setActivePlaylistId(id);
    state.playlist = Store.getPlaylists().find(function (p) { return p.id === id; }) || null;
    state.m3uData = null; state.epgMap = null; state.epgLoading = false; state.epgError = null; state.epgFailedUrl = null; state.epgDebug = null;
    state.xtreamCats = { direct: null, films: null, series: null };
    state.xtreamItems = { direct: null, films: null, series: null };
    state.activeCategory = { direct: '', films: '', series: '' };
    state.shown = { direct: PAGE_SIZE, films: PAGE_SIZE, series: PAGE_SIZE, guide: GUIDE_PAGE, radio: PAGE_SIZE };
    state.guideDayOffset = 0;
    state.searchCache = {};
    state.xtreamAllDirectCache = null;
    state.bouquetsAllCountries = false;
    updateHeader();
  }

  // Recharge la playlist active depuis le fournisseur : pour le M3U, le
  // fichier n'est sinon jamais re-téléchargé après le premier ajout (mis en
  // cache indéfiniment) ; pour le Xtream, les catégories/chaînes ne sont
  // gardées qu'en mémoire le temps de la session, donc vider ce cache
  // suffit à forcer un nouvel appel au serveur au prochain affichage.
  function refreshActivePlaylist() {
    var pl = state.playlist;
    if (!pl) return;
    toast('Actualisation…');
    var afterRefresh = function () {
      state.xtreamCats = { direct: null, films: null, series: null };
      state.xtreamItems = { direct: null, films: null, series: null };
      state.searchCache = {};
      state.xtreamAllDirectCache = null;
      state.shown = { direct: PAGE_SIZE, films: PAGE_SIZE, series: PAGE_SIZE, guide: GUIDE_PAGE, radio: PAGE_SIZE };
      renderAccueil();
      toast('Playlist actualisée');
    };
    if (pl.type === 'm3u') {
      ensureM3uLoaded(true).then(afterRefresh).catch(function (err) { toast('Erreur : ' + err.message); });
    } else {
      afterRefresh();
    }
  }

  // Comme refreshActivePlaylist, mais silencieux et déclenché tout seul à
  // l'ouverture de l'appli : le Xtream est de toute façon déjà rechargé à
  // chaque démarrage (state.xtreamCats/Items repartent à zéro dans
  // setActivePlaylist), seul le M3U reste en cache indéfiniment sans ce
  // rafraîchissement automatique. Se fait en tâche de fond, sans bloquer
  // l'affichage initial (qui utilise le cache existant) ; si l'onglet
  // concerné est déjà ouvert quand les données fraîches arrivent, on le
  // re-affiche pour qu'elles apparaissent sans action de l'utilisateur.
  function refreshOnOpen() {
    var pl = state.playlist;
    if (!pl || pl.type !== 'm3u') return;
    ensureM3uLoaded(true).then(function () {
      state.searchCache = {};
      if (isTabActive('direct')) renderKind('direct');
      else if (isTabActive('films')) renderKind('films');
      else if (isTabActive('series')) renderKind('series');
      else if (isTabActive('radio')) renderRadio();
      else if (isTabActive('guide')) renderGuide(false);
    }).catch(function () {}); // échec silencieux : on garde les données déjà affichées
  }

  function updateHeader() {
    $id('activePlaylistLabel').textContent = state.playlist
      ? state.playlist.nom + ' · ' + (state.playlist.type === 'xtream' ? 'Xtream Codes' : 'M3U')
      : 'Aucune playlist';
  }

  function ensureM3uLoaded(force) {
    var pl = state.playlist;
    if (!pl || pl.type !== 'm3u') return Promise.resolve(null);
    if (state.m3uData && !force) return Promise.resolve(state.m3uData);
    var got = force ? Promise.resolve(null) : Store.cacheGet(pl.id);
    return got.then(function (cached) {
      if (cached && !force) { state.m3uData = cached; kickEpg(); return cached; }
      var textPromise = pl.m3uUpload
        ? Store.rawGet(pl.id).then(function (t) { if (!t) throw new Error('Fichier introuvable — réimporte la playlist.'); return t; })
        : Net.fetchText(pl.m3uUrl);
      return textPromise.then(function (text) {
        var parsed = M3U.parse(text);
        var data = { epgUrl: parsed.epgUrl || pl.epgUrl || null, items: parsed.items, fetchedAt: Date.now() };
        state.m3uData = data;
        Store.cacheSet(pl.id, data);
        kickEpg();
        return data;
      });
    });
  }

  // Source EPG : XMLTV déclaré par la playlist M3U (url-tvg), ou export
  // XMLTV standard des panels Xtream Codes (xmltv.php) — une seule requête
  // couvrant toutes les chaînes, indexée par id de chaîne (= stream_id pour
  // Xtream, selon la convention standard de ces panels).
  function kickEpg() {
    var pl = state.playlist;
    if (!pl || state.epgMap || state.epgLoading) return;
    var url = pl.type === 'm3u'
      // state.m3uData peut encore être vide à ce stade (kickEpg est appelé
      // au tout début de renderGuide(), avant même que ensureM3uLoaded()
      // n'ait fini de parser la playlist) : dans ce cas rien à faire ici,
      // ensureM3uLoaded() rappelle kickEpg() lui-même une fois les données
      // (et l'éventuelle URL EPG déclarée en tête de M3U) disponibles.
      ? ((state.m3uData && state.m3uData.epgUrl) || pl.epgUrl)
      : Xtream.xmltvUrl(xtreamCfg(pl));
    if (!url) {
      state.epgError = (pl.type === 'm3u' && !state.m3uData) ? null // pas encore su, pas la peine d'inquiéter pour rien
        : pl.type === 'm3u' ? 'Aucune URL de guide TV (EPG) trouvée — ni dans la playlist, ni renseignée dans Réglages.'
        : 'Guide TV indisponible sur ce compte Xtream.';
      return;
    }
    // Une URL déjà tentée et en échec n'est pas retentée à chaque rendu
    // (renderGuide() appelle kickEpg() à chaque affichage, et le
    // gestionnaire d'échec ci-dessous rappelle lui-même renderGuide() pour
    // afficher le message) — seulement si l'URL change réellement.
    if (state.epgFailedUrl === url) return;
    state.epgLoading = true;
    state.epgError = null;
    // Filet de sécurité : sans délai maximum, un serveur EPG qui ne répond
    // jamais (fréquent chez certains fournisseurs IPTV) laisse epgLoading
    // bloqué à true pour toujours — la garde en tête de fonction
    // ci-dessus court-circuite alors silencieusement tous les appels
    // suivants, sans jamais afficher ni erreur ni diagnostic (le guide
    // reste vide sans aucune explication visible).
    var EPG_TIMEOUT_MS = 15000;
    var timedOut = false;
    var timeoutId = setTimeout(function () {
      timedOut = true;
      state.epgLoading = false;
      state.epgFailedUrl = url;
      state.epgError = 'Chargement du guide TV impossible : le serveur ne répond pas (délai dépassé).';
      if (isTabActive('guide')) renderGuide(false);
    }, EPG_TIMEOUT_MS);
    Epg.fetchXmltv(url).then(function (map) {
      if (timedOut) return; // réponse arrivée après coup — l'échec par délai a déjà été traité
      clearTimeout(timeoutId);
      state.epgMap = map; state.epgLoading = false; state.epgFailedUrl = null;
      // Diagnostic affiché dans le Guide (voir renderGuide) : le
      // chargement peut réussir (pas d'erreur réseau/XML) tout en ne
      // contenant aucun programme exploitable pour ces chaînes
      // précisément (identifiants/noms qui ne concordent pas avec la
      // source EPG) — sans ce chiffre, ce cas est indiscernable d'un
      // guide qui n'a simplement pas encore chargé.
      state.epgDebug = { url: url, channelCount: Object.keys(map).length };
      if (isTabActive('direct')) renderKind('direct');
      if (isTabActive('guide')) renderGuide(false);
    }).catch(function (err) {
      if (timedOut) return; // délai déjà traité
      clearTimeout(timeoutId);
      state.epgLoading = false;
      state.epgFailedUrl = url;
      state.epgError = 'Chargement du guide TV impossible : ' + err.message;
      console.warn('EPG', err.message);
      if (isTabActive('guide')) renderGuide(false);
    });
  }

  function nowNextFor(item) {
    if (!state.epgMap || (!item.epgKey && !item.name)) return null;
    return Epg.nowNext(state.epgMap, item.epgKey, item.name);
  }

  function epgBadge(item) {
    var info = nowNextFor(item);
    if (!info || !info.now) return null;
    return el('div', 'carte-epg', '▶ ' + info.now.titre + (info.next ? ' · ensuite : ' + info.next.titre : ''));
  }

  function isTabActive(name) { var p = $id('tab-' + name); return p && p.classList.contains('active'); }

  function ensureXtreamCats(kindKey) {
    var pl = state.playlist;
    if (state.xtreamCats[kindKey]) return Promise.resolve(state.xtreamCats[kindKey]);
    var cfg = xtreamCfg(pl);
    var call = kindKey === 'direct' ? Xtream.liveCategories(cfg)
      : kindKey === 'films' ? Xtream.vodCategories(cfg)
      : Xtream.seriesCategories(cfg);
    return call.then(function (cats) {
      var list = (Array.isArray(cats) ? cats : []).map(function (c) { return { id: c.category_id, label: c.category_name }; });
      state.xtreamCats[kindKey] = list;
      return list;
    });
  }

  function ensureXtreamItems(kindKey, categoryId) {
    var pl = state.playlist;
    var cfg = xtreamCfg(pl);
    var call = kindKey === 'direct' ? Xtream.liveStreams(cfg, categoryId)
      : kindKey === 'films' ? Xtream.vodStreams(cfg, categoryId)
      : Xtream.seriesList(cfg, categoryId);
    return call.then(function (raw) {
      var list = Array.isArray(raw) ? raw : [];
      var catLabel = (state.xtreamCats[kindKey] || []).reduce(function (acc, c) { acc[c.id] = c.label; return acc; }, {});
      return list.map(function (s) {
        if (kindKey === 'direct') {
          var groupLabel = catLabel[s.category_id] || '';
          return { key: 'xt:live:' + pl.id + ':' + s.stream_id, kind: /radio/i.test(groupLabel) ? 'radio' : 'direct', name: s.name,
            logo: s.stream_icon, group: groupLabel, url: Xtream.streamUrl(cfg, 'live', s.stream_id, 'm3u8'),
            streamId: s.stream_id, epgKey: String(s.stream_id), chno: s.num != null ? String(s.num) : '' };
        }
        if (kindKey === 'films') {
          return { key: 'xt:vod:' + pl.id + ':' + s.stream_id, kind: 'films', name: s.name,
            logo: s.stream_icon, group: catLabel[s.category_id] || '', url: Xtream.streamUrl(cfg, 'vod', s.stream_id, s.container_extension || 'mp4'),
            streamId: s.stream_id };
        }
        return { key: 'xt:series:' + pl.id + ':' + s.series_id, kind: 'series', name: s.name,
          logo: s.cover, group: catLabel[s.category_id] || '', seriesId: s.series_id };
      });
    });
  }

  // Fetch « toutes les chaînes » (Xtream, sans filtre de catégorie) partagé
  // et mémorisé pour toute la session (jusqu'au changement de playlist) —
  // sinon chaque usage (sélection « Tous les bouquets », vue Bouquets,
  // Guide, recherche universelle) déclenchait son propre appel réseau
  // complet, lent sur une grosse playlist. Attend d'abord les catégories
  // (mémorisées elles aussi) pour que les libellés de groupe/la détection
  // radio soient correctement renseignés.
  function ensureAllDirectItems() {
    if (!state.xtreamAllDirectCache) {
      state.xtreamAllDirectCache = ensureXtreamCats('direct').then(function () { return ensureXtreamItems('direct', ''); });
    }
    return state.xtreamAllDirectCache;
  }

  // ---------- rendu générique d'une grille ----------
  function matchesSearch(item, q) {
    if (!q) return true;
    return (item.name || '').toLowerCase().indexOf(q) !== -1;
  }

  function renderChips(container, cats, kindKey, onPick) {
    container.innerHTML = '';
    if (!cats || !cats.length) return;
    var all = el('button', 'chip' + (state.activeCategory[kindKey] === '' ? ' active' : ''), 'Toutes');
    all.addEventListener('click', function () { onPick(''); });
    container.appendChild(all);
    cats.forEach(function (c) {
      var b = el('button', 'chip' + (state.activeCategory[kindKey] === c.id ? ' active' : ''), c.label || c.id);
      b.addEventListener('click', function () { onPick(c.id); });
      container.appendChild(b);
    });
  }

  // Menu dépliant (natif <select>) pour choisir un bouquet en mode Liste/
  // Tuile — plus maniable qu'une rangée de puces quand une playlist compte
  // des dizaines de catégories. Utilisé pour En direct uniquement (voir
  // #chipsDirect dans index.html, un <select> plutôt qu'un <div class="chips">).
  function renderCategorySelect(select, cats, kindKey, onPick) {
    select.style.display = '';
    select.innerHTML = '';
    var optAll = document.createElement('option');
    optAll.value = ''; optAll.textContent = 'Tous les bouquets';
    select.appendChild(optAll);
    (cats || []).forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id; o.textContent = c.label || c.id;
      select.appendChild(o);
    });
    select.value = state.activeCategory[kindKey] || '';
    select.onchange = function () { onPick(select.value); };
  }

  // ---------- code PIN (bouquets/catégories « adulte ») ----------
  // Facultatif : tant qu'aucun code PIN n'est défini, rien n'est masqué.
  // Détection par nom de catégorie (groupe M3U ou catégorie Xtream) —
  // aucune liste de contenus, juste une heuristique sur le nom.
  var ADULT_GROUP_RE = /adult|adulte|xxx|18\+|porn/i;
  function isAdultGroup(name) { return ADULT_GROUP_RE.test(name || ''); }

  function filterAdultLocked(items) {
    var pin = Store.getParentalPin();
    if (!pin) return { visible: items, locked: {} };
    var visible = [], locked = {};
    items.forEach(function (it) {
      var groupName = (it.group || it.groupTitle || '').trim();
      var key = groupName.toLowerCase();
      if (groupName && isAdultGroup(groupName) && !state.unlockedAdult[key]) {
        if (!locked[key]) locked[key] = { label: groupName, count: 0 };
        locked[key].count++;
      } else {
        visible.push(it);
      }
    });
    return { visible: visible, locked: locked };
  }

  function appendLockedCards(container, locked, onUnlock) {
    Object.keys(locked).forEach(function (key) {
      var info = locked[key];
      var card = el('div', 'carte-lock');
      card.appendChild(el('div', 'carte-lock-ico', '🔒'));
      var txt = el('div', 'carte-lock-txt');
      txt.appendChild(el('div', 'carte-lock-nom', info.label));
      txt.appendChild(el('div', 'hint', info.count + ' élément(s) protégé(s) par code PIN — toucher pour déverrouiller'));
      card.appendChild(txt);
      card.addEventListener('click', function () {
        askPin('Code PIN pour « ' + info.label + ' »').then(function (ok) {
          if (ok) { state.unlockedAdult[key] = true; onUnlock(); }
        });
      });
      container.appendChild(makeFocusable(card));
    });
  }

  var pinResolveCallback = null;
  function askPin(message) {
    return new Promise(function (resolve) {
      $id('pinModalMsg').textContent = message;
      $id('pinInput').value = '';
      $id('pinError').textContent = '';
      $id('pinModal').style.display = 'flex';
      pinResolveCallback = resolve;
      setTimeout(function () { $id('pinInput').focus(); }, 50);
    });
  }
  function closePinModal(result) {
    $id('pinModal').style.display = 'none';
    var cb = pinResolveCallback;
    pinResolveCallback = null;
    if (cb) cb(result);
  }
  $id('pinCancel').addEventListener('click', function () { closePinModal(false); });
  $id('pinConfirm').addEventListener('click', function () {
    var v = $id('pinInput').value.trim();
    if (v && v === Store.getParentalPin()) { closePinModal(true); }
    else { $id('pinError').textContent = 'Code incorrect.'; }
  });
  $id('pinInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') $id('pinConfirm').click(); });

  // Modale de confirmation maison plutôt que window.confirm() : dans la
  // WebView Android de Capacitor, confirm()/alert()/prompt() ne montrent
  // souvent aucune boîte de dialogue (pas de gestionnaire onJsConfirm natif)
  // et la promesse implicite se résout silencieusement à false — le bouton
  // de suppression semble alors ne rien faire, alors que le clic est bien
  // reçu. Même modale que pour le code PIN (askPin ci-dessus).
  var confirmResolveCallback = null;
  function askConfirm(message, title) {
    return new Promise(function (resolve) {
      $id('confirmModalTitle').textContent = title || 'Confirmer';
      $id('confirmModalMsg').textContent = message;
      $id('confirmModal').style.display = 'flex';
      confirmResolveCallback = resolve;
    });
  }
  function closeConfirmModal(result) {
    $id('confirmModal').style.display = 'none';
    var cb = confirmResolveCallback;
    confirmResolveCallback = null;
    if (cb) cb(result);
  }
  $id('confirmModalCancel').addEventListener('click', function () { closeConfirmModal(false); });
  $id('confirmModalOk').addEventListener('click', function () { closeConfirmModal(true); });

  // ---------- Export / import de config (sauvegarde, transfert vers un
  // autre appareil — ex. navigateur Tesla) ----------
  function openExportModal() {
    $id('exportStep1').style.display = '';
    $id('exportStep2').style.display = 'none';
    $id('exportPassphrase').value = '';
    $id('exportError').textContent = '';
    $id('exportModal').style.display = 'flex';
  }
  function closeExportModal() { $id('exportModal').style.display = 'none'; }
  $id('btnExportConfig').addEventListener('click', openExportModal);
  $id('exportCancel').addEventListener('click', closeExportModal);
  $id('exportClose').addEventListener('click', closeExportModal);
  $id('exportModal').addEventListener('click', function (e) { if (e.target.id === 'exportModal') closeExportModal(); });
  $id('exportGenerate').addEventListener('click', function () {
    var pass = $id('exportPassphrase').value;
    if (!pass) { $id('exportError').textContent = 'La phrase secrète est obligatoire.'; return; }
    var cfg = Store.exportConfig({ favoris: $id('exportFavoris').checked, tmdbKey: $id('exportTmdb').checked });
    if (!cfg.playlists.length) { $id('exportError').textContent = 'Aucune playlist à exporter.'; return; }
    $id('exportError').textContent = '';
    ConfigCrypto.encrypt(JSON.stringify(cfg), pass).then(function (code) {
      $id('exportResult').value = code;
      $id('exportStep1').style.display = 'none';
      $id('exportStep2').style.display = '';
    }).catch(function (err) { $id('exportError').textContent = 'Chiffrement impossible : ' + err.message; });
  });
  $id('exportCopy').addEventListener('click', function () {
    var ta = $id('exportResult');
    ta.focus(); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (!ok && navigator.clipboard) { navigator.clipboard.writeText(ta.value).then(function () { toast('Code copié'); }); }
    else if (ok) toast('Code copié');
    else toast('Sélectionne le code et copie-le manuellement');
  });

  function openImportModal(prefill) {
    $id('importCode').value = prefill || '';
    $id('importPassphrase').value = '';
    $id('importError').textContent = '';
    $id('importModal').style.display = 'flex';
    setTimeout(function () { $id('importPassphrase').focus(); }, 50);
  }
  function closeImportModal() { $id('importModal').style.display = 'none'; }
  $id('btnImportConfig').addEventListener('click', function () { openImportModal(); });
  $id('importCancel').addEventListener('click', closeImportModal);
  $id('importModal').addEventListener('click', function (e) { if (e.target.id === 'importModal') closeImportModal(); });
  $id('importConfirm').addEventListener('click', function () {
    var code = $id('importCode').value.trim();
    var pass = $id('importPassphrase').value;
    if (!code || !pass) { $id('importError').textContent = 'Code et phrase secrète obligatoires.'; return; }
    $id('importError').textContent = '';
    ConfigCrypto.decrypt(code, pass).then(function (json) {
      var cfg = JSON.parse(json);
      var added = Store.importConfig(cfg);
      closeImportModal();
      toast('Importé : ' + added.playlists + ' playlist(s), ' + added.favoris + ' favori(s)');
      renderPlaylists();
    }).catch(function (err) { $id('importError').textContent = err.message || 'Import impossible.'; });
  });

  // Ouverture directe d'un import depuis un lien (#import=<code>, généré par
  // Exporter) ou depuis un code hébergé sur GitHub Pages (?sync=<id> ->
  // sync/<id>.json, relatif : fonctionne aussi bien sous / que sous un
  // sous-dossier comme /lecteur-iptv/). Utile pour taper un lien court une
  // seule fois sur un écran sans clavier physique (ex. Tesla) plutôt que de
  // recopier tout le code chiffré.
  (function checkIncomingImport() {
    if (location.hash.indexOf('#import=') === 0) {
      var code = decodeURIComponent(location.hash.slice('#import='.length));
      history.replaceState(null, '', location.pathname + location.search);
      goTab('reglages');
      openImportModal(code);
      return;
    }
    var params = new URLSearchParams(location.search);
    var syncId = params.get('sync');
    if (syncId && /^[a-z0-9_-]+$/i.test(syncId)) {
      fetch('sync/' + syncId + '.json').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (code) {
        goTab('reglages');
        openImportModal(code);
      }).catch(function () { toast('Config « ' + syncId + ' » introuvable'); });
    }
  })();

  // Beaucoup de playlists IPTV insèrent des entrées purement décoratives
  // entre les groupes de chaînes (ex. « ||--- |FR| GENERALISTES |FR| ---|| »)
  // sans flux valide derrière : elles bloquent le lecteur indéfiniment sans
  // jamais renvoyer d'erreur claire. Heuristique : beaucoup de caractères de
  // séparation (-=#*_|~) par rapport à la longueur du nom.
  function looksLikeSeparator(name) {
    if (!name) return false;
    var decorative = (name.match(/[-=#*_|~]/g) || []).length;
    return decorative / name.length > 0.25;
  }

  // Chaînes de bienvenue/pub insérées par certains fournisseurs IPTV, sans
  // contenu réel — masquées par préfixe (insensible à la casse), le
  // fournisseur faisant varier le suffixe ("... TV", "... IPTV", ...).
  var HIDDEN_CHANNEL_NAMES = /^welcome ultimate\b/i;
  function isHiddenChannel(name) { return HIDDEN_CHANNEL_NAMES.test(String(name || '').trim()); }

  // Beaucoup de playlists (surtout M3U) listent la même chaîne ou le même
  // film plusieurs fois sous des noms voisins — sources de secours,
  // qualités différentes ("TF1", "TF1 HD", "TF1 FHD (2)", "Inception 4K"...).
  // On les regroupe sous une seule carte à partir d'une clé normalisée (nom
  // sans mention de qualité/source ni ponctuation), et on garde chaque
  // entrée d'origine dans `versions` : pratique pour retomber sur une
  // source plus légère si le débit est faible, sans avoir à fouiller une
  // liste pleine de doublons.
  var CHANNEL_QUALITY_TAGS = /\b(4k|uhd|fhd|full ?hd|hd|sd|hevc|h ?265|h ?264|vostfr|vf|vo|multi)\b/gi;
  function channelFamilyKey(name) {
    var key = String(name || '')
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(CHANNEL_QUALITY_TAGS, ' ')
      .replace(/[^a-z0-9+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return key || String(name || '').toLowerCase().trim();
  }

  // Exclut les entrées radio (catégorie détectée par nom, voir kind:'radio'
  // dans ensureXtreamItems/m3u.js classifyGroup) des vues « En direct » —
  // elles ont leur propre onglet Radio. Pour les playlists M3U, ce filtre
  // est déjà implicite (les items radio ne passent jamais kind==='live') ;
  // utile surtout côté Xtream où get_live_streams renvoie tout ensemble.
  function excludeRadio(items) { return items.filter(function (it) { return it.kind !== 'radio'; }); }
  function excludeHidden(items) { return items.filter(function (it) { return !isHiddenChannel(it.name); }); }

  function groupChannels(items) {
    var byKey = {}, order = [];
    items.forEach(function (it) {
      var fam = channelFamilyKey(it.name);
      if (!byKey[fam]) { byKey[fam] = []; order.push(fam); }
      byKey[fam].push(it);
    });
    return order.map(function (fam) {
      var versions = byKey[fam];
      var logo = versions.map(function (v) { return v.logo; }).filter(Boolean)[0] || null;
      return Object.assign({}, versions[0], { logo: logo, versions: versions });
    });
  }

  // Lecture directe même quand plusieurs sources sont regroupées sous cette
  // chaîne : plus de sélecteur bloquant avant lecture — le choix de la
  // source se fait depuis l'interface du lecteur (bouton ⚙️ → Sources),
  // pendant que ça joue déjà.
  function openChannelVersions(item) {
    var versions = item.versions && item.versions.length > 1 ? item.versions : null;
    Player.open(item.url, item.name, { live: true, epgKey: item.epgKey, logo: item.logo, versions: versions });
  }

  function showVersionPicker(item, isLive) {
    var modal = $id('versionPicker');
    $id('versionPickerTitle').textContent = item.name;
    var list = $id('versionPickerList');
    list.innerHTML = '';
    item.versions.forEach(function (v) {
      var b = el('button', 'version-item', v.name);
      b.addEventListener('click', function () { hideVersionPicker(); Player.open(v.url, v.name, { live: !!isLive }); });
      list.appendChild(b);
    });
    modal.style.display = 'flex';
  }

  function hideVersionPicker() { $id('versionPicker').style.display = 'none'; }

  $id('versionPickerClose').addEventListener('click', hideVersionPicker);
  $id('versionPicker').addEventListener('click', function (e) { if (e.target.id === 'versionPicker') hideVersionPicker(); });

  function card(item, opts) {
    opts = opts || {};
    var card = el('div', 'carte');
    var thumb = el('div', 'carte-thumb');
    if (item.logo) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.src = item.logo;
      img.alt = '';
      img.onerror = function () { thumb.classList.add('vide'); img.remove(); };
      thumb.appendChild(img);
    } else {
      thumb.classList.add('vide');
    }
    if (!item.logo) thumb.textContent = item.icon || iconFor(item.kind);
    if (item.versions && item.versions.length > 1) thumb.appendChild(el('div', 'carte-versions', item.versions.length + ' sources'));
    // Reprise de lecture : barre de progression sur les cartes films dont on
    // a déjà vu une partie (voir Store.setProgress dans player.js).
    if (item.kind === 'films' && item.url) {
      var prog = Store.getProgress(item.url);
      if (prog && prog.duration) {
        var ratio = Math.min(1, Math.max(0, prog.position / prog.duration));
        if (ratio > 0.03 && ratio < 0.95) {
          var fill = el('div', 'carte-progress-fill');
          fill.style.width = Math.round(ratio * 100) + '%';
          var bar = el('div', 'carte-progress');
          bar.appendChild(fill);
          thumb.appendChild(bar);
        }
      }
    }
    card.appendChild(thumb);

    var body = el('div', 'carte-corps');
    body.appendChild(el('div', 'carte-nom', item.name));
    if (item.group) body.appendChild(el('div', 'carte-groupe', item.group));
    if (opts.epgBadge) body.appendChild(opts.epgBadge);
    card.appendChild(body);

    if (item.url) {
      var star = el('button', 'carte-star', Store.isFavori(item.key) ? '★' : '☆');
      star.setAttribute('aria-label', 'Favori');
      star.addEventListener('click', function (e) {
        e.stopPropagation();
        var justAdded = Store.toggleFavori({ key: item.key, kind: item.kind, name: item.name, logo: item.logo, group: item.group, url: item.url, streamId: item.streamId });
        star.textContent = justAdded ? '★' : '☆';
        if (isTabActive('maliste')) renderFavoris();
      });
      card.appendChild(star);
    }

    // item.kind vaut 'direct' (Xtream) ou 'live' (M3U, voir m3u.js
    // classifyGroup) selon la source — les deux désignent une chaîne en direct.
    card.addEventListener('click', function () {
      if (opts.onOpen) { opts.onOpen(item); return; }
      var isLive = item.kind === 'direct' || item.kind === 'live' || item.kind === 'radio';
      Player.open(item.url, item.name, { live: isLive, radio: item.kind === 'radio', epgKey: item.epgKey, logo: item.logo });
    });
    return makeFocusable(card);
  }

  function iconFor(kind) { return kind === 'films' ? '🎬' : kind === 'series' ? '🎞️' : kind === 'bouquet' ? '🗂️' : kind === 'radio' ? '📻' : '📺'; }

  // Icône de bouquet inspirée de son thème plutôt qu'un pictogramme
  // générique — heuristique par mots-clés sur le nom (même esprit que
  // isAdultGroup/classifyGroup), best-effort et sans prétention d'exhaustivité.
  function iconForBouquet(label) {
    var s = String(label || '').toLowerCase();
    if (/adulte|xxx|18\+|porn/.test(s)) return '🔞';
    if (/sport|foot|tennis|golf|rugby|basket|f1\b|ufc|boxe|nba|nfl|moto ?gp/.test(s)) return '⚽';
    if (/cin[ée]|movie|vod/.test(s)) return '🎬';
    if (/s[ée]rie|show|drama/.test(s)) return '🎞️';
    if (/jeunesse|kids?\b|enfant|cartoon|disney|nickelodeon|toon/.test(s)) return '🧸';
    if (/musique|music|clip|mtv|hits?\b/.test(s)) return '🎵';
    if (/info|news|actu/.test(s)) return '📰';
    if (/document|discovery|nat ?geo|histoire|science/.test(s)) return '🔭';
    if (/religio|god|dieu|coran|bible|islam|chr[ée]tien/.test(s)) return '🕊️';
    if (/r[ée]gion|local/.test(s)) return '📍';
    if (/g[ée]n[ée]ralist|national/.test(s)) return '📺';
    return '🗂️';
  }

  // Beaucoup de playlists agrègent plusieurs pays, avec un marqueur "FR" en
  // début de nom de bouquet ("FR| ...", "FR LIGUE 1 + FR"...) ou le mot
  // France/français en toutes lettres, ou encore le nom d'un bouquet/offre
  // français bien connu (Canal+/CanalSat...) — sert à n'afficher que les
  // bouquets français par défaut (voir renderBouquetTiles) et éviter une
  // liste de centaines de bouquets étrangers au premier affichage.
  var FR_BOUQUET = /(^|[^a-zàâäéèêëïîôöùûüç])(fr|france|fran[cç]ais)([^a-zàâäéèêëïîôöùûüç]|$)|canal ?\+|canal ?sat/i;
  function isFrenchBouquet(label) { return FR_BOUQUET.test(String(label || '')); }

  // Titre de section (ex. "titre de section" au lieu de carte) : voir
  // looksLikeSeparator(name).
  function sectionTitle(name) {
    var clean = name.replace(/[-=#*_|~]+/g, ' ').replace(/\s+/g, ' ').trim();
    return el('div', 'carte-section', clean || name);
  }

  function renderList(container, moreBtn, items, shownKey, opts) {
    var shown = state.shown[shownKey];
    if (shownKey === 'direct') setZapList(items);
    container.innerHTML = '';
    if (!items.length) {
      container.appendChild(el('div', 'hint', 'Aucun résultat.'));
      moreBtn.style.display = 'none';
      return;
    }
    items.slice(0, shown).forEach(function (item) {
      container.appendChild(item.url && looksLikeSeparator(item.name) ? sectionTitle(item.name) : card(item, opts));
    });
    moreBtn.style.display = items.length > shown ? '' : 'none';
  }

  // ---------- En direct / Films (M3U ou Xtream) ----------
  function renderKind(kindKey) {
    var pl = state.playlist;
    var listId = kindKey === 'direct' ? 'listeDirect' : kindKey === 'films' ? 'listeFilms' : 'listeSeries';
    var moreId = kindKey === 'direct' ? 'plusDirect' : kindKey === 'films' ? 'plusFilms' : 'plusSeries';
    var chipsId = kindKey === 'direct' ? 'chipsDirect' : kindKey === 'films' ? 'chipsFilms' : 'chipsSeries';
    var searchId = kindKey === 'direct' ? 'rechDirect' : kindKey === 'films' ? 'rechFilms' : 'rechSeries';
    var container = $id(listId), moreBtn = $id(moreId), chips = $id(chipsId), search = $id(searchId);
    if (kindKey === 'direct') {
      container.classList.toggle('liste', state.directView === 'liste');
      container.classList.toggle('bouquets', state.directView === 'bouquets');
      kickEpg();
    }

    if (!pl) { container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Choisis ou ajoute une playlist dans l’onglet Playlists.')); moreBtn.style.display = 'none'; chips.innerHTML = ''; return; }

    if (kindKey === 'direct' && state.directView === 'bouquets') { renderBouquets(); return; }

    if (pl.type === 'm3u') {
      var m3uKind = kindKey === 'direct' ? 'live' : kindKey === 'films' ? 'vod' : 'series';
      ensureM3uLoaded().then(function (data) {
        var pool = data.items.filter(function (it) { return it.kind === m3uKind; });
        var groups = uniqueSorted(pool.map(function (it) { return it.groupTitle; }));
        var onPickCat = function (g) { state.activeCategory[kindKey] = g; state.shown[kindKey] = PAGE_SIZE; renderKind(kindKey); };
        if (kindKey === 'direct') renderCategorySelect(chips, groups.map(function (g) { return { id: g, label: g }; }), kindKey, onPickCat);
        else renderChips(chips, groups.map(function (g) { return { id: g, label: g }; }), kindKey, onPickCat);
        var cat = state.activeCategory[kindKey];
        var q = search.value.trim().toLowerCase();
        if (kindKey === 'series') {
          var series = M3U.groupSeries(pool.filter(function (it) { return !cat || it.groupTitle === cat; }))
            .filter(function (s) { return matchesSearch({ name: s.nom }, q); })
            .map(function (s) {
              return { key: 'serie:' + pl.id + ':' + s.nom, kind: 'series', name: s.nom, logo: s.logo, group: s.groupTitle, saisons: s.saisons };
            });
          var seriesLock = filterAdultLocked(series);
          renderList(container, moreBtn, seriesLock.visible, kindKey, { onOpen: openSerieM3u });
          appendLockedCards(container, seriesLock.locked, function () { renderKind(kindKey); });
        } else {
          var items = pool.filter(function (it) { return (!cat || it.groupTitle === cat) && matchesSearch(it, q) && !isHiddenChannel(it.name); })
            .map(function (it) {
              var withKey = Object.assign({}, it, { epgKey: it.tvgId || null, group: it.groupTitle, logo: it.tvgLogo, chno: it.tvgChno || '' });
              withKey._badge = epgBadge(withKey);
              return withKey;
            });
          var itemsLock = filterAdultLocked(items);
          items = itemsLock.visible;
          if (kindKey === 'direct' || kindKey === 'films') items = groupChannels(items);
          renderList(container, moreBtn, items, kindKey, { onOpen: kindKey === 'films' ? openFilm : kindKey === 'direct' ? openChannelVersions : null });
          // (le badge EPG est déjà calculé par item ; on l'injecte après coup —
          // avant d'ajouter les cartes verrouillées, pour garder l'alignement
          // d'index entre `items` et les enfants du conteneur)
          Array.prototype.forEach.call(container.children, function (node, i) {
            var corps = items[i] && items[i]._badge && node.querySelector('.carte-corps');
            if (corps) corps.appendChild(items[i]._badge);
          });
          appendLockedCards(container, itemsLock.locked, function () { renderKind(kindKey); });
        }
      }).catch(function (err) { container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Impossible de charger la playlist : ' + err.message)); moreBtn.style.display = 'none'; });
      return;
    }

    // Xtream
    ensureXtreamCats(kindKey).then(function (cats) {
      if (kindKey === 'direct') cats = cats.filter(function (c) { return !/radio/i.test(c.label || ''); });
      var onPickCatXt = function (id) { state.activeCategory[kindKey] = id; state.shown[kindKey] = PAGE_SIZE; state.xtreamItems[kindKey] = null; renderKind(kindKey); };
      if (kindKey === 'direct') renderCategorySelect(chips, cats, kindKey, onPickCatXt);
      else renderChips(chips, cats, kindKey, onPickCatXt);
      var catId = state.activeCategory[kindKey];
      var load = state.xtreamItems[kindKey] ? Promise.resolve(state.xtreamItems[kindKey])
        : (kindKey === 'direct' && !catId) ? ensureAllDirectItems()
        : ensureXtreamItems(kindKey, catId);
      container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Chargement…'));
      load.then(function (items) {
        state.xtreamItems[kindKey] = items;
        var q = search.value.trim().toLowerCase();
        var filtered = items.filter(function (it) { return matchesSearch(it, q) && !isHiddenChannel(it.name); });
        if (kindKey === 'direct') {
          filtered = excludeRadio(filtered).map(function (it) { var c = Object.assign({}, it); c._badge = epgBadge(c); return c; });
        }
        var xtreamLock = filterAdultLocked(filtered);
        filtered = xtreamLock.visible;
        if (kindKey === 'direct' || kindKey === 'films') filtered = groupChannels(filtered);
        renderList(container, moreBtn, filtered, kindKey, { onOpen: kindKey === 'series' ? openSerieXtream : kindKey === 'films' ? openFilm : kindKey === 'direct' ? openChannelVersions : null });
        if (kindKey === 'direct') {
          Array.prototype.forEach.call(container.children, function (node, i) {
            var corps = filtered[i] && filtered[i]._badge && node.querySelector('.carte-corps');
            if (corps) corps.appendChild(filtered[i]._badge);
          });
        }
        appendLockedCards(container, xtreamLock.locked, function () { renderKind(kindKey); });
      }).catch(function (err) { container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Connexion au serveur impossible : ' + err.message)); moreBtn.style.display = 'none'; });
    }).catch(function (err) { container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Connexion au serveur impossible : ' + err.message)); moreBtn.style.display = 'none'; });
  }

  // ---------- Vue « Bouquets » (En direct) ----------
  // Une grosse tuile par catégorie plutôt qu'une liste de chaînes, avec un
  // petit descriptif (nombre de chaînes). Toucher un bouquet filtre dessus
  // et bascule automatiquement en mode Liste pour voir les chaînes.
  function openBouquet(g) {
    state.activeCategory.direct = g.id;
    state.shown.direct = PAGE_SIZE;
    state.directView = 'liste';
    Array.prototype.forEach.call(document.querySelectorAll('#directViewToggle .view-btn'), function (x) {
      x.classList.toggle('active', x.dataset.view === 'liste');
    });
    renderKind('direct');
  }

  function renderBouquetTiles(container, moreBtn, groups, q) {
    var filtered = groups.filter(function (g) { return !q || g.label.toLowerCase().indexOf(q) !== -1; });
    // Par défaut (pas de recherche en cours), on n'affiche que les bouquets
    // français pour éviter une liste de centaines de bouquets étrangers —
    // le bouton « Charger plus » révèle le reste.
    var hiddenOthers = 0;
    if (!q && !state.bouquetsAllCountries) {
      var fr = filtered.filter(function (g) { return isFrenchBouquet(g.label); });
      if (fr.length) { hiddenOthers = filtered.length - fr.length; filtered = fr; }
    }
    container.innerHTML = '';
    if (!filtered.length) { container.appendChild(el('div', 'hint', 'Aucun résultat.')); moreBtn.style.display = 'none'; return; }
    filtered.forEach(function (g) {
      var item = { key: 'bouquet:' + g.id, kind: 'bouquet', name: g.label, logo: g.logo, icon: iconForBouquet(g.label),
        group: g.count + ' chaîne' + (g.count > 1 ? 's' : '') };
      container.appendChild(card(item, { onOpen: function () { openBouquet(g); } }));
    });
    if (hiddenOthers > 0) {
      moreBtn.textContent = 'Charger plus (' + hiddenOthers + ' autres bouquets)';
      moreBtn.style.display = '';
    } else {
      moreBtn.textContent = 'Charger plus';
      moreBtn.style.display = 'none';
    }
  }

  function renderBouquets() {
    var pl = state.playlist;
    var container = $id('listeDirect'), moreBtn = $id('plusDirect'), chips = $id('chipsDirect'), search = $id('rechDirect');
    moreBtn.style.display = 'none';
    chips.innerHTML = '';
    chips.style.display = 'none';
    container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Chargement…'));
    var q = search.value.trim().toLowerCase();

    if (pl.type === 'm3u') {
      ensureM3uLoaded().then(function (data) {
        var pool = data.items.filter(function (it) { return it.kind === 'live' && !isHiddenChannel(it.name); });
        var byGroup = {};
        pool.forEach(function (it) {
          var g = it.groupTitle || 'Sans groupe';
          if (!byGroup[g]) byGroup[g] = { id: g, label: g, count: 0, logo: null };
          byGroup[g].count++;
          if (!byGroup[g].logo && it.tvgLogo) byGroup[g].logo = it.tvgLogo;
        });
        var groups = Object.keys(byGroup).sort(function (a, b) { return a.localeCompare(b); }).map(function (k) { return byGroup[k]; });
        renderBouquetTiles(container, moreBtn, groups, q);
      }).catch(function (err) { container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Impossible de charger la playlist : ' + err.message)); });
    } else {
      Promise.all([ensureXtreamCats('direct'), ensureAllDirectItems()]).then(function (r) {
        var cats = r[0].filter(function (c) { return !/radio/i.test(c.label || ''); }), items = excludeHidden(excludeRadio(r[1]));
        var countByLabel = {}, logoByLabel = {};
        items.forEach(function (it) {
          var g = it.group || '';
          countByLabel[g] = (countByLabel[g] || 0) + 1;
          if (!logoByLabel[g] && it.logo) logoByLabel[g] = it.logo;
        });
        var groups = cats.map(function (c) {
          return { id: c.id, label: c.label, count: countByLabel[c.label] || 0, logo: logoByLabel[c.label] || null };
        });
        renderBouquetTiles(container, moreBtn, groups, q);
      }).catch(function (err) { container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Connexion au serveur impossible : ' + err.message)); });
    }
  }

  // ---------- Radio ----------
  // Détectée par nom de catégorie (M3U : kind:'radio' via m3u.js
  // classifyGroup ; Xtream : catégorie dont le libellé contient « radio »,
  // voir ensureXtreamItems) — pas de distinction native dans l'API Xtream
  // classique entre chaînes TV et radios, donc heuristique comme pour le
  // reste (VOD/séries).

  // Beaucoup d'abonnements IPTV ne proposent aucune radio (l'onglet reste
  // alors vide) : quelques grandes stations françaises en flux public,
  // toujours disponibles en plus de celles éventuellement fournies par la
  // playlist active — mêmes flux que ceux utilisés par les lecteurs web
  // officiels de ces stations, vérifiés joignables.
  var DEFAULT_RADIOS = [
    { name: 'France Inter', url: 'https://icecast.radiofrance.fr/franceinter-midfi.mp3' },
    { name: 'France Info', url: 'https://icecast.radiofrance.fr/franceinfo-midfi.mp3' },
    { name: 'France Culture', url: 'https://icecast.radiofrance.fr/franceculture-midfi.mp3' },
    { name: 'France Musique', url: 'https://icecast.radiofrance.fr/francemusique-midfi.mp3' },
    { name: 'FIP', url: 'https://icecast.radiofrance.fr/fip-midfi.mp3' },
    { name: 'Europe 1', url: 'https://europe1.lmn.fm/europe1.mp3' },
    { name: 'RMC', url: 'https://audio.bfmtv.com/rmcradio_128.mp3' },
    { name: 'NRJ', url: 'https://cdn.nrjaudio.fm/audio1/fr/30001/mp3_128.mp3' },
    { name: 'Skyrock', url: 'https://icecast.skyrock.net/s/natio_mp3_128k' }
  ].map(function (r) {
    return { key: 'default-radio:' + r.url, kind: 'radio', name: r.name, url: r.url, logo: null, group: 'Stations par défaut' };
  });

  function renderRadio() {
    var pl = state.playlist;
    var container = $id('listeRadio'), moreBtn = $id('plusRadio'), search = $id('rechRadio');
    if (!pl) { container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Choisis ou ajoute une playlist dans l’onglet Réglages.')); moreBtn.style.display = 'none'; return; }
    container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Chargement…'));
    moreBtn.style.display = 'none';
    var q = search.value.trim().toLowerCase();

    function finish(items) {
      var filtered = items.concat(DEFAULT_RADIOS).filter(function (it) { return matchesSearch(it, q) && !isHiddenChannel(it.name); });
      filtered = groupChannels(filtered);
      var lock = filterAdultLocked(filtered);
      renderList(container, moreBtn, lock.visible, 'radio', { onOpen: function (item) {
        var versions = item.versions && item.versions.length > 1 ? item.versions : null;
        Player.open(item.url, item.name, { live: true, radio: true, epgKey: item.epgKey, logo: item.logo, versions: versions });
      } });
      appendLockedCards(container, lock.locked, renderRadio);
    }

    if (pl.type === 'm3u') {
      ensureM3uLoaded().then(function (data) {
        var items = data.items.filter(function (it) { return it.kind === 'radio' && it.url && !looksLikeSeparator(it.name); })
          .map(function (it) { return Object.assign({}, it, { group: it.groupTitle, logo: it.tvgLogo }); });
        finish(items);
      }).catch(function (err) { container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Impossible de charger la playlist : ' + err.message)); });
    } else {
      ensureXtreamItems('direct', '').then(function (items) {
        finish(items.filter(function (it) { return it.kind === 'radio'; }));
      }).catch(function (err) { container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Connexion au serveur impossible : ' + err.message)); });
    }
  }
  $id('rechRadio').addEventListener('input', function () { state.shown.radio = PAGE_SIZE; renderRadio(); });
  $id('plusRadio').addEventListener('click', function () { state.shown.radio += PAGE_SIZE; renderRadio(); });

  function uniqueSorted(arr) {
    var set = {}; arr.forEach(function (v) { if (v) set[v] = true; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b); });
  }

  $id('rechDirect').addEventListener('input', function () { state.shown.direct = PAGE_SIZE; renderKind('direct'); });
  $id('rechFilms').addEventListener('input', function () { state.shown.films = PAGE_SIZE; renderKind('films'); });
  $id('rechSeries').addEventListener('input', function () { state.shown.series = PAGE_SIZE; renderKind('series'); });
  $id('plusDirect').addEventListener('click', function () {
    if (state.directView === 'bouquets') state.bouquetsAllCountries = true;
    else state.shown.direct += PAGE_SIZE;
    renderKind('direct');
  });
  $id('plusFilms').addEventListener('click', function () { state.shown.films += PAGE_SIZE; renderKind('films'); });
  $id('plusSeries').addEventListener('click', function () { state.shown.series += PAGE_SIZE; renderKind('series'); });

  function switchDirectView(view) {
    state.directView = view;
    if (view === 'bouquets') state.bouquetsAllCountries = false;
    Array.prototype.forEach.call(document.querySelectorAll('#directViewToggle .view-btn'), function (x) { x.classList.toggle('active', x.dataset.view === view); });
    renderKind('direct');
  }
  $id('directViewToggle').addEventListener('click', function (e) {
    var b = e.target.closest('.view-btn');
    if (!b || b.classList.contains('active')) return;
    switchDirectView(b.dataset.view);
  });

  // ---------- Recherche universelle (Accueil) ----------
  // Charge une fois par playlist (mis en cache dans state.searchCache) le
  // pool complet d'un kind (direct/films/series), sans filtre de catégorie
  // ni pagination — réutilisé à chaque frappe de la recherche universelle.
  function searchPool(kindKey) {
    if (state.searchCache[kindKey]) return state.searchCache[kindKey];
    var pl = state.playlist;
    if (!pl) return Promise.resolve([]);
    var p;
    if (pl.type === 'm3u') {
      var m3uKind = kindKey === 'direct' ? 'live' : kindKey === 'films' ? 'vod' : 'series';
      p = ensureM3uLoaded().then(function (data) {
        var pool = data.items.filter(function (it) { return it.kind === m3uKind; });
        if (kindKey === 'series') {
          return M3U.groupSeries(pool).map(function (s) {
            return { key: 'serie:' + pl.id + ':' + s.nom, kind: 'series', name: s.nom, logo: s.logo, group: s.groupTitle, saisons: s.saisons };
          });
        }
        var items = pool.filter(function (it) { return it.url && !looksLikeSeparator(it.name) && !isHiddenChannel(it.name); })
          .map(function (it) { return Object.assign({}, it, { epgKey: it.tvgId || null, group: it.groupTitle, logo: it.tvgLogo, chno: it.tvgChno || '' }); });
        return (kindKey === 'direct' || kindKey === 'films') ? groupChannels(items) : items;
      });
    } else {
      p = kindKey === 'direct' ? ensureAllDirectItems() : ensureXtreamItems(kindKey, '');
      if (kindKey === 'direct') p = p.then(excludeRadio).then(excludeHidden);
      if (kindKey === 'direct' || kindKey === 'films') p = p.then(groupChannels);
    }
    p = p.then(function (items) { return filterAdultLocked(items).visible; });
    state.searchCache[kindKey] = p;
    return p;
  }

  function openSerie(serie) {
    return (state.playlist && state.playlist.type === 'm3u') ? openSerieM3u(serie) : openSerieXtream(serie);
  }

  var universalSearchTimer;
  function renderUniversalSearch() {
    var input = $id('rechUniverselle');
    var q = input.value.trim().toLowerCase();
    var out = $id('accueilSearchResults');
    out.innerHTML = '';
    if (!q || !state.playlist) return;
    out.appendChild(el('div', 'hint', 'Recherche…'));
    Promise.all([searchPool('direct'), searchPool('films'), searchPool('series')]).then(function (r) {
      if (input.value.trim().toLowerCase() !== q) return; // la recherche a changé entre-temps
      var dir = r[0].filter(function (it) { return matchesSearch(it, q); }).slice(0, 8);
      var fil = r[1].filter(function (it) { return matchesSearch(it, q); }).slice(0, 8);
      var ser = r[2].filter(function (it) { return matchesSearch(it, q); }).slice(0, 8);
      out.innerHTML = '';
      if (!dir.length && !fil.length && !ser.length) { out.appendChild(el('div', 'hint', 'Aucun résultat.')); return; }
      [['📺 Chaînes', dir, openChannelVersions], ['🎬 Films', fil, openFilm], ['🎞️ Séries', ser, openSerie]].forEach(function (section) {
        var label = section[0], items = section[1], onOpen = section[2];
        if (!items.length) return;
        out.appendChild(el('div', 'cat-title', label));
        var grid = el('div', 'grid-cartes liste');
        items.forEach(function (it) { grid.appendChild(card(it, { onOpen: onOpen })); });
        out.appendChild(grid);
      });
    }).catch(function (err) {
      out.innerHTML = '';
      out.appendChild(el('div', 'hint', 'Recherche impossible : ' + err.message));
    });
  }
  $id('rechUniverselle').addEventListener('input', function () {
    clearTimeout(universalSearchTimer);
    universalSearchTimer = setTimeout(renderUniversalSearch, 250);
  });

  // ---------- Guide TV (agenda heure par heure) ----------
  // Toutes les chaînes « en direct » de la playlist active, indépendamment
  // du filtre par catégorie utilisé dans l'onglet En direct. Les entrées
  // décoratives (séparateurs de catégorie) sont exclues.
  function directChannels() {
    var pl = state.playlist;
    if (!pl) return Promise.resolve([]);
    if (pl.type === 'm3u') {
      return ensureM3uLoaded().then(function (data) {
        return data.items
          .filter(function (it) { return it.kind === 'live' && it.url && !looksLikeSeparator(it.name) && !isHiddenChannel(it.name); })
          .map(function (it) { return Object.assign({}, it, { epgKey: it.tvgId || null, logo: it.tvgLogo, chno: it.tvgChno || '' }); });
      });
    }
    return ensureAllDirectItems().then(function (items) { return excludeHidden(excludeRadio(items)); });
  }

  function renderGuide(resetScroll) {
    var pl = state.playlist;
    var wrap = $id('guideWrap'), moreBtn = $id('plusGuide'), search = $id('rechGuide'), dayLabel = $id('guideDayLabel');

    if (!pl) {
      wrap.innerHTML = '';
      wrap.appendChild(el('div', 'hint', 'Choisis ou ajoute une playlist dans l’onglet Playlists.'));
      moreBtn.style.display = 'none';
      return;
    }

    kickEpg();

    var dayStartDate = new Date();
    dayStartDate.setHours(0, 0, 0, 0);
    var dayStart = dayStartDate.getTime() + state.guideDayOffset * DAY_MS;
    var dayEnd = dayStart + DAY_MS;
    dayLabel.textContent = state.guideDayOffset === 0
      ? 'Aujourd’hui · ' + new Date(dayStart).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
      : new Date(dayStart).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

    directChannels().then(function (all) {
      var q = search.value.trim().toLowerCase();
      var list = all.filter(function (it) { return matchesSearch(it, q); });
      setZapList(list);
      wrap.innerHTML = '';
      // Diagnostic brut temporaire, toujours affiché quel que soit l'état
      // (contrairement aux messages ci-dessous, chacun conditionnel à un
      // état précis) : sept correctifs successifs sur la détection EPG
      // sans que le moindre message n'apparaisse jamais côté utilisateur
      // — plus de suppositions, ces valeurs lèvent le doute directement.
      try {
        var dbgUrl = pl.type === 'm3u' ? ((state.m3uData && state.m3uData.epgUrl) || pl.epgUrl) : Xtream.xmltvUrl(xtreamCfg(pl));
        wrap.appendChild(el('div', 'hint',
          '🔧 debug — url=' + (dbgUrl || 'aucune') +
          ' · m3uData=' + (state.m3uData ? 'oui' : 'non') +
          ' · epgLoading=' + state.epgLoading +
          ' · epgError=' + (state.epgError || 'aucune') +
          ' · epgMap=' + (state.epgMap ? Object.keys(state.epgMap).length + ' entrée(s)' : 'non chargé') +
          ' · epgDebug=' + (state.epgDebug ? JSON.stringify(state.epgDebug) : 'aucun')));
      } catch (dbgErr) {
        wrap.appendChild(el('div', 'hint', '🔧 debug erreur : ' + dbgErr.message));
      }
      if (state.epgError) {
        wrap.appendChild(el('div', 'hint', '⚠️ ' + state.epgError + ' — les chaînes restent utilisables, sans programme affiché.'));
      } else if (state.epgDebug && state.epgMap) {
        // Diagnostic : le chargement peut réussir (pas d'erreur) tout en
        // ne contenant aucun programme exploitable pour CES chaînes
        // précisément (identifiants/noms qui ne concordent pas avec la
        // source EPG) — sans ce chiffre, indiscernable d'un guide qui n'a
        // simplement pas encore chargé.
        var matched = list.filter(function (it) { return (Epg.progsFor(state.epgMap, it.epgKey, it.name) || []).length > 0; }).length;
        if (matched === 0 && list.length > 0) {
          wrap.appendChild(el('div', 'hint',
            'ℹ️ Guide chargé (' + state.epgDebug.channelCount + ' chaîne(s) dans le flux EPG) mais aucun programme ne correspond à tes ' +
            list.length + ' chaîne(s) — identifiants/noms différents entre la playlist et la source EPG.'));
        }
      }
      if (!list.length) {
        wrap.appendChild(el('div', 'hint', state.epgLoading ? 'Chargement du guide…' : 'Aucun résultat.'));
        moreBtn.style.display = 'none';
        return;
      }

      var shown = state.shown.guide;
      var now = Date.now();
      var grid = el('div', 'guide-grid');

      var corner = el('div', 'guide-corner');
      grid.appendChild(corner);

      var hoursHeader = el('div', 'guide-hours');
      for (var h = 0; h < 24; h++) {
        var tick = el('div', 'guide-hour-tick', (h < 10 ? '0' + h : h) + 'h');
        tick.style.left = (h * 60 * PX_PER_MIN) + 'px';
        tick.style.width = (60 * PX_PER_MIN) + 'px';
        hoursHeader.appendChild(tick);
      }
      grid.appendChild(hoursHeader);

      list.slice(0, shown).forEach(function (item) {
        var chan = el('div', 'guide-chan');
        if (item.logo) {
          var img = document.createElement('img');
          img.loading = 'lazy'; img.src = item.logo; img.alt = '';
          img.onerror = function () { img.remove(); };
          chan.appendChild(img);
        }
        chan.appendChild(el('span', null, item.name));
        chan.addEventListener('click', function () { Player.open(item.url, item.name, { live: true, epgKey: item.epgKey, logo: item.logo }); });
        grid.appendChild(makeFocusable(chan));

        var timeline = el('div', 'guide-timeline');
        var progs = Epg.progsFor(state.epgMap, item.epgKey, item.name) || [];
        var visible = progs.filter(function (p) { return p.start != null && p.stop != null && p.stop > dayStart && p.start < dayEnd; });
        if (!visible.length) {
          timeline.appendChild(el('div', 'guide-empty', 'Pas de programme disponible'));
        } else {
          visible.forEach(function (p) {
            var s = Math.max(p.start, dayStart), e = Math.min(p.stop, dayEnd);
            var isNow = now >= p.start && now < p.stop;
            var block = el('div', 'guide-prog' + (isNow ? ' now' : ''), p.titre || '(sans titre)');
            block.style.left = ((s - dayStart) / 60000 * PX_PER_MIN) + 'px';
            block.style.width = Math.max(28, (e - s) / 60000 * PX_PER_MIN) + 'px';
            block.title = p.titre || '';
            block.addEventListener('click', function () { Player.open(item.url, item.name, { live: true, epgKey: item.epgKey, logo: item.logo }); });
            if (p.start > now && Recorder.isAvailable()) {
              var schedBtn = el('button', 'guide-rec-btn', '⏺');
              schedBtn.title = 'Programmer l’enregistrement';
              schedBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                Recorder.schedule({ url: item.url, name: p.titre || item.name, key: item.epgKey },
                  p.start, p.stop).then(function () {
                  toast('« ' + (p.titre || item.name) + ' » programmé.');
                }).catch(function (err) { toast('Programmation impossible : ' + err.message); });
              });
              block.appendChild(schedBtn);
            }
            timeline.appendChild(makeFocusable(block));
          });
        }
        grid.appendChild(timeline);
      });

      if (now >= dayStart && now < dayEnd) {
        var nowLine = el('div', 'guide-nowline');
        nowLine.style.left = (120 + (now - dayStart) / 60000 * PX_PER_MIN) + 'px';
        grid.appendChild(nowLine);
      }

      wrap.appendChild(grid);
      moreBtn.style.display = list.length > shown ? '' : 'none';

      if (resetScroll) {
        wrap.scrollLeft = state.guideDayOffset === 0 ? Math.max(0, (now - dayStart) / 60000 * PX_PER_MIN - 80) : 0;
        wrap.scrollTop = 0;
      }
    }).catch(function (err) {
      wrap.innerHTML = '';
      wrap.appendChild(el('div', 'hint', 'Impossible de charger les chaînes : ' + err.message));
      moreBtn.style.display = 'none';
    });
  }

  $id('rechGuide').addEventListener('input', function () { state.shown.guide = GUIDE_PAGE; renderGuide(false); });
  $id('plusGuide').addEventListener('click', function () { state.shown.guide += GUIDE_PAGE; renderGuide(false); });
  $id('guidePrevDay').addEventListener('click', function () { state.guideDayOffset--; state.shown.guide = GUIDE_PAGE; renderGuide(true); });
  $id('guideNextDay').addEventListener('click', function () { state.guideDayOffset++; state.shown.guide = GUIDE_PAGE; renderGuide(true); });
  $id('guideDayLabel').addEventListener('click', function () {
    if (state.guideDayOffset === 0) return;
    state.guideDayOffset = 0; state.shown.guide = GUIDE_PAGE; renderGuide(true);
  });

  // ---------- détail d'une série ----------
  // Chaque saison est un <details> replié par défaut : évite d'afficher
  // d'un coup la liste complète des épisodes de toutes les saisons.
  function seasonSection(label) {
    var det = document.createElement('details');
    det.className = 'saison';
    var sum = document.createElement('summary');
    sum.className = 'saison-titre';
    sum.textContent = label;
    det.appendChild(sum);
    var wrap = el('div', 'episodes');
    det.appendChild(wrap);
    return { det: det, wrap: wrap };
  }

  function openSerieM3u(serie) {
    showSerieShell(serie.name, serie.logo, function (body) {
      Object.keys(serie.saisons).sort(function (a, b) { return a - b; }).forEach(function (n) {
        var episodes = serie.saisons[n].sort(function (a, b) { return a.episode - b.episode; });
        var sec = seasonSection('Saison ' + n + ' · ' + episodes.length + ' épisode' + (episodes.length > 1 ? 's' : ''));
        episodes.forEach(function (ep) {
          sec.wrap.appendChild(episodeRow('Épisode ' + ep.episode + (ep.name && ep.name !== serie.name ? ' — ' + ep.name : ''), function () {
            Player.open(ep.url, serie.name + ' · S' + n + 'E' + ep.episode);
          }));
        });
        body.appendChild(sec.det);
      });
    });
  }

  function openSerieXtream(serie) {
    var pl = state.playlist, cfg = xtreamCfg(pl);
    showSerieShell(serie.name, serie.logo, function (body) {
      body.appendChild(el('div', 'hint', 'Chargement des saisons…'));
      Xtream.seriesInfo(cfg, serie.seriesId).then(function (info) {
        body.innerHTML = '';
        var episodes = (info && info.episodes) || {};
        var seasons = Object.keys(episodes).sort(function (a, b) { return a - b; });
        if (!seasons.length) { body.appendChild(el('div', 'hint', 'Aucun épisode disponible.')); return; }
        seasons.forEach(function (n) {
          var eps = episodes[n];
          var sec = seasonSection('Saison ' + n + ' · ' + eps.length + ' épisode' + (eps.length > 1 ? 's' : ''));
          eps.forEach(function (ep) {
            var url = Xtream.streamUrl(cfg, 'series', ep.id, ep.container_extension || 'mp4');
            sec.wrap.appendChild(episodeRow('Épisode ' + (ep.episode_num || '?') + (ep.title ? ' — ' + ep.title : ''), function () {
              Player.open(url, serie.name + ' · S' + n + 'E' + (ep.episode_num || '?'));
            }));
          });
          body.appendChild(sec.det);
        });
      }).catch(function (err) { body.innerHTML = ''; body.appendChild(el('div', 'hint', 'Erreur : ' + err.message)); });
    });
  }

  function episodeRow(label, onClick) {
    var row = el('button', 'episode-row');
    row.appendChild(el('span', null, label));
    row.appendChild(el('span', 'ep-play', '▶'));
    row.addEventListener('click', onClick);
    return row;
  }

  function showSerieShell(nom, logo, fill) {
    $id('seriesRacine').style.display = 'none';
    var det = $id('serieDetail');
    det.style.display = '';
    det.innerHTML = '';
    var back = el('button', 'ghost', '← Séries');
    back.style.marginBottom = '10px';
    back.addEventListener('click', function () { det.style.display = 'none'; $id('seriesRacine').style.display = ''; });
    det.appendChild(back);
    var head = el('div', 'card');
    head.appendChild(el('h2', null, nom));
    det.appendChild(head);
    var body = el('div');
    det.appendChild(body);
    fill(body);
  }

  // ---------- détail d'un film ----------
  function showFilmShell(fill) {
    $id('filmsRacine').style.display = 'none';
    var det = $id('filmDetail');
    det.style.display = '';
    det.innerHTML = '';
    var back = el('button', 'ghost', '← Films');
    back.style.marginBottom = '10px';
    back.addEventListener('click', function () { det.style.display = 'none'; $id('filmsRacine').style.display = ''; });
    det.appendChild(back);
    fill(det);
  }

  // Affiche, descriptif et âge : uniquement disponibles pour les comptes
  // Xtream Codes (get_vod_info) — une playlist M3U ne transporte aucune de
  // ces métadonnées, seulement logo/nom/groupe.
  function renderFilmDetails(container, item, info) {
    var wrap = el('div', 'film-detail');
    var poster = info.cover_big || info.movie_image || item.logo;
    if (poster) {
      var img = document.createElement('img');
      img.className = 'film-poster';
      img.loading = 'lazy';
      img.src = poster;
      img.alt = '';
      img.onerror = function () { img.remove(); };
      wrap.appendChild(img);
    }

    var col = el('div', 'film-info');
    col.appendChild(el('h2', 'film-titre', item.name));

    var badges = el('div', 'film-badges');
    var age = info.age || info.mpaa_rating;
    if (age) badges.appendChild(el('span', 'film-badge film-badge-age', '🔞 ' + age));
    var rating = parseFloat(info.rating);
    if (rating > 0) badges.appendChild(el('span', 'film-badge', '★ ' + rating.toFixed(1)));
    if (info.duration) badges.appendChild(el('span', 'film-badge', '⏱ ' + info.duration));
    var year = String(info.releasedate || info.release_date || '').slice(0, 4);
    if (/^\d{4}$/.test(year)) badges.appendChild(el('span', 'film-badge', year));
    if (info.genre) badges.appendChild(el('span', 'film-badge', info.genre));
    if (badges.children.length) col.appendChild(badges);

    var plot = info.plot || info.description;
    col.appendChild(el('p', 'film-plot', plot || 'Aucun descriptif fourni par le fournisseur pour ce contenu.'));

    var hasVersions = item.versions && item.versions.length > 1;
    var playBtn = el('button', 'primary', hasVersions ? '▶ Regarder (' + item.versions.length + ' sources)' : '▶ Regarder');
    playBtn.addEventListener('click', function () {
      if (hasVersions) { showVersionPicker(item, false); return; }
      Player.open(item.url, item.name);
    });
    col.appendChild(playBtn);

    wrap.appendChild(col);
    container.appendChild(wrap);
  }

  // Complète (sans jamais écraser) ce que le fournisseur IPTV a déjà donné :
  // affiche, descriptif, âge — les trois infos les plus souvent absentes
  // d'une playlist M3U ou d'un catalogue Xtream peu renseigné. Facultatif,
  // seulement si une clé TMDB est enregistrée (voir l'onglet Infos).
  function needsEnrichment(info) {
    return !(info.cover_big || info.movie_image) || !(info.plot || info.description) || !(info.age || info.mpaa_rating);
  }

  function applyTmdb(info, extra) {
    if (!extra) return info;
    var merged = Object.assign({}, info);
    if (!merged.cover_big && !merged.movie_image) merged.cover_big = extra.cover_big;
    if (!merged.plot && !merged.description) merged.plot = extra.plot;
    if (!merged.age && !merged.mpaa_rating) merged.age = extra.age;
    if (!merged.rating) merged.rating = extra.rating;
    if (!merged.duration) merged.duration = extra.duration;
    if (!merged.genre) merged.genre = extra.genre;
    if (!merged.releasedate && !merged.release_date) merged.releasedate = extra.releasedate;
    return merged;
  }

  function enrichIfNeeded(info, name) {
    if (!Tmdb.hasKey() || !needsEnrichment(info)) return Promise.resolve(info);
    return Tmdb.enrich(name).then(function (extra) { return applyTmdb(info, extra); });
  }

  function openFilmXtream(item) {
    var pl = state.playlist, cfg = xtreamCfg(pl);
    showFilmShell(function (det) {
      var loading = el('div', 'hint', 'Chargement…');
      det.appendChild(loading);
      Xtream.vodInfo(cfg, item.streamId).then(function (data) {
        return (data && data.info) || {};
      }).catch(function () {
        return {};
      }).then(function (info) {
        return enrichIfNeeded(info, item.name);
      }).then(function (info) {
        loading.remove();
        renderFilmDetails(det, item, info);
      });
    });
  }

  function openFilmSimple(item) {
    showFilmShell(function (det) {
      var loading = el('div', 'hint', 'Chargement…');
      det.appendChild(loading);
      // Ne préremplit pas le genre avec groupTitle avant l'enrichissement,
      // sinon ça bloquerait le genre TMDB (plus précis qu'une simple
      // catégorie de playlist) ; groupTitle ne sert qu'en dernier recours.
      enrichIfNeeded({}, item.name).then(function (info) {
        loading.remove();
        if (!info.genre) info = Object.assign({}, info, { genre: item.groupTitle || item.group });
        renderFilmDetails(det, item, info);
      });
    });
  }

  function openFilm(item) {
    goTab('films');
    if (item.streamId != null) openFilmXtream(item); else openFilmSimple(item);
  }

  // ---------- enregistrements (DVR, APK Android uniquement) ----------
  function formatDateTime(ms) {
    return new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function formatBytes(n) {
    if (!n) return '';
    var units = ['o', 'Ko', 'Mo', 'Go'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + units[i];
  }

  function renderEnregistrements() {
    var dispo = Recorder.isAvailable();
    $id('enregNonDispo').style.display = dispo ? 'none' : '';
    $id('enregDispo').style.display = dispo ? '' : 'none';
    if (!dispo) return;

    Recorder.listScheduled().then(function (items) {
      var container = $id('listeProgrammes');
      container.innerHTML = '';
      if (!items.length) { container.appendChild(el('div', 'hint', 'Aucun enregistrement programmé.')); return; }
      items.sort(function (a, b) { return a.startAtMs - b.startAtMs; }).forEach(function (it) {
        var row = el('div', 'projet');
        var left = el('div'); left.style.flex = '1';
        left.appendChild(el('div', 'p-nom', it.title));
        left.appendChild(el('div', 'p-sub', formatDateTime(it.startAtMs) + ' → ' + formatDateTime(it.endAtMs)));
        row.appendChild(left);
        var del = el('button', null, '🗑️');
        del.title = 'Annuler';
        del.addEventListener('click', function () { Recorder.cancelScheduled(it.id).then(renderEnregistrements); });
        row.appendChild(del);
        container.appendChild(row);
      });
    });

    Recorder.listRecordings().then(function (items) {
      var container = $id('listeEnregistrements');
      container.innerHTML = '';
      if (!items.length) { container.appendChild(el('div', 'hint', 'Aucun enregistrement pour le moment.')); return; }
      items.sort(function (a, b) { return (b.startedAtMs || 0) - (a.startedAtMs || 0); }).forEach(function (it) {
        var row = el('div', 'projet');
        var left = el('div'); left.style.flex = '1';
        left.appendChild(el('div', 'p-nom', it.title));
        var statusLabel = it.status === 'recording' ? '⏺ en cours…'
          : it.status === 'error' ? '❌ échec' + (it.error ? ' — ' + it.error : '')
          : it.status === 'stopped' ? '⏹ arrêté'
          : '✅ terminé';
        var sub = formatDateTime(it.startedAtMs) + ' · ' + statusLabel + (it.sizeBytes ? ' · ' + formatBytes(it.sizeBytes) : '');
        left.appendChild(el('div', 'p-sub', sub));
        row.appendChild(left);
        if (it.status !== 'recording' && it.filePath) {
          var play = el('button', null, '▶️');
          play.title = 'Lire';
          play.addEventListener('click', function () { Player.open(Recorder.playableUrl(it.filePath), it.title); });
          row.appendChild(play);
        }
        var del = el('button', null, '🗑️');
        del.title = 'Supprimer';
        del.addEventListener('click', function () {
          askConfirm('Supprimer l’enregistrement « ' + it.title + ' » ?').then(function (ok) {
            if (!ok) return;
            Recorder.deleteRecording(it.id).then(renderEnregistrements);
          });
        });
        row.appendChild(del);
        container.appendChild(row);
      });
    });
  }

  // ---------- favoris ----------
  function renderFavoris() {
    var container = $id('listeFavoris');
    var favs = Store.getFavoris().filter(function (item) { return !isHiddenChannel(item.name); });
    container.innerHTML = '';
    if (!favs.length) { container.appendChild(el('div', 'hint', 'Aucun favori pour le moment — touche ☆ sur une chaîne, un film ou un épisode.')); return; }
    favs.forEach(function (item) {
      var isFilm = item.kind === 'films' || item.kind === 'vod';
      container.appendChild(card(item, isFilm ? { onOpen: openFilm } : {}));
    });
  }

  // ---------- accueil ----------
  function renderAccueil() {
    var container = $id('accueil');
    container.innerHTML = '';
    var playlists = Store.getPlaylists();
    if (!playlists.length) {
      var c = el('div', 'card');
      c.appendChild(el('h2', null, 'Bienvenue'));
      c.appendChild(el('p', 'hint', 'Ajoute une playlist M3U ou un compte Xtream Codes pour commencer.'));
      var btn = el('button', 'primary', '🗂️ Ajouter une playlist');
      btn.addEventListener('click', function () { goTab('reglages'); });
      c.appendChild(btn);
      container.appendChild(c);
      return;
    }
    var card1 = el('div', 'card');
    card1.appendChild(el('h2', null, 'Playlist active'));
    if (playlists.length > 1) {
      var sel = document.createElement('select');
      sel.className = 'wide';
      playlists.forEach(function (p) {
        var o = document.createElement('option');
        o.value = p.id; o.textContent = p.nom + ' (' + (p.type === 'xtream' ? 'Xtream' : 'M3U') + ')';
        if (state.playlist && p.id === state.playlist.id) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () { setActivePlaylist(sel.value); renderAccueil(); });
      card1.appendChild(sel);
    } else {
      card1.appendChild(el('p', 'hint', state.playlist ? state.playlist.nom : ''));
    }
    container.appendChild(card1);

    var card2 = el('div', 'card');
    card2.appendChild(el('h2', null, 'Accès rapide'));
    var row = el('div', 'projets-home');
    [['direct', '📺', 'En direct'], ['films', '🎬', 'Films'], ['series', '🎞️', 'Séries']].forEach(function (t) {
      var b = el('button', 'projet-home');
      b.appendChild(el('span', 'ph-ico', t[1]));
      var txt = el('span', 'ph-txt'); txt.appendChild(el('span', 'ph-nom', t[2]));
      b.appendChild(txt);
      b.appendChild(el('span', 'ph-fleche', '›'));
      b.addEventListener('click', function () { goTab(t[0]); });
      row.appendChild(b);
    });
    card2.appendChild(row);
    container.appendChild(card2);

    var favCount = Store.getFavoris().length;
    var card3 = el('div', 'card');
    card3.appendChild(el('h2', null, 'Favoris'));
    card3.appendChild(el('p', 'hint', favCount ? favCount + ' chaîne(s)/film(s) en favoris.' : 'Aucun favori pour le moment.'));
    container.appendChild(card3);
  }

  // ---------- playlists : liste + formulaire ----------
  function renderPlaylists() {
    var container = $id('playlists');
    var playlists = Store.getPlaylists();
    container.innerHTML = '';
    if (!playlists.length) { container.appendChild(el('div', 'hint', 'Aucune playlist enregistrée.')); return; }
    var activeId = Store.getActivePlaylistId();
    playlists.forEach(function (p) {
      var row = el('div', 'projet');
      var nom = el('div', 'p-nom', p.nom + (p.id === activeId ? ' ✓' : ''));
      var sub = el('div', 'p-sub', p.type === 'xtream' ? 'Xtream · ' + p.serveur : 'M3U' + (p.m3uUpload ? ' (fichier importé)' : ''));
      var left = el('div'); left.style.flex = '1'; left.appendChild(nom); left.appendChild(sub);
      row.appendChild(left);
      if (p.id !== activeId) {
        var use = el('button', null, '▶️');
        use.title = 'Utiliser cette playlist';
        use.addEventListener('click', function () { setActivePlaylist(p.id); renderPlaylists(); toast('Playlist active : ' + p.nom); });
        row.appendChild(use);
      } else {
        var refresh = el('button', null, '🔄');
        refresh.title = 'Actualiser (recharger les chaînes/films/séries depuis le fournisseur)';
        refresh.addEventListener('click', function () { refreshActivePlaylist(); });
        row.appendChild(refresh);
      }
      var del = el('button', null, '🗑️');
      del.title = 'Supprimer';
      del.addEventListener('click', function () {
        askConfirm('Supprimer la playlist « ' + p.nom + ' » ?').then(function (ok) {
          if (!ok) return;
          Store.removePlaylist(p.id);
          if (Store.getActivePlaylistId()) setActivePlaylist(Store.getActivePlaylistId()); else { state.playlist = null; updateHeader(); }
          renderPlaylists();
        });
      });
      row.appendChild(del);
      container.appendChild(row);
    });
  }

  $id('pl_type').addEventListener('change', function () {
    var isM3u = $id('pl_type').value === 'm3u';
    $id('formM3u').style.display = isM3u ? '' : 'none';
    $id('formXtream').style.display = isM3u ? 'none' : '';
  });

  function buildPlaylistDraft() {
    var type = $id('pl_type').value;
    var nom = $id('pl_nom').value.trim() || (type === 'xtream' ? 'Compte Xtream' : 'Playlist M3U');
    if (type === 'xtream') {
      var serveur = $id('pl_serveur').value.trim();
      var user = $id('pl_user').value.trim();
      var pass = $id('pl_pass').value.trim();
      if (!serveur || !user || !pass) return { error: 'Renseigne le serveur, l’utilisateur et le mot de passe.' };
      return { draft: { nom: nom, type: 'xtream', serveur: serveur, utilisateur: user, motDePasse: pass } };
    }
    var url = $id('pl_m3uUrl').value.trim();
    var file = $id('pl_m3uFile').files[0];
    var epgUrl = $id('pl_epgUrl').value.trim() || null;
    if (!url && !file) return { error: 'Indique une URL de playlist ou importe un fichier.' };
    return { draft: { nom: nom, type: 'm3u', m3uUrl: url || null, epgUrl: epgUrl, _file: file } };
  }

  $id('btnTester').addEventListener('click', function () {
    var res = buildPlaylistDraft();
    var out = $id('testResult');
    if (res.error) { out.textContent = res.error; return; }
    out.textContent = 'Test en cours…';
    if (res.draft.type === 'xtream') {
      Xtream.auth(xtreamCfg({ serveur: res.draft.serveur, utilisateur: res.draft.utilisateur, motDePasse: res.draft.motDePasse }))
        .then(function (r) {
          var ok = r && r.user_info && String(r.user_info.auth) === '1';
          out.textContent = ok ? '✅ Connexion réussie' + (r.user_info.exp_date ? ' — abonnement jusqu’au ' + new Date(r.user_info.exp_date * 1000).toLocaleDateString() : '') : '❌ Identifiants refusés par le serveur.';
        }).catch(function (err) { out.textContent = '❌ Connexion impossible : ' + err.message; });
    } else if (res.draft._file) {
      res.draft._file.text().then(function (text) {
        var parsed = M3U.parse(text);
        out.textContent = '✅ Fichier lu — ' + parsed.items.length + ' entrée(s) trouvée(s).';
      }).catch(function (err) { out.textContent = '❌ Fichier illisible : ' + err.message; });
    } else {
      Net.fetchText(res.draft.m3uUrl)
        .then(function (text) { var parsed = M3U.parse(text); out.textContent = '✅ Playlist lue — ' + parsed.items.length + ' entrée(s) trouvée(s).'; })
        .catch(function (err) { out.textContent = '❌ Impossible de charger la playlist : ' + err.message + ' (le serveur bloque peut-être les requêtes navigateur — CORS).'; });
    }
  });

  $id('btnAjouterPlaylist').addEventListener('click', function () {
    var res = buildPlaylistDraft();
    if (res.error) { toast(res.error); return; }
    var draft = res.draft;
    var file = draft._file; delete draft._file;
    var saved = Store.addPlaylist(draft);
    var finish = function () {
      $id('pl_nom').value = ''; $id('pl_serveur').value = ''; $id('pl_user').value = ''; $id('pl_pass').value = '';
      $id('pl_m3uUrl').value = ''; $id('pl_m3uFile').value = ''; $id('pl_epgUrl').value = ''; $id('testResult').textContent = '';
      setActivePlaylist(saved.id);
      renderPlaylists();
      toast('Playlist « ' + saved.nom + ' » ajoutée');
      goTab('accueil');
    };
    if (file) {
      file.text().then(function (text) {
        Store.rawSet(saved.id, text);
        Store.updatePlaylist(saved.id, { m3uUpload: true });
        saved.m3uUpload = true;
        finish();
      }).catch(function (err) { toast('Fichier illisible : ' + err.message); });
    } else finish();
  });

  // ---------- réglage TMDB (fiches films) ----------
  $id('tmdbKeyInput').value = Store.getTmdbKey() || '';
  $id('btnSaveTmdb').addEventListener('click', function () {
    var v = $id('tmdbKeyInput').value.trim();
    Store.setTmdbKey(v);
    $id('tmdbStatus').textContent = v ? 'Clé enregistrée — les fiches films incomplètes seront complétées via TMDB.' : 'Clé supprimée — enrichissement TMDB désactivé.';
  });

  // ---------- réglage code PIN (bouquet adulte) ----------
  // Le champ n'est jamais prérempli avec le code existant (on ne le
  // réaffiche pas en clair) ; laisser vide et valider retire le code.
  $id('pinSettingStatus').textContent = Store.getParentalPin() ? 'Un code PIN est actuellement défini.' : 'Aucun code PIN défini — rien n’est masqué.';
  $id('btnSavePin').addEventListener('click', function () {
    var v = $id('pinSettingInput').value.trim();
    Store.setParentalPin(v);
    $id('pinSettingInput').value = '';
    state.unlockedAdult = {};
    $id('pinSettingStatus').textContent = v ? 'Code PIN enregistré.' : 'Code PIN retiré — rien n’est masqué.';
  });

  // ---------- démarrage ----------
  // Purge ponctuelle des favoris déjà enregistrés vers une chaîne masquée
  // (ex. "Welcome Ultimate...") : le masquage (isHiddenChannel) n'est
  // appliqué qu'à l'affichage des listes, pas aux favoris déjà mis en
  // mémoire avant l'ajout de ce filtre — sans ce nettoyage, l'étoile ☆
  // resterait cochée pour une chaîne qu'on ne peut plus jamais rouvrir
  // depuis Direct/Bouquets/Recherche pour la déselectionner soi-même.
  function pruneHiddenFavoris() {
    Store.getFavoris().forEach(function (f) { if (isHiddenChannel(f.name)) Store.toggleFavori(f); });
  }

  function init() {
    $id('verChip').textContent = 'v' + (window.APP_VERSION || '');
    $id('verText').textContent = window.APP_VERSION || '';
    pruneHiddenFavoris();
    var activeId = Store.getActivePlaylistId();
    if (activeId) { setActivePlaylist(activeId); refreshOnOpen(); }
    renderAccueil();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }
  init();
})();

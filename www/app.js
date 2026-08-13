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
    xtreamCats: { direct: null, films: null, series: null }, // [{id,label}]
    activeCategory: { direct: '', films: '', series: '' },
    shown: { direct: PAGE_SIZE, films: PAGE_SIZE, series: PAGE_SIZE, guide: GUIDE_PAGE },
    xtreamItems: { direct: null, films: null, series: null }, // chargés à la demande par catégorie
    directView: 'liste',   // 'liste' | 'mosaique'
    guideChannelsCache: null, // toutes les chaînes direct (Xtream), indépendant du filtre par catégorie
    guideDayOffset: 0
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
    else if (name === 'favoris') renderFavoris();
    else if (name === 'playlists') renderPlaylists();
  }
  document.getElementById('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (b) goTab(b.dataset.tab);
  });

  // ---------- chargement de la playlist active ----------
  function xtreamCfg(pl) { return { serveur: pl.serveur, utilisateur: pl.utilisateur, motDePasse: pl.motDePasse }; }

  function setActivePlaylist(id) {
    Store.setActivePlaylistId(id);
    state.playlist = Store.getPlaylists().find(function (p) { return p.id === id; }) || null;
    state.m3uData = null; state.epgMap = null; state.epgLoading = false;
    state.xtreamCats = { direct: null, films: null, series: null };
    state.xtreamItems = { direct: null, films: null, series: null };
    state.activeCategory = { direct: '', films: '', series: '' };
    state.shown = { direct: PAGE_SIZE, films: PAGE_SIZE, series: PAGE_SIZE, guide: GUIDE_PAGE };
    state.guideChannelsCache = null; state.guideDayOffset = 0;
    updateHeader();
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
      ? ((state.m3uData && state.m3uData.epgUrl) || pl.epgUrl)
      : Xtream.xmltvUrl(xtreamCfg(pl));
    if (!url) return;
    state.epgLoading = true;
    Epg.fetchXmltv(url).then(function (map) {
      state.epgMap = map; state.epgLoading = false;
      if (isTabActive('direct')) renderKind('direct');
      if (isTabActive('guide')) renderGuide(false);
    }).catch(function (err) { state.epgLoading = false; console.warn('EPG', err.message); });
  }

  function nowNextFor(item) {
    if (!item.epgKey || !state.epgMap) return null;
    return Epg.nowNext(state.epgMap, item.epgKey);
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
          return { key: 'xt:live:' + pl.id + ':' + s.stream_id, kind: 'direct', name: s.name,
            logo: s.stream_icon, group: catLabel[s.category_id] || '', url: Xtream.streamUrl(cfg, 'live', s.stream_id, 'm3u8'),
            streamId: s.stream_id, epgKey: String(s.stream_id) };
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
    if (!item.logo) thumb.textContent = iconFor(item.kind);
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
        if (isTabActive('favoris')) renderFavoris();
      });
      card.appendChild(star);
    }

    // item.kind vaut 'direct' (Xtream) ou 'live' (M3U, voir m3u.js
    // classifyGroup) selon la source — les deux désignent une chaîne en direct.
    card.addEventListener('click', function () { opts.onOpen ? opts.onOpen(item) : Player.open(item.url, item.name, { live: item.kind === 'direct' || item.kind === 'live' }); });
    return card;
  }

  function iconFor(kind) { return kind === 'films' ? '🎬' : kind === 'series' ? '🎞️' : '📺'; }

  // Titre de section (ex. "titre de section" au lieu de carte) : voir
  // looksLikeSeparator(name).
  function sectionTitle(name) {
    var clean = name.replace(/[-=#*_|~]+/g, ' ').replace(/\s+/g, ' ').trim();
    return el('div', 'carte-section', clean || name);
  }

  function renderList(container, moreBtn, items, shownKey, opts) {
    var shown = state.shown[shownKey];
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
    if (kindKey === 'direct') { container.classList.toggle('mosaique', state.directView === 'mosaique'); kickEpg(); }

    if (!pl) { container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Choisis ou ajoute une playlist dans l’onglet Playlists.')); moreBtn.style.display = 'none'; chips.innerHTML = ''; return; }

    if (pl.type === 'm3u') {
      var m3uKind = kindKey === 'direct' ? 'live' : kindKey === 'films' ? 'vod' : 'series';
      ensureM3uLoaded().then(function (data) {
        var pool = data.items.filter(function (it) { return it.kind === m3uKind; });
        var groups = uniqueSorted(pool.map(function (it) { return it.groupTitle; }));
        renderChips(chips, groups.map(function (g) { return { id: g, label: g }; }), kindKey, function (g) {
          state.activeCategory[kindKey] = g; state.shown[kindKey] = PAGE_SIZE; renderKind(kindKey);
        });
        var cat = state.activeCategory[kindKey];
        var q = search.value.trim().toLowerCase();
        if (kindKey === 'series') {
          var series = M3U.groupSeries(pool.filter(function (it) { return !cat || it.groupTitle === cat; }))
            .filter(function (s) { return matchesSearch({ name: s.nom }, q); });
          renderList(container, moreBtn, series.map(function (s) {
            return { key: 'serie:' + pl.id + ':' + s.nom, kind: 'series', name: s.nom, logo: s.logo, group: s.groupTitle, saisons: s.saisons };
          }), kindKey, { onOpen: openSerieM3u });
        } else {
          var items = pool.filter(function (it) { return (!cat || it.groupTitle === cat) && matchesSearch(it, q); })
            .map(function (it) {
              var withKey = Object.assign({}, it, { epgKey: it.tvgId || null, group: it.groupTitle });
              withKey._badge = epgBadge(withKey);
              return withKey;
            });
          renderList(container, moreBtn, items, kindKey, { onOpen: kindKey === 'films' ? openFilm : null });
          // (le badge EPG est déjà calculé par item ; on l'injecte après coup)
          Array.prototype.forEach.call(container.children, function (node, i) {
            var corps = items[i] && items[i]._badge && node.querySelector('.carte-corps');
            if (corps) corps.appendChild(items[i]._badge);
          });
        }
      }).catch(function (err) { container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Impossible de charger la playlist : ' + err.message)); moreBtn.style.display = 'none'; });
      return;
    }

    // Xtream
    ensureXtreamCats(kindKey).then(function (cats) {
      renderChips(chips, cats, kindKey, function (id) {
        state.activeCategory[kindKey] = id; state.shown[kindKey] = PAGE_SIZE; state.xtreamItems[kindKey] = null; renderKind(kindKey);
      });
      var catId = state.activeCategory[kindKey];
      var load = state.xtreamItems[kindKey] ? Promise.resolve(state.xtreamItems[kindKey]) : ensureXtreamItems(kindKey, catId);
      container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Chargement…'));
      load.then(function (items) {
        state.xtreamItems[kindKey] = items;
        var q = search.value.trim().toLowerCase();
        var filtered = items.filter(function (it) { return matchesSearch(it, q); });
        if (kindKey === 'direct') filtered = filtered.map(function (it) { var c = Object.assign({}, it); c._badge = epgBadge(c); return c; });
        renderList(container, moreBtn, filtered, kindKey, { onOpen: kindKey === 'series' ? openSerieXtream : kindKey === 'films' ? openFilm : null });
        if (kindKey === 'direct') {
          Array.prototype.forEach.call(container.children, function (node, i) {
            var corps = filtered[i] && filtered[i]._badge && node.querySelector('.carte-corps');
            if (corps) corps.appendChild(filtered[i]._badge);
          });
        }
      }).catch(function (err) { container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Connexion au serveur impossible : ' + err.message)); moreBtn.style.display = 'none'; });
    }).catch(function (err) { container.innerHTML = ''; container.appendChild(el('div', 'hint', 'Connexion au serveur impossible : ' + err.message)); moreBtn.style.display = 'none'; });
  }

  function uniqueSorted(arr) {
    var set = {}; arr.forEach(function (v) { if (v) set[v] = true; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b); });
  }

  $id('rechDirect').addEventListener('input', function () { state.shown.direct = PAGE_SIZE; renderKind('direct'); });
  $id('rechFilms').addEventListener('input', function () { state.shown.films = PAGE_SIZE; renderKind('films'); });
  $id('rechSeries').addEventListener('input', function () { state.shown.series = PAGE_SIZE; renderKind('series'); });
  $id('plusDirect').addEventListener('click', function () { state.shown.direct += PAGE_SIZE; renderKind('direct'); });
  $id('plusFilms').addEventListener('click', function () { state.shown.films += PAGE_SIZE; renderKind('films'); });
  $id('plusSeries').addEventListener('click', function () { state.shown.series += PAGE_SIZE; renderKind('series'); });

  $id('directViewToggle').addEventListener('click', function (e) {
    var b = e.target.closest('.view-btn');
    if (!b || b.classList.contains('active')) return;
    state.directView = b.dataset.view;
    Array.prototype.forEach.call(document.querySelectorAll('#directViewToggle .view-btn'), function (x) { x.classList.toggle('active', x === b); });
    renderKind('direct');
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
          .filter(function (it) { return it.kind === 'live' && it.url && !looksLikeSeparator(it.name); })
          .map(function (it) { return Object.assign({}, it, { epgKey: it.tvgId || null }); });
      });
    }
    if (state.guideChannelsCache) return Promise.resolve(state.guideChannelsCache);
    return ensureXtreamItems('direct', '').then(function (items) {
      state.guideChannelsCache = items;
      return items;
    });
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
      wrap.innerHTML = '';
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
        chan.addEventListener('click', function () { Player.open(item.url, item.name, { live: true }); });
        grid.appendChild(chan);

        var timeline = el('div', 'guide-timeline');
        var progs = (item.epgKey && state.epgMap && state.epgMap[item.epgKey]) || [];
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
            block.addEventListener('click', function () { Player.open(item.url, item.name, { live: true }); });
            timeline.appendChild(block);
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

    var playBtn = el('button', 'primary', '▶ Regarder');
    playBtn.addEventListener('click', function () { Player.open(item.url, item.name); });
    col.appendChild(playBtn);

    wrap.appendChild(col);
    container.appendChild(wrap);
  }

  function openFilmXtream(item) {
    var pl = state.playlist, cfg = xtreamCfg(pl);
    showFilmShell(function (det) {
      var loading = el('div', 'hint', 'Chargement…');
      det.appendChild(loading);
      Xtream.vodInfo(cfg, item.streamId).then(function (data) {
        loading.remove();
        renderFilmDetails(det, item, (data && data.info) || {});
      }).catch(function () {
        loading.remove();
        renderFilmDetails(det, item, {});
      });
    });
  }

  function openFilmSimple(item) {
    // Une playlist M3U ne transporte pas de genre à proprement parler ;
    // groupTitle (catégorie de la playlist) est la meilleure approximation.
    showFilmShell(function (det) { renderFilmDetails(det, item, { genre: item.groupTitle || item.group }); });
  }

  function openFilm(item) {
    goTab('films');
    if (item.streamId != null) openFilmXtream(item); else openFilmSimple(item);
  }

  // ---------- favoris ----------
  function renderFavoris() {
    var container = $id('listeFavoris');
    var favs = Store.getFavoris();
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
      btn.addEventListener('click', function () { goTab('playlists'); });
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
      }
      var del = el('button', null, '🗑️');
      del.title = 'Supprimer';
      del.addEventListener('click', function () {
        if (!confirm('Supprimer la playlist « ' + p.nom + ' » ?')) return;
        Store.removePlaylist(p.id);
        if (Store.getActivePlaylistId()) setActivePlaylist(Store.getActivePlaylistId()); else { state.playlist = null; updateHeader(); }
        renderPlaylists();
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

  // ---------- démarrage ----------
  function init() {
    $id('verChip').textContent = 'v' + (window.APP_VERSION || '');
    $id('verText').textContent = window.APP_VERSION || '';
    var activeId = Store.getActivePlaylistId();
    if (activeId) setActivePlaylist(activeId);
    renderAccueil();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }
  init();
})();

/* app.js — interface du Lecteur IPTV : onglets, playlists, grilles de
 * chaînes/films/séries, favoris, lecture. Toutes les données (playlists,
 * identifiants, favoris) restent en local (localStorage / IndexedDB). */
(function () {
  'use strict';

  var PAGE_SIZE = 60;

  var state = {
    playlist: null,
    m3uData: null,        // { epgUrl, items }
    epgMap: null,          // XMLTV : { channelId: [{start,stop,titre}] }
    xtreamCats: { direct: null, films: null, series: null }, // [{id,label}]
    activeCategory: { direct: '', films: '', series: '' },
    shown: { direct: PAGE_SIZE, films: PAGE_SIZE, series: PAGE_SIZE },
    xtreamItems: { direct: null, films: null, series: null } // chargés à la demande par catégorie
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
    else if (name === 'films') renderKind('films');
    else if (name === 'series') { $id('serieDetail').style.display = 'none'; $id('seriesRacine').style.display = ''; renderKind('series'); }
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
    state.m3uData = null; state.epgMap = null;
    state.xtreamCats = { direct: null, films: null, series: null };
    state.xtreamItems = { direct: null, films: null, series: null };
    state.activeCategory = { direct: '', films: '', series: '' };
    state.shown = { direct: PAGE_SIZE, films: PAGE_SIZE, series: PAGE_SIZE };
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
        : fetch(pl.m3uUrl).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
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

  function kickEpg() {
    var pl = state.playlist;
    var url = (state.m3uData && state.m3uData.epgUrl) || (pl && pl.epgUrl);
    if (!url || state.epgMap) return;
    Epg.fetchXmltv(url).then(function (map) { state.epgMap = map; if (isTabActive('direct')) renderKind('direct'); })
      .catch(function (err) { console.warn('EPG', err.message); });
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
            streamId: s.stream_id };
        }
        if (kindKey === 'films') {
          return { key: 'xt:vod:' + pl.id + ':' + s.stream_id, kind: 'films', name: s.name,
            logo: s.stream_icon, group: catLabel[s.category_id] || '', url: Xtream.streamUrl(cfg, 'vod', s.stream_id, s.container_extension || 'mp4') };
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
        var justAdded = Store.toggleFavori({ key: item.key, kind: item.kind, name: item.name, logo: item.logo, group: item.group, url: item.url });
        star.textContent = justAdded ? '★' : '☆';
        if (isTabActive('favoris')) renderFavoris();
      });
      card.appendChild(star);
    }

    card.addEventListener('click', function () { opts.onOpen ? opts.onOpen(item) : Player.open(item.url, item.name); });
    return card;
  }

  function iconFor(kind) { return kind === 'films' ? '🎬' : kind === 'series' ? '🎞️' : '📺'; }

  function renderList(container, moreBtn, items, shownKey, opts) {
    var shown = state.shown[shownKey];
    container.innerHTML = '';
    if (!items.length) {
      container.appendChild(el('div', 'hint', 'Aucun résultat.'));
      moreBtn.style.display = 'none';
      return;
    }
    items.slice(0, shown).forEach(function (item) { container.appendChild(card(item, opts)); });
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
              var epg = state.epgMap && it.tvgId ? Epg.nowNext(state.epgMap, it.tvgId) : null;
              var badge = null;
              if (epg && epg.now) { badge = el('div', 'carte-epg', '▶ ' + epg.now.titre + (epg.next ? ' · ensuite : ' + epg.next.titre : '')); }
              return Object.assign({}, it, { _badge: badge });
            });
          renderList(container, moreBtn, items, kindKey, { epgBadgeFn: null });
          // (le badge EPG est déjà calculé par item ; on l'injecte après coup)
          Array.prototype.forEach.call(container.children, function (node, i) {
            if (items[i] && items[i]._badge) node.querySelector('.carte-corps').appendChild(items[i]._badge);
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
        renderList(container, moreBtn, filtered, kindKey, { onOpen: kindKey === 'series' ? openSerieXtream : null });
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

  // ---------- détail d'une série ----------
  function openSerieM3u(serie) {
    showSerieShell(serie.name, serie.logo, function (body) {
      Object.keys(serie.saisons).sort(function (a, b) { return a - b; }).forEach(function (n) {
        body.appendChild(el('div', 'cat-title', 'Saison ' + n));
        var wrap = el('div', 'episodes');
        serie.saisons[n].sort(function (a, b) { return a.episode - b.episode; }).forEach(function (ep) {
          wrap.appendChild(episodeRow('Épisode ' + ep.episode + (ep.name && ep.name !== serie.name ? ' — ' + ep.name : ''), function () {
            Player.open(ep.url, serie.name + ' · S' + n + 'E' + ep.episode);
          }));
        });
        body.appendChild(wrap);
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
          body.appendChild(el('div', 'cat-title', 'Saison ' + n));
          var wrap = el('div', 'episodes');
          episodes[n].forEach(function (ep) {
            var url = Xtream.streamUrl(cfg, 'series', ep.id, ep.container_extension || 'mp4');
            wrap.appendChild(episodeRow('Épisode ' + (ep.episode_num || '?') + (ep.title ? ' — ' + ep.title : ''), function () {
              Player.open(url, serie.name + ' · S' + n + 'E' + (ep.episode_num || '?'));
            }));
          });
          body.appendChild(wrap);
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

  // ---------- favoris ----------
  function renderFavoris() {
    var container = $id('listeFavoris');
    var favs = Store.getFavoris();
    container.innerHTML = '';
    if (!favs.length) { container.appendChild(el('div', 'hint', 'Aucun favori pour le moment — touche ☆ sur une chaîne, un film ou un épisode.')); return; }
    favs.forEach(function (item) { container.appendChild(card(item)); });
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
      fetch(res.draft.m3uUrl).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
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

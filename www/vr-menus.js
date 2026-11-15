/* vr-menus.js — menus du cinéma VR (vr.html), sortis d'app.js.
 *
 * La page VR tourne dans une AUTRE fenêtre, de même origine : elle appelle
 * ces fonctions directement par window.opener (window.AppZap), au lieu de
 * recevoir une copie du catalogue. C'est ce qui évite de charger des
 * dizaines de milliers d'entrées dans la mémoire du casque — seule la page
 * affichée traverse, une douzaine de lignes à la fois. Et le filtrage reste
 * celui de l'application : aucune logique dupliquée qui finirait par
 * diverger.
 *
 * (Une copie complète, elle, aurait aussi buté sur un détail du navigateur :
 * une fenêtre ouverte par window.open ne reçoit qu'un INSTANTANÉ figé du
 * sessionStorage de celle qui l'ouvre. Rien de ce qu'on y écrit ensuite ne
 * lui parvient — or le catalogue arrive après, il demande une requête.)
 *
 * VrMenus.creer(app) : app fournit l'accès à l'application — playlist(),
 * ensureM3uLoaded, ensureXtreamCats, ensureXtreamItems, xtreamCfg,
 * zapFavoris, looksLikeSeparator. Rend vrIndex, vrPage, vrFavoris,
 * vrRadios, vrSeries, vrEpisodes, rattachés à window.AppZap par app.js.
 */
(function (global) {
  'use strict';

  function creer(app) {
    var M3U = global.M3U, Xtream = global.Xtream, Catalogue = global.Catalogue;
    var isHiddenChannel = Catalogue.isHiddenChannel, DEFAULT_RADIOS = Catalogue.DEFAULT_RADIOS;
    var ensureM3uLoaded = app.ensureM3uLoaded, ensureXtreamCats = app.ensureXtreamCats,
      ensureXtreamItems = app.ensureXtreamItems, xtreamCfg = app.xtreamCfg, zapFavoris = app.zapFavoris,
      looksLikeSeparator = app.looksLikeSeparator;

    // La page VR tourne dans une AUTRE fenêtre, de même origine : elle appelle
    // donc ces fonctions directement par window.opener, au lieu de recevoir une
    // copie du catalogue. C'est ce qui évite de charger des dizaines de milliers
    // d'entrées dans la mémoire du casque — seule la page affichée traverse, une
    // douzaine de lignes à la fois. Et le filtrage reste celui de l'application :
    // aucune logique dupliquée qui finirait par diverger.
    //
    // (Une copie complète, elle, aurait aussi buté sur un détail du navigateur :
    // une fenêtre ouverte par window.open ne reçoit qu'un INSTANTANÉ figé du
    // sessionStorage de celle qui l'ouvre. Rien de ce qu'on y écrit ensuite ne
    // lui parvient — or le catalogue arrive après, il demande une requête.)
    var VR_PAGE_MAX = 40;

    function vrPool(kind, catId) {
      var pl = app.playlist();
      if (!pl) return Promise.resolve([]);
      if (pl.type === 'm3u') {
        var m3uKind = kind === 'films' ? 'vod' : kind === 'radio' ? 'radio' : kind === 'series' ? 'series' : 'live';
        return ensureM3uLoaded().then(function (data) {
          return (data.items || []).filter(function (it) {
            return it.kind === m3uKind && it.url && !looksLikeSeparator(it.name) && !isHiddenChannel(it.name);
          }).map(function (it) {
            return { name: it.name, url: it.url, logo: it.tvgLogo || null, chno: it.tvgChno || '',
              epgKey: it.tvgId || null, group: it.groupTitle || 'Sans groupe' };
          });
        });
      }
      // Xtream : une catégorie à la fois, comme le fait déjà l'onglet En direct.
      // Demander « tout » ferait justement ce qu'on cherche à éviter.
      var xtKind = kind === 'radio' ? 'direct' : kind;
      return ensureXtreamCats(xtKind).then(function () {
        return ensureXtreamItems(xtKind, catId || '');
      }).then(function (items) {
        return items.filter(function (it) {
          if (isHiddenChannel(it.name)) return false;
          if (kind === 'radio') return it.kind === 'radio' && it.url;
          return it.url && it.kind !== 'radio';
        }).map(function (it) {
          return { name: it.name, url: it.url, logo: it.logo || null, chno: it.chno || '',
            epgKey: it.epgKey || null, group: it.group || '' };
        });
      });
    }

    function vrEntrees(item) {
      return { name: item.name, url: item.url, logo: item.logo || null,
        chno: item.chno || '', epgKey: item.epgKey || null };
    }

    return {
      // Bouquets/catégories d'un type, sans leur contenu : quelques centaines de
      // libellés au maximum, c'est tout ce qu'il faut pour dresser un menu.
      vrIndex: function (kind) {
        var pl = app.playlist();
        if (!pl) return Promise.resolve([]);
        if (kind === 'radio') return Promise.resolve([]);   // pas de bouquets : une seule liste
        if (pl.type === 'm3u') {
          return vrPool(kind).then(function (pool) {
            var compte = {}, ordre = [];
            pool.forEach(function (it) {
              var g = it.group || 'Sans groupe';
              if (compte[g] === undefined) { compte[g] = 0; ordre.push(g); }
              compte[g]++;
            });
            return ordre.map(function (g) {
              return { id: g, label: g, count: kind === 'series' ? null : compte[g] };
            });
          });
        }
        return ensureXtreamCats(kind).then(function (cats) {
          return (cats || [])
            .filter(function (c) { return kind !== 'direct' || !/radio/i.test(c.label || ''); })
            // Le nombre d'entrées d'une catégorie Xtream n'est connu qu'en la
            // chargeant : on ne l'affiche pas plutôt que de tout télécharger.
            .map(function (c) { return { id: c.id, label: c.label, count: null }; });
        });
      },
      // Une page d'entrées d'un bouquet. `limit` est plafonné : le casque ne doit
      // jamais recevoir plus que ce qu'il affiche.
      vrPage: function (kind, catId, offset, limit) {
        var n = Math.min(VR_PAGE_MAX, Math.max(1, limit || 12));
        var d = Math.max(0, offset || 0);
        return vrPool(kind, catId).then(function (pool) {
          var filtre = pool;
          if (catId && app.playlist() && app.playlist().type === 'm3u') {
            filtre = pool.filter(function (it) { return (it.group || 'Sans groupe') === catId; });
          }
          return { total: filtre.length, items: filtre.slice(d, d + n).map(vrEntrees) };
        });
      },
      vrFavoris: function () { return zapFavoris().map(vrEntrees); },
      // Radio : les stations de la playlist plus celles fournies par défaut,
      // exactement comme l'onglet Radio. Assez courtes pour tenir d'un bloc.
      vrRadios: function () {
        return vrPool('radio').then(function (pool) {
          return pool.concat(DEFAULT_RADIOS).map(vrEntrees);
        }).catch(function () { return DEFAULT_RADIOS.map(vrEntrees); });
      },
      // Séries : une liste de séries n'a pas d'URL — il faut d'abord résoudre
      // ses épisodes, ce qui demande une requête de plus chez Xtream. D'où deux
      // étapes, et jamais le catalogue entier d'un coup.
      vrSeries: function (catId, offset, limit) {
        var pl = app.playlist();
        if (!pl) return Promise.resolve({ total: 0, items: [] });
        var n = Math.min(VR_PAGE_MAX, Math.max(1, limit || 10));
        var d = Math.max(0, offset || 0);
        if (pl.type === 'm3u') {
          return ensureM3uLoaded().then(function (data) {
            var pool = (data.items || []).filter(function (it) {
              return it.kind === 'series' && (!catId || it.groupTitle === catId);
            });
            var series = M3U.groupSeries(pool);
            return {
              total: series.length,
              items: series.slice(d, d + n).map(function (se) {
                return { name: se.nom, serie: se.nom, logo: se.logo || null, estSerie: true };
              })
            };
          });
        }
        return ensureXtreamCats('series').then(function () {
          return ensureXtreamItems('series', catId || '');
        }).then(function (items) {
          var utiles = items.filter(function (it) { return it.seriesId && !isHiddenChannel(it.name); });
          return {
            total: utiles.length,
            items: utiles.slice(d, d + n).map(function (it) {
              return { name: it.name, seriesId: it.seriesId, logo: it.logo || null, estSerie: true };
            })
          };
        });
      },
      // Épisodes d'une série, aplatis en une seule liste ordonnée : dans un
      // casque, dérouler un accordéon de saisons à la manette serait pénible.
      vrEpisodes: function (ref, offset, limit) {
        var pl = app.playlist();
        if (!pl || !ref) return Promise.resolve({ total: 0, items: [] });
        var n = Math.min(VR_PAGE_MAX, Math.max(1, limit || 10));
        var d = Math.max(0, offset || 0);
        function page(tout) { return { total: tout.length, items: tout.slice(d, d + n) }; }

        if (pl.type === 'm3u') {
          return ensureM3uLoaded().then(function (data) {
            var pool = (data.items || []).filter(function (it) { return it.kind === 'series'; });
            var serie = M3U.groupSeries(pool).filter(function (se) { return se.nom === ref.serie; })[0];
            if (!serie) return { total: 0, items: [] };
            var tout = [];
            Object.keys(serie.saisons).sort(function (a, b) { return a - b; }).forEach(function (num) {
              serie.saisons[num].slice().sort(function (a, b) { return a.episode - b.episode; }).forEach(function (ep) {
                tout.push({ name: 'S' + num + 'E' + ep.episode + (ep.name && ep.name !== serie.nom ? ' — ' + ep.name : ''),
                  url: ep.url, logo: null, chno: '', epgKey: null });
              });
            });
            return page(tout);
          });
        }
        var cfg = xtreamCfg(pl);
        return Xtream.seriesInfo(cfg, ref.seriesId).then(function (info) {
          var parSaison = (info && info.episodes) || {};
          var tout = [];
          Object.keys(parSaison).sort(function (a, b) { return a - b; }).forEach(function (num) {
            (parSaison[num] || []).forEach(function (ep) {
              tout.push({
                name: 'S' + num + 'E' + (ep.episode_num || '?') + (ep.title ? ' — ' + ep.title : ''),
                url: Xtream.streamUrl(cfg, 'series', ep.id, ep.container_extension || 'mp4'),
                logo: null, chno: '', epgKey: null
              });
            });
          });
          return page(tout);
        }).catch(function () { return { total: 0, items: [] }; });
      }
    };
  }

  global.VrMenus = { creer: creer };
})(window);

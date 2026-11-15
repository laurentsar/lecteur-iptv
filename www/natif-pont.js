/* natif-pont.js — ce que la page transmet au lecteur natif Android et ce
 * qu'elle en reçoit, sans état du lecteur web (sorti de player.js) :
 *  - payload() : liste de zapping (chaînes, ou épisodes d'une série),
 *    sources de la chaîne et favoris, aux adresses « vivantes » ;
 *  - progression() : position de lecture renvoyée par le lecteur natif,
 *    mémorisée avec les mêmes règles que le lecteur web.
 */
(function (global) {
  'use strict';

  // Le lecteur natif occupe tout l'écran : cette page passe derrière, donc
  // tout ce que la télécommande y pilotait (chaîne +/−, numéro de chaîne,
  // liste des chaînes) doit être rejoué côté natif — ce qui suppose de lui
  // transmettre le bouquet en cours. Voir ci/patch_native_player.py.
  function payload(url, ctx) {
    var vivante = ctx.vivante || function (u) { return u; };
    var currentVersions = ctx.versions;
    // Série : la liste des épisodes tient lieu de liste de chaînes — le
    // lecteur natif enchaîne alors l'épisode suivant à la fin (il ne zappe
    // jamais hors direct).
    var list = ctx.live ? ((global.AppZap && global.AppZap.list()) || [])
      : (ctx.episodes || []).map(function (e) { return { name: e.title, url: e.url }; });
    var channels = [], index = -1;
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || !item.url) continue;
      var lien = vivante(item.url);
      if (lien === url) index = channels.length;
      channels.push({
        name: item.name || '',
        url: lien,
        chno: item.chno == null ? '' : String(item.chno),
        epgKey: item.epgKey || '',
        logo: item.logo || ''
      });
    }
    var versions = [];
    if (currentVersions && currentVersions.length > 1) {
      for (var v = 0; v < currentVersions.length; v++) {
        if (currentVersions[v] && currentVersions[v].url) {
          versions.push({ name: currentVersions[v].name || '', url: vivante(currentVersions[v].url), chno: '', epgKey: '', logo: currentVersions[v].logo || '' });
        }
      }
    }
    var favoris = [], brut = (global.AppZap && global.AppZap.favoris()) || [];
    for (var f = 0; f < brut.length; f++) {
      if (brut[f] && brut[f].url) favoris.push({ name: brut[f].name || '', url: vivante(brut[f].url), chno: '', epgKey: '', logo: brut[f].logo || '' });
    }
    return { channels: channels, index: index, versions: versions, favorites: favoris };
  }

  // Position de lecture renvoyée par le lecteur natif : rien au tout début
  // ni à la toute fin (r = { min, max, dureeMin }, voir RESUME_* dans
  // player.js).
  function progression(info, titre, r) {
    var Store = global.Store;
    if (!info || !info.url || !Store) return;
    var position = (info.positionMs || 0) / 1000;
    var duree = (info.durationMs || 0) / 1000;
    if (!duree || duree < r.dureeMin) return;
    var ratio = position / duree;
    if (ratio < r.min || ratio > r.max) {
      Store.clearProgress(info.url);
      return;
    }
    Store.setProgress(info.url, { position: position, duration: duree, title: titre });
  }

  var NatifPont = { payload: payload, progression: progression };
  global.NatifPont = NatifPont;
  if (typeof module !== 'undefined' && module.exports) module.exports = NatifPont;
})(typeof window !== 'undefined' ? window : globalThis);

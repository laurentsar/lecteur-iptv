/* serveurs.js — adresses de secours d'une playlist, et bascule automatique.
 *
 * Les fournisseurs IPTV changent souvent d'adresse (nom de domaine saisi,
 * serveur remplacé) : la même playlist, avec les mêmes identifiants, répond
 * sur une autre adresse. Chaque playlist peut donc porter une liste
 * d'adresses de secours (`secours`) ; au démarrage l'appli essaie, dans
 * l'ordre, la dernière adresse qui a marché (`serveurOk`), l'adresse
 * principale, puis les secours, et garde la première qui répond. Les liens
 * des chaînes, qui contiennent l'adresse, sont réécrits vers elle.
 *
 * Fonctions pures (testées dans tests/serveurs.test.js) ; le réseau est
 * passé en paramètre (joignable). */
(function (global) {
  'use strict';

  // « http://hote:port » d'une URL, ou null. Sans schéma, http:// est supposé
  // (comme Xtream.baseUrl).
  function origine(url) {
    var s = String(url || '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
    var m = /^([a-z][a-z0-9+.-]*:\/\/[^\/?#]+)/i.exec(s);
    return m ? m[1].toLowerCase() : null;
  }

  function remplacerOrigine(url, nouvelle) {
    var o = origine(url);
    if (!o || !nouvelle) return url;
    var s = String(url).trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
    return nouvelle.replace(/\/+$/, '') + s.slice(o.length);
  }

  // Texte saisi (séparé par espaces, virgules, points-virgules ou retours à
  // la ligne) → liste d'origines uniques.
  function lireListe(texte) {
    var vues = {};
    return String(texte || '').split(/[\s,;]+/).map(origine).filter(function (o) {
      if (!o || vues[o]) return false;
      vues[o] = true;
      return true;
    });
  }

  function principale(pl) {
    if (!pl) return null;
    return origine(pl.type === 'xtream' ? pl.serveur : pl.m3uUrl);
  }

  // Ordre d'essai : dernière qui a marché, principale, secours — sans doublon.
  function candidats(pl) {
    var liste = [pl && pl.serveurOk, principale(pl)].concat((pl && pl.secours) || []);
    var vues = {};
    return liste.map(origine).filter(function (o) {
      if (!o || vues[o]) return false;
      vues[o] = true;
      return true;
    });
  }

  // Première origine qui répond. `joignable(origine)` → Promise<bool>.
  // `exclues` : origines déjà vues en panne pendant cette session. Si aucune
  // ne répond, on rend la première (le message d'erreur restera parlant).
  function choisir(pl, joignable, exclues) {
    var liste = candidats(pl).filter(function (o) { return !exclues || exclues.indexOf(o) < 0; });
    if (!liste.length) return Promise.resolve(principale(pl));
    if (liste.length === 1) return Promise.resolve(liste[0]);
    var i = 0;
    function suivant() {
      if (i >= liste.length) return Promise.resolve(liste[0]);
      var o = liste[i++];
      return Promise.resolve(joignable(o)).then(function (ok) { return ok ? o : suivant(); }, suivant);
    }
    return suivant();
  }

  // Lien d'une chaîne : s'il pointe vers une des adresses connues de la
  // playlist, on le réécrit vers l'adresse retenue.
  function reecrire(url, pl, retenue) {
    if (!retenue || !pl) return url;
    var o = origine(url);
    if (!o || o === retenue) return url;
    return candidats(pl).indexOf(o) >= 0 ? remplacerOrigine(url, retenue) : url;
  }

  global.Serveurs = {
    origine: origine, remplacerOrigine: remplacerOrigine, lireListe: lireListe,
    principale: principale, candidats: candidats, choisir: choisir, reecrire: reecrire
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Serveurs;

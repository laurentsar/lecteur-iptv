/* source-quality.js — classement des sources d'une même chaîne par qualité.
 *
 * Beaucoup de playlists listent la même chaîne plusieurs fois sous des noms
 * voisins (« TF1 », « TF1 HD », « TF1 FHD », « TF1 SD ») : ce sont des sources
 * différentes, souvent de qualités et de fiabilités différentes. app.js les
 * regroupe déjà sous une seule carte (groupChannels) ; ce fichier décide dans
 * quel ORDRE les essayer.
 *
 * À quoi ça sert : quand une source se coupe sans arrêt, insister dessus ne
 * sert à rien alors qu'une variante moins gourmande passerait peut-être. Les
 * lecteurs basculent donc sur la suivante — et comme la liste est triée par
 * qualité DÉCROISSANTE, « la suivante » est toujours de qualité inférieure ou
 * égale. C'est ce qui permet au lecteur natif de n'avoir qu'à avancer d'un
 * cran, sans refaire ce calcul en Java.
 *
 * La qualité n'est déclarée nulle part : elle se devine au nom, comme le reste
 * chez les fournisseurs IPTV.
 */
(function (global) {
  'use strict';

  // Ordre des tests important : « FHD » contient « HD », « UHD » aussi.
  var NIVEAUX = [
    { re: /\b(4k|uhd|2160p?)\b/i, rang: 4 },
    { re: /\b(fhd|full ?hd|1080p?)\b/i, rang: 3 },
    { re: /\b(hd|720p?)\b/i, rang: 2 },
    { re: /\b(sd|ld|480p?|360p?|low)\b/i, rang: 1 }
  ];
  // Sans mention : traité comme de la HD, le cas le plus courant. Ni promu
  // au-dessus d'une FHD explicite, ni relégué sous une SD.
  var RANG_PAR_DEFAUT = 2;

  function rang(nom) {
    var s = String(nom || '');
    for (var i = 0; i < NIVEAUX.length; i++) {
      if (NIVEAUX[i].re.test(s)) return NIVEAUX[i].rang;
    }
    return RANG_PAR_DEFAUT;
  }

  /**
   * Copie triée par qualité décroissante. Tri STABLE : à qualité égale, l'ordre
   * de la playlist est conservé — le fournisseur place en général sa source la
   * plus fiable en premier, autant ne pas le contredire sans raison.
   */
  function ordonner(versions) {
    var liste = (versions || []).slice();
    return liste
      .map(function (v, i) { return { v: v, i: i, r: rang(v && v.name) }; })
      .sort(function (a, b) { return b.r - a.r || a.i - b.i; })
      .map(function (x) { return x.v; });
  }

  /**
   * Source à essayer après `urlCourante` : la suivante dans la liste triée,
   * donc de qualité inférieure ou égale. `dejaEssayees` (tableau d'URL) permet
   * de ne pas repasser sur une source qui vient d'échouer. null s'il ne reste
   * rien — on ne revient jamais en arrière vers une qualité supérieure.
   */
  function suivante(versionsTriees, urlCourante, dejaEssayees) {
    var liste = versionsTriees || [];
    var vues = dejaEssayees || [];
    var depart = -1;
    for (var i = 0; i < liste.length; i++) {
      if (liste[i] && liste[i].url === urlCourante) { depart = i; break; }
    }
    for (var j = depart + 1; j < liste.length; j++) {
      var cand = liste[j];
      if (!cand || !cand.url) continue;
      if (cand.url === urlCourante) continue;
      if (vues.indexOf(cand.url) !== -1) continue;
      return cand;
    }
    return null;
  }

  global.SourceQuality = { rang: rang, ordonner: ordonner, suivante: suivante };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.SourceQuality;

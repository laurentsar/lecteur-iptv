/* dpad-nav.js — navigation D-pad (flèches de la télécommande TV) entre les
 * éléments focusables de la page.
 *
 * Pourquoi ce fichier existe : Android ne propose AUCUNE API publique pour
 * activer une « navigation spatiale » (déplacement du focus aux flèches)
 * dans une WebView — contrairement à ce qu'on pourrait croire,
 * WebSettings n'a pas de setSpatialNavigationEnabled (cette méthode
 * n'existe pas, une tentative de l'appeler casse la compilation). Sans
 * elle, les flèches de la télécommande ne bougent le focus sur RIEN : ni
 * les cartes de chaînes, ni les boutons, ni les onglets — même quand ils
 * sont déjà focusables au clavier (voir makeFocusable() dans app.js, qui
 * gère Entrée/Espace mais jamais les flèches). Ce fichier comble ce vide
 * entièrement côté web, sans dépendre d'un réglage natif.
 *
 * Algorithme : au lieu d'un simple ordre de tabulation (qui ignore la
 * disposition réelle à l'écran), on choisit le prochain élément par
 * position géométrique dans la direction demandée — la case la plus
 * proche « à droite », « en bas »... Testable indépendamment du DOM avec
 * de simples rectangles (voir tests/dpadnav.test.js).
 */
(function (global) {
  'use strict';

  // Repli sur l'ordre naturel de tabulation à égalité de score : les rangées
  // d'une grille sont dans l'ordre du DOM, ce qui donne un résultat stable.
  function score(from, cand, direction) {
    var fcx = (from.left + from.right) / 2, fcy = (from.top + from.bottom) / 2;
    var ccx = (cand.left + cand.right) / 2, ccy = (cand.top + cand.bottom) / 2;
    var dx = ccx - fcx, dy = ccy - fcy;
    // Poids fort sur l'axe perpendiculaire : on ne quitte la rangée/colonne
    // courante que si rien de mieux ne s'y trouve.
    if (direction === 'right') return dx <= 0 ? null : dx + Math.abs(dy) * 2;
    if (direction === 'left') return dx >= 0 ? null : -dx + Math.abs(dy) * 2;
    if (direction === 'down') return dy <= 0 ? null : dy + Math.abs(dx) * 2;
    if (direction === 'up') return dy >= 0 ? null : -dy + Math.abs(dx) * 2;
    return null;
  }

  /**
   * Meilleur candidat depuis `fromRect` (ou null si aucun focus courant, auquel
   * cas l'appelant garde son propre repli) dans `direction`
   * ('up'|'down'|'left'|'right'), parmi `rects` (tableau de {left,top,right,
   * bottom}, un par candidat, dans l'ordre du DOM). Renvoie l'INDEX du
   * meilleur candidat, ou -1 si aucun ne convient (rien dans cette
   * direction — l'appelant laisse alors le comportement par défaut agir,
   * ex. défilement de page).
   */
  function pickCandidate(fromRect, rects, direction) {
    if (!fromRect || !rects || !rects.length) return -1;
    var best = -1, bestScore = Infinity;
    for (var i = 0; i < rects.length; i++) {
      var s = score(fromRect, rects[i], direction);
      if (s === null) continue;
      if (s < bestScore) { bestScore = s; best = i; }
    }
    return best;
  }

  // Sélecteur des éléments navigables : tout ce que app.js rend déjà
  // atteignable au clavier (voir makeFocusable) plus les contrôles natifs.
  var FOCUSABLE_SELECTOR = '.carte, .carte-lock, .chip, .tab, .now-ligne, ' +
    '.guide-chan, .guide-prog, .version-item, .scene3d, ' +
    'button, a[href], input, select, textarea, [tabindex]';

  function estVisible(el) {
    return !!el.offsetParent || el === document.body;
  }

  function estNavigable(el) {
    if (el.disabled) return false;
    if (el.tabIndex < 0) return false;
    return estVisible(el);
  }

  function candidats(exclu) {
    var out = [];
    var nodes = document.querySelectorAll(FOCUSABLE_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n === exclu) continue;
      if (estNavigable(n)) out.push(n);
    }
    return out;
  }

  var KEY_TO_DIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  // Éléments où les flèches ont un sens natif à préserver (curseur de texte,
  // liste déroulante, case à cocher/radio, curseur de plage) : on ne
  // touche à rien plutôt que de leur voler la flèche.
  var SANS_INTERCEPTION = /^(INPUT|TEXTAREA|SELECT)$/;

  function onKeydown(e) {
    var direction = KEY_TO_DIR[e.key];
    if (!direction) return;
    if (e.defaultPrevented) return; // déjà pris en charge ailleurs (ex. carrousel 3D)
    var ae = document.activeElement;
    if (ae && ae.isContentEditable) return;
    if (ae && SANS_INTERCEPTION.test(ae.tagName)) return;
    if (!ae || ae === document.body) return; // pas de focus courant : rien à déplacer depuis

    var fromRect = ae.getBoundingClientRect();
    var liste = candidats(ae);
    var rects = liste.map(function (el) { return el.getBoundingClientRect(); });
    var idx = pickCandidate(fromRect, rects, direction);
    if (idx < 0) return; // rien dans cette direction : laisser le comportement par défaut

    e.preventDefault();
    liste[idx].focus();
    if (liste[idx].scrollIntoView) liste[idx].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeydown);
  }

  global.DpadNav = { pickCandidate: pickCandidate, FOCUSABLE_SELECTOR: FOCUSABLE_SELECTOR };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DpadNav;

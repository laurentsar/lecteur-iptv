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
    // <summary> : l'en-tête d'un <details>. Le navigateur le rend focusable
    // tout seul, mais il n'était pas dans cette liste — donc la navigation
    // D-pad ne le proposait jamais, et TOUTES les catégories des Réglages
    // (Synchronisation, Affichage, Lecture, Playlists, Infos) étaient hors
    // d'atteinte à la télécommande. C'était ça, « je ne peux pas modifier
    // mes paramètres ».
    'summary, ' +
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

  /* Quelles flèches laisser au contrôle lui-même.
   *
   * L'ancienne règle rendait TOUTES les flèches à tout INPUT, TEXTAREA ou
   * SELECT. Résultat sur un téléviseur : dès que le focus arrivait sur une
   * case à cocher ou un champ texte des Réglages, plus aucune flèche ne
   * déplaçait le focus — la télécommande était prisonnière du premier
   * contrôle atteint, et l'écran Réglages devenait inutilisable (constaté sur
   * les deux télés).
   *
   * Seuls le texte (curseur) et le curseur de plage (valeur) ont un vrai
   * usage des flèches, et seulement à l'horizontale. Le reste — case à
   * cocher, bouton radio, liste déroulante, case de fichier — n'en fait
   * rien : ces flèches-là doivent déplacer le focus.
   */
  var TEXTE = /^(text|search|url|tel|email|password|number)$/;

  function rendLaFleche(el, direction) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'SELECT') return false;   // remplacée par notre propre liste, voir plus bas
    if (tag !== 'INPUT') return false;
    var type = (el.type || 'text').toLowerCase();
    if (type === 'range') return direction === 'left' || direction === 'right';
    if (TEXTE.test(type)) return direction === 'left' || direction === 'right';
    return false;                          // checkbox, radio, file, button…
  }

  function onKeydown(e) {
    var direction = KEY_TO_DIR[e.key];
    if (!direction) return;
    if (e.defaultPrevented) return; // déjà pris en charge ailleurs (ex. carrousel 3D)
    var ae = document.activeElement;
    if (ae && ae.isContentEditable) return;
    if (rendLaFleche(ae, direction)) return;
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

  /* Valider avec la télécommande.
   *
   * Le bouton central d'une télécommande Android envoie « Entrée ». Or dans
   * un navigateur, Entrée ne coche PAS une case (c'est Espace), et n'ouvre
   * pas la liste d'un <select> de façon utilisable dans une WebView de
   * téléviseur. Les deux se règlent ici.
   */
  function surEntree(e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.keyCode !== 13) return;
    var el = document.activeElement;
    if (!el || e.defaultPrevented) return;

    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      e.preventDefault();
      el.checked = el.type === 'radio' ? true : !el.checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (el.tagName === 'SELECT' && e.key !== ' ') {
      e.preventDefault();
      ouvrirListe(el);
    }
  }

  /* Liste déroulante maison, navigable aux flèches.
   *
   * La liste native d'un <select> s'ouvre dans une fenêtre système que la
   * télécommande ne pilote pas de façon fiable sur Android TV — et celle des
   * bouquets contient des dizaines d'entrées, donc « faire défiler à
   * l'aveugle » n'est pas une option. On affiche nos propres boutons, qui
   * sont de simples éléments focusables comme le reste de l'app.
   */
  function ouvrirListe(select) {
    if (document.getElementById('dpadListe')) return;

    var fond = document.createElement('div');
    fond.id = 'dpadListe';
    fond.setAttribute('style',
      'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);' +
      'display:flex;align-items:center;justify-content:center;padding:4vh 4vw');

    var boite = document.createElement('div');
    boite.setAttribute('style',
      'background:#161C29;border:1px solid #2A3344;border-radius:14px;padding:12px;' +
      'max-height:88vh;max-width:640px;width:100%;overflow:auto');
    fond.appendChild(boite);

    function fermer() {
      if (fond.parentNode) fond.parentNode.removeChild(fond);
      select.focus();
    }

    Array.prototype.forEach.call(select.options, function (opt, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = opt.textContent;
      b.setAttribute('style',
        'display:block;width:100%;text-align:left;margin:4px 0;padding:12px 14px;font-size:16px;' +
        'border-radius:10px;border:1px solid #2A3344;cursor:pointer;' +
        (opt.selected ? 'background:#2E7D66;color:#fff' : 'background:#1E2637;color:#EEF2F8'));
      b.addEventListener('click', function () {
        select.selectedIndex = i;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        fermer();
      });
      boite.appendChild(b);
      if (opt.selected) setTimeout(function () { b.focus(); }, 0);
    });

    fond.addEventListener('click', function (ev) { if (ev.target === fond) fermer(); });
    fond.addEventListener('keydown', function (ev) {
      // Retour / Échap ferment : sur une télécommande, le bouton Retour est
      // le réflexe, et sans ça la liste piégerait le focus à son tour.
      if (ev.key === 'Escape' || ev.key === 'Backspace' || ev.key === 'GoBack') { ev.preventDefault(); fermer(); }
    });
    document.body.appendChild(fond);
    if (!boite.querySelector('button[style*="2E7D66"]')) {
      var premier = boite.querySelector('button');
      if (premier) premier.focus();
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('keydown', surEntree);
  }

  global.DpadNav = { pickCandidate: pickCandidate, FOCUSABLE_SELECTOR: FOCUSABLE_SELECTOR };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DpadNav;

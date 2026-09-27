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

  // Distance entre deux intervalles : 0 s'ils se chevauchent.
  //
  // C'est la pièce qui manquait. En mesurant l'écart perpendiculaire entre
  // les CENTRES, un bloc large aligné juste au-dessus (une catégorie des
  // Réglages, pleine largeur) écopait d'une pénalité énorme parce que son
  // centre est loin à gauche — et la flèche « haut » préférait sauter à
  // l'onglet voisin, qui est pourtant sur la même rangée. Avec l'écart entre
  // BORDS, un candidat qui recouvre la colonne courante a une pénalité nulle,
  // ce qui est exactement ce que l'œil attend.
  function ecart(a1, a2, b1, b2) {
    if (a2 < b1) return b1 - a2;
    if (b2 < a1) return a1 - b2;
    return 0;
  }

  // Tolérance : deux éléments d'une même rangée ne sont jamais alignés au
  // pixel près (une bordure de focus suffit à les décaler).
  var MARGE = 6;

  // Repli sur l'ordre naturel de tabulation à égalité de score : les rangées
  // d'une grille sont dans l'ordre du DOM, ce qui donne un résultat stable.
  function score(from, cand, direction) {
    var perpH = ecart(from.left, from.right, cand.left, cand.right);
    var perpV = ecart(from.top, from.bottom, cand.top, cand.bottom);
    // Poids fort sur l'axe perpendiculaire : on ne quitte la rangée/colonne
    // courante que si rien de mieux ne s'y trouve.
    if (direction === 'right') {
      if (cand.left < from.right - MARGE) return null;
      return (cand.left - from.right) + perpV * 2;
    }
    if (direction === 'left') {
      if (cand.right > from.left + MARGE) return null;
      return (from.left - cand.right) + perpV * 2;
    }
    if (direction === 'down') {
      if (cand.top < from.bottom - MARGE) return null;
      return (cand.top - from.bottom) + perpH * 2;
    }
    if (direction === 'up') {
      if (cand.bottom > from.top + MARGE) return null;
      return (from.top - cand.bottom) + perpH * 2;
    }
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
    var ordre = rankCandidates(fromRect, rects, direction);
    return ordre.length ? ordre[0] : -1;
  }

  /* Tous les candidats de la direction, du meilleur au moins bon (index dans
   * `rects`). L'appelant essaie le premier, et passe au suivant si le focus
   * n'a pas pris — voir onKeydown. À score égal, l'ordre du DOM. */
  function rankCandidates(fromRect, rects, direction) {
    if (!fromRect || !rects || !rects.length) return [];
    var notes = [];
    for (var i = 0; i < rects.length; i++) {
      var s = score(fromRect, rects[i], direction);
      if (s !== null) notes.push({ i: i, s: s });
    }
    notes.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    return notes.map(function (n) { return n.i; });
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

  /* Dans un <details> REPLIÉ, hors de son propre <summary>.
   *
   * La WebView récente ne masque plus le contenu d'un <details> fermé par
   * display:none mais par content-visibility : l'élément garde un
   * offsetParent et une position, passe donc pour « visible »… et refuse le
   * focus. La flèche le choisissait comme meilleur voisin, focus() échouait
   * en silence, et le focus restait figé sur l'en-tête — d'où « impossible
   * de modifier les playlists » sur les télés (flèche bas morte sous
   * « Playlists », constaté sur la TCL le 2026-09-27). */
  function dansDetailsFerme(el) {
    for (var n = el; n && n.parentElement; n = n.parentElement) {
      var p = n.parentElement;
      if (p.tagName === 'DETAILS' && !p.open && !(n.tagName === 'SUMMARY' && p.querySelector('summary') === n)) return true;
    }
    return false;
  }

  function estNavigable(el) {
    if (el.disabled) return false;
    if (el.tabIndex < 0) return false;
    if (!estVisible(el)) return false;
    if (dansDetailsFerme(el)) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
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
    if (TEXTE.test(type)) {
      if (direction !== 'left' && direction !== 'right') return false;
      // Champ seulement sélectionné (clavier pas encore ouvert par OK) : on
      // n'y écrit pas, toutes les flèches servent à se déplacer.
      if (el.hasAttribute('data-dpad-im')) return false;
      // Curseur déjà au bord : la flèche ne ferait rien dans le champ, c'est
      // la WebView qui sauterait d'elle-même au champ voisin — en ouvrant le
      // clavier. On déplace donc le focus nous-mêmes.
      var debut, fin;
      try { debut = el.selectionStart; fin = el.selectionEnd; } catch (err) { return true; }
      if (debut == null) return true;           // email/number : pas de curseur lisible
      if (debut !== fin) return true;           // une sélection : la flèche la réduit
      var len = (el.value || '').length;
      return direction === 'right' ? debut < len : debut > 0;
    }
    return false;                          // checkbox, radio, file, button…
  }

  /* Champ texte atteint à la flèche : PAS de clavier virtuel tout de suite.
   *
   * Sur la TCL, poser le focus dans un champ texte ouvre le clavier à
   * l'écran, qui capte ensuite toutes les flèches : pour traverser le
   * formulaire d'une playlist (nom, serveur, utilisateur, mot de passe), il
   * fallait appuyer sur Retour à CHAQUE champ. Comme dans les applis TV, le
   * champ est seulement sélectionné ; le bouton OK ouvre le clavier (voir
   * surEntree). inputmode="none" retient le clavier, l'attribut d'origine est
   * rendu à la sortie du champ ou au premier toucher du doigt. */
  function estChampTexte(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && TEXTE.test((el.type || 'text').toLowerCase());
  }

  var SANS_ATTR = '\u0000';   // « l'attribut inputmode n'existait pas »

  function rendreClavier(el) {
    if (!el.hasAttribute('data-dpad-im')) return;
    var avant = el.getAttribute('data-dpad-im');
    el.removeAttribute('data-dpad-im');
    if (avant === SANS_ATTR) el.removeAttribute('inputmode'); else el.setAttribute('inputmode', avant);
  }

  function focusSansClavier(el) {
    if (estChampTexte(el) && !el.hasAttribute('data-dpad-im')) {
      el.setAttribute('data-dpad-im', el.hasAttribute('inputmode') ? el.getAttribute('inputmode') : SANS_ATTR);
      el.setAttribute('inputmode', 'none');
      var fin = function () {
        rendreClavier(el);
        el.removeEventListener('blur', fin);
        el.removeEventListener('pointerdown', fin);
      };
      el.addEventListener('blur', fin);
      el.addEventListener('pointerdown', fin);
    }
    el.focus({ preventScroll: true });
  }

  function onKeydown(e) {
    var direction = KEY_TO_DIR[e.key];
    if (!direction) return;
    if (e.defaultPrevented) return; // déjà pris en charge ailleurs (ex. carrousel 3D)
    var ae = document.activeElement;
    if (ae && ae.isContentEditable) return;
    if (rendLaFleche(ae, direction)) return;

    /* Aucun focus courant : on en pose un, au lieu de ne rien faire.
     *
     * C'est le cas au démarrage de l'app, et après chaque appui sur un
     * onglet — sur Android, toucher un bouton ne lui donne PAS le focus DOM.
     * La télécommande se retrouvait alors devant une page où aucune flèche
     * n'avait d'effet : c'est ce qui rendait les Réglages « impossibles à
     * modifier ». Le premier élément visible sert de point de départ. */
    if (!ae || ae === document.body) {
      var premiers = candidats(null);
      if (!premiers.length) return;
      e.preventDefault();
      focusSansClavier(premiers[0]);
      if (premiers[0].scrollIntoView) premiers[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }

    var fromRect = ae.getBoundingClientRect();
    var liste = candidats(ae);
    var rects = liste.map(function (el) { return el.getBoundingClientRect(); });
    var ordre = rankCandidates(fromRect, rects, direction);
    if (!ordre.length) return; // rien dans cette direction : laisser le comportement par défaut

    e.preventDefault();
    // Un candidat peut refuser le focus sans erreur (élément que le moteur
    // juge inerte) : on vérifie qu'il a VRAIMENT pris, sinon on passe au
    // suivant, plutôt que de laisser la télécommande figée.
    for (var k = 0; k < ordre.length; k++) {
      var cible = liste[ordre[k]];
      focusSansClavier(cible);
      if (document.activeElement === cible) {
        if (cible.scrollIntoView) cible.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
      }
    }
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

    // OK sur un champ sélectionné à la flèche : ouvrir le clavier maintenant.
    if (e.key !== ' ' && estChampTexte(el) && el.hasAttribute('data-dpad-im')) {
      e.preventDefault();
      rendreClavier(el);
      el.blur();
      el.focus({ preventScroll: true });
      return;
    }
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

  global.DpadNav = { pickCandidate: pickCandidate, rankCandidates: rankCandidates, estNavigable: estNavigable, focusSansClavier: focusSansClavier, FOCUSABLE_SELECTOR: FOCUSABLE_SELECTOR };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DpadNav;

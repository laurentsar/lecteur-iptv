/* clavier-ecran.js — clavier à l'écran, piloté aux flèches de la télécommande.
 *
 * Le clavier de l'appareil ne s'ouvre pas partout : sur la Fire TV (Fire OS
 * 7) comme sur la TV Samsung, OK sur l'URL de la playlist ne faisait rien
 * apparaître — impossible d'ajouter une playlist sans clavier physique. Ce
 * clavier-ci est fait de simples boutons de la page : il marche donc partout
 * où la navigation D-pad marche. Il s'ouvre sur OK dans un champ texte
 * (dpad-nav.js), et par le bouton ⌨️ ajouté à côté de chaque champ dès que
 * la page est pilotée aux flèches.
 *
 * Disposition AZERTY, plus les morceaux qui reviennent dans une adresse de
 * playlist (http://, :8080, .m3u…) pour épargner des dizaines d'appuis. Le
 * bouton « Clavier de l'appareil » rend la main au clavier système quand il
 * fonctionne.
 */
(function (global) {
  'use strict';

  var LIGNES = [
    '1234567890',
    'azertyuiop',
    'qsdfghjklm',
    'wxcvbn.-_/',
    ':@?=&%#~+,'
  ];
  var RACCOURCIS = ['http://', 'https://', 'www.', '.com', '.m3u', '.m3u8', ':8080', '/get.php?'];

  var fond = null;
  var champ = null;
  var valeur = '';
  var maj = false;
  var montrer = false;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function estOuvert() { return !!fond; }

  function estSecret() { return champ && champ.type === 'password' && !montrer; }

  function rafraichir() {
    if (!fond) return;
    var apercu = fond.querySelector('.clav-apercu');
    var txt = estSecret() ? valeur.replace(/./g, '•') : valeur;
    apercu.textContent = txt;
    apercu.classList.toggle('vide', !valeur);
    if (!valeur) apercu.textContent = champ.placeholder || '';
    Array.prototype.forEach.call(fond.querySelectorAll('.clav-lettre'), function (b) {
      var c = b.getAttribute('data-c');
      b.textContent = maj ? c.toUpperCase() : c;
    });
    var bMaj = fond.querySelector('.clav-maj');
    if (bMaj) bMaj.classList.toggle('on', maj);
  }

  function ajouter(txt) { valeur += txt; rafraichir(); }

  function touche(label, cls, action) {
    var b = el('button', 'clav-touche' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.addEventListener('click', action);
    return b;
  }

  function rendreFocus(input) {
    if (!input || !input.isConnected) return;
    if (global.DpadNav && global.DpadNav.focusSansClavier) global.DpadNav.focusSansClavier(input);
    else input.focus();
  }

  function fermer(garder) {
    if (!fond) return;
    var input = champ;
    if (garder && input) {
      input.value = valeur;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    fond.parentNode.removeChild(fond);
    fond = null;
    champ = null;
    rendreFocus(input);
  }

  function ouvrir(input, natif) {
    if (fond || !input) return;
    champ = input;
    valeur = input.value || '';
    maj = false;
    montrer = false;

    fond = el('div', 'clav-fond');
    fond.id = 'clavierEcran';
    fond.setAttribute('data-dpad-piege', '');
    var carte = el('div', 'clav-carte');
    carte.setAttribute('role', 'dialog');
    var titre = (input.labels && input.labels[0] && input.labels[0].textContent) || input.placeholder || 'Saisie';
    carte.setAttribute('aria-label', titre.trim());
    carte.appendChild(el('div', 'clav-titre', titre.trim().split('\n')[0]));
    carte.appendChild(el('div', 'clav-apercu'));

    var grille = el('div', 'clav-grille');
    LIGNES.forEach(function (ligne) {
      var rang = el('div', 'clav-rang');
      ligne.split('').forEach(function (c) {
        var b = touche(c, /[a-z]/.test(c) ? 'clav-lettre' : '', function () {
          ajouter(maj && /[a-z]/.test(c) ? c.toUpperCase() : c);
        });
        if (/[a-z]/.test(c)) b.setAttribute('data-c', c);
        rang.appendChild(b);
      });
      grille.appendChild(rang);
    });
    var rang = el('div', 'clav-rang');
    rang.appendChild(touche('⇧ Maj', 'clav-large clav-maj', function () { maj = !maj; rafraichir(); }));
    rang.appendChild(touche('Espace', 'clav-espace', function () { ajouter(' '); }));
    rang.appendChild(touche('⌫', 'clav-large', function () { valeur = valeur.slice(0, -1); rafraichir(); }));
    rang.appendChild(touche('Tout effacer', 'clav-large', function () { valeur = ''; rafraichir(); }));
    if (input.type === 'password') {
      rang.appendChild(touche('👁', '', function () { montrer = !montrer; rafraichir(); }));
    }
    grille.appendChild(rang);
    rang = el('div', 'clav-rang');
    RACCOURCIS.forEach(function (r) {
      rang.appendChild(touche(r, 'clav-raccourci', function () { ajouter(r); }));
    });
    grille.appendChild(rang);
    carte.appendChild(grille);

    var actions = el('div', 'clav-rang clav-actions');
    var valider = touche('✔ Valider', 'clav-valider', function () { fermer(true); });
    actions.appendChild(valider);
    actions.appendChild(touche('✖ Annuler', '', function () { fermer(false); }));
    if (natif) {
      actions.appendChild(touche('⌨️ Clavier de l\'appareil', '', function () {
        var input = champ;
        fermer(false);
        natif(input);
      }));
    }
    carte.appendChild(actions);
    fond.appendChild(carte);

    fond.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' || ev.key === 'GoBack') { ev.preventDefault(); fermer(false); }
    });
    document.body.appendChild(fond);
    rafraichir();
    var premier = grille.querySelector('.clav-touche');
    if (premier) premier.focus();
  }

  /* Bouton ⌨️ à côté de chaque champ, dès que la page est pilotée aux
   * flèches. Le bouton OK d'une télécommande marche toujours sur un bouton
   * (c'est avec lui qu'on valide tout le reste) : c'est la voie qui ne
   * dépend pas de la façon dont la WebView traite OK dans un champ texte. */
  var CHAMP = 'input[type="text"], input[type="url"], input[type="search"], input[type="password"], input[type="email"], input[type="tel"], input[type="number"], input:not([type]), textarea';

  function equiper() {
    var champs = document.querySelectorAll(CHAMP);
    for (var i = 0; i < champs.length; i++) {
      var input = champs[i];
      if (input.hasAttribute('data-clav-equipe') || input === document.activeElement) continue;
      if (input.closest && input.closest('#clavierEcran')) continue;
      if (input.readOnly || input.disabled) continue;
      input.setAttribute('data-clav-equipe', '');
      // Champ de recherche : déjà enveloppé avec sa croix d'effacement.
      var cible = input.parentNode && input.parentNode.classList &&
        input.parentNode.classList.contains('champ-rech') ? input.parentNode : input;
      if (!cible.parentNode) continue;
      var wrap = el('span', 'clav-champ');
      cible.parentNode.insertBefore(wrap, cible);
      wrap.appendChild(cible);
      var b = el('button', 'clav-ouvrir', '⌨️');
      b.type = 'button';
      b.setAttribute('aria-label', 'Clavier à l\'écran');
      (function (input) {
        b.addEventListener('click', function () {
          ouvrir(input, global.DpadNav && global.DpadNav.clavierAppareil);
        });
      })(input);
      wrap.appendChild(b);
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', function (e) {
      if (!/^Arrow/.test(e.key || '')) return;
      document.documentElement.classList.add('telecommande');
      equiper();
    }, true);
  }

  global.ClavierEcran = { equiper: equiper, ouvrir: ouvrir, fermer: fermer, estOuvert: estOuvert };
})(typeof window !== 'undefined' ? window : globalThis);

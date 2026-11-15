/* jeux.js — onglet Jeux : émulateur Mega Drive / NES (EmulatorJS) dans
 * une iframe. Sorti d'app.js, dont il ne dépend pas. */
(function (global) {
  'use strict';

  function $id(id) { return document.getElementById(id); }
  // window.AppToast est posé par app.js, chargé après : lu à l'appel.
  function toast(msg) { if (global.AppToast) global.AppToast(msg); }

  // ---------- Jeux (émulateur Mega Drive/NES via EmulatorJS) ----------
  // Identifiants de système attendus par EJS_core (EmulatorJS) : "segaMD"
  // pour Mega Drive/Genesis (cœur Genesis Plus GX), "nes" pour NES (cœur
  // FCEUmm). La ROM n'est jamais stockée ni transmise à un serveur : lue en
  // mémoire depuis le fichier choisi par l'utilisateur, transférée telle
  // quelle (ArrayBuffer transférable, sans copie) à l'iframe qui héberge le
  // moteur d'émulation.
  var SYSTEMES_JEU = {
    megadrive: { core: 'segaMD', accept: '.md,.gen,.smd,.bin,.zip' },
    nes: { core: 'nes', accept: '.nes,.zip' }
  };

  $id('jeu_systeme').addEventListener('change', function () {
    var s = SYSTEMES_JEU[$id('jeu_systeme').value];
    $id('jeu_rom').accept = s.accept;
  });
  $id('jeu_rom').accept = SYSTEMES_JEU[$id('jeu_systeme').value].accept;

  function lancerJeu(systeme, file) {
    var s = SYSTEMES_JEU[systeme];
    var out = $id('jeuResult');
    out.textContent = 'Chargement…';
    file.arrayBuffer().then(function (buf) {
      $id('emuTitre').textContent = file.name;
      $id('emuOverlay').style.display = '';
      var frame = $id('emuFrame');
      // Iframe fraîche à chaque partie (au lieu de réutiliser la précédente)
      // : évite tout état résiduel d'une session EmulatorJS antérieure
      // (WASM/contexte audio) qui continuerait à tourner en arrière-plan.
      var neuve = frame.cloneNode(false);
      neuve.id = 'emuFrame'; neuve.className = frame.className;
      frame.parentNode.replaceChild(neuve, frame);
      neuve.addEventListener('load', function once() {
        neuve.removeEventListener('load', once);
        neuve.contentWindow.postMessage({ type: 'lancer-jeu', core: s.core, nom: file.name, rom: buf }, '*', [buf]);
      });
      neuve.src = 'emulateur.html';
      out.textContent = '';
    }).catch(function (err) { out.textContent = '❌ Fichier illisible : ' + err.message; });
  }

  $id('btnJouer').addEventListener('click', function () {
    var file = $id('jeu_rom').files[0];
    if (!file) { toast('Choisis un fichier ROM.'); return; }
    lancerJeu($id('jeu_systeme').value, file);
  });

  $id('btnFermerJeu').addEventListener('click', function () {
    $id('emuOverlay').style.display = 'none';
    var frame = $id('emuFrame');
    // Bascule vers une page vide plutôt que de simplement masquer l'overlay :
    // sans ça l'émulateur (WASM + audio) continuerait de tourner, invisible,
    // jusqu'à la prochaine partie.
    var neuve = frame.cloneNode(false);
    neuve.id = 'emuFrame'; neuve.className = frame.className;
    frame.parentNode.replaceChild(neuve, frame);
    neuve.src = 'about:blank';
  });
})(window);

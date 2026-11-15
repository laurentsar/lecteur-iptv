/* options.js — cases à cocher des Réglages qui ne touchent qu'au stockage
 * (Store) et à l'affichage : affichage TV, filtre lumière bleue, lecteur
 * natif, dernière chaîne au démarrage, son en arrière-plan. Sorties
 * d'app.js, qui les appelle au démarrage (init). */
(function (global) {
  'use strict';

  function $id(id) { return document.getElementById(id); }
  // window.AppToast est posé par app.js, chargé après : lu à l'appel.
  function toast(msg) { if (global.AppToast) global.AppToast(msg); }
  var Store = global.Store;

  // ---------- Affichage TV (grands caractères) ----------
  // Une interface pensée pour un téléphone tenu à 30 cm devient illisible sur
  // une télé regardée à trois mètres. Réglage manuel et non détection
  // automatique : rien ne permet d'identifier de façon fiable un téléviseur
  // depuis la WebView (l'agent utilisateur d'un boîtier Android TV est celui
  // d'un téléphone). Voir body.tv dans styles.css.
  function setupModeTv() {
    var box = $id('optModeTv');
    if (!box) return;
    function appliquer(actif) { document.body.classList.toggle('tv', !!actif); }
    box.checked = Store.getModeTv();
    appliquer(box.checked);
    box.addEventListener('change', function () {
      Store.setModeTv(box.checked);
      appliquer(box.checked);
      toast(box.checked ? '📺 Affichage TV activé' : 'Affichage TV désactivé');
    });
  }

  // Filtre lumière bleue : superposition ambre sur toute l'appli, pour le
  // confort visuel en soirée (l'appli est déjà entièrement en thème sombre —
  // il n'existe pas de mode clair à remplacer, voir body.filtre-nuit dans
  // styles.css). Réglage manuel comme le mode TV : aucun moyen fiable de
  // détecter l'heure du visionnage sans plus d'intrusion que ça n'en vaut
  // la peine pour un simple confort d'affichage.
  function setupFiltreNuit() {
    var box = $id('optFiltreNuit');
    if (!box) return;
    function appliquer(actif) { document.body.classList.toggle('filtre-nuit', !!actif); }
    box.checked = Store.getFiltreNuit();
    appliquer(box.checked);
    box.addEventListener('change', function () {
      Store.setFiltreNuit(box.checked);
      appliquer(box.checked);
      toast(box.checked ? '🌙 Filtre lumière bleue activé' : 'Filtre lumière bleue désactivé');
    });
  }

  function setupLecteurNatif() {
    var natif = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() &&
      window.Capacitor.Plugins && window.Capacitor.Plugins.NativePlayer);
    if (!natif) return;
    $id('cat-lecture').style.display = '';
    $id('card-lecture').style.display = '';
    var box = $id('optLecteurNatif');
    box.checked = Store.getLecteurNatif();
    box.addEventListener('change', function () {
      Store.setLecteurNatif(box.checked);
      toast(box.checked ? 'Lecteur natif activé' : 'Lecteur web activé');
    });
  }

  function setupReprendreChaine() {
    var box = $id('optReprendreChaine');
    if (!box) return;
    box.checked = Store.getReprendreChaine();
    box.addEventListener('change', function () {
      Store.setReprendreChaine(box.checked);
      toast(box.checked ? 'La dernière chaîne s’ouvrira au démarrage' : 'Démarrage sur l’accueil');
    });
  }

  function setupFondSonore() {
    var natif = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var box = $id('optFondSonore');
    if (!natif || !box) return;
    $id('card-fond-sonore').style.display = '';
    box.checked = Store.getFondSonore();
    box.addEventListener('change', function () {
      Store.setFondSonore(box.checked);
      toast(box.checked ? 'Le son continuera écran verrouillé' : 'Pause quand l’écran se verrouille');
    });
  }

  global.Options = {
    setupModeTv: setupModeTv, setupFiltreNuit: setupFiltreNuit, setupLecteurNatif: setupLecteurNatif,
    setupReprendreChaine: setupReprendreChaine, setupFondSonore: setupFondSonore
  };
})(window);

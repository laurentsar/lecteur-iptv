/* tizen-tv.js — Lecteur IPTV en application Samsung (Tizen).
 *
 * Les TV Samsung n'exécutent pas d'APK Android : leur système, Tizen, fait
 * tourner des applications HTML/JavaScript — exactement ce qu'est www/. Le
 * dossier tizen/ emballe donc cette même page en application (.wgt), et ce
 * fichier y ajoute ce qui ne vaut que sur une TV Samsung :
 *
 *  - la lecture par AVPlay, le lecteur intégré de la TV (webapis.avplay),
 *    à la place de hls.js / mpegts.js / <video>. Il lit nativement le TS et
 *    le HLS des fournisseurs IPTV, en http://, avec le son Dolby (AC3/E-AC3)
 *    et MP2 que le moteur web ne décode pas — l'équivalent du lecteur natif
 *    (ExoPlayer) de l'APK ;
 *  - les touches de la télécommande : Retour (mêmes étapes que le bouton
 *    retour Android, voir goBack dans app.js), chaînes +/−, lecture/pause,
 *    pavé numérique ;
 *  - l'affichage TV (grands caractères) activé d'office.
 *
 * Hors Tizen (navigateur, APK), rien ne s'active : TizenTV.actif est faux.
 *
 * AVPlay dessine la vidéo sur un plan situé SOUS la page : tout ce que la
 * page affiche d'opaque par-dessus la masque. Pendant la lecture, la page est
 * donc rendue transparente (classe html.avplay-actif, voir styles.css) et
 * seuls restent visibles les commandes et bandeaux du lecteur.
 */
(function (global) {
  'use strict';

  var surTizen = !!(global.tizen && global.tizen.tvinputdevice);
  var TizenTV = { actif: surTizen };
  global.TizenTV = TizenTV;
  if (!surTizen) return;

  document.documentElement.classList.add('tizen');

  // Affichage TV d'office : sur ce support, on est forcément devant une télé.
  try { if (global.Store && !global.Store.getModeTv()) global.Store.setModeTv(true); } catch (e) {}

  // ---------- Télécommande ----------
  // Sans enregistrement explicite, Tizen garde pour lui les touches média,
  // de chaîne et numériques.
  var VOULUES = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
    'MediaFastForward', 'MediaRewind', 'ChannelUp', 'ChannelDown', 'Info',
    'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  try {
    var dispo = global.tizen.tvinputdevice.getSupportedKeys().map(function (k) { return k.name; });
    VOULUES.forEach(function (nom) {
      if (dispo.indexOf(nom) < 0) return;
      try { global.tizen.tvinputdevice.registerKey(nom); } catch (e) {}
    });
  } catch (e) {}

  var TOUCHE_RETOUR = 10009;
  // Lecture/pause : 10252 (Lecture/Pause), 415 (Lecture), 19 (Pause).
  document.addEventListener('keydown', function (e) {
    if ((e.keyCode === 10252 || e.keyCode === 415 || e.keyCode === 19) && TizenTV.lit && TizenTV.lit()) {
      e.preventDefault();
      TizenTV.basculerPause();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.keyCode !== TOUCHE_RETOUR) return;
    e.preventDefault();
    e.stopPropagation();
    if (global.AppNav && global.AppNav.back) global.AppNav.back();
  }, true);

  // Quitter l'application (dernier « Retour » depuis l'accueil).
  TizenTV.quitter = function () {
    try { global.tizen.application.getCurrentApplication().exit(); } catch (e) {}
  };

  // ---------- Lecture par AVPlay ----------
  function av() { return global.webapis && global.webapis.avplay; }
  TizenTV.lecteurDisponible = function () { return !!av(); };

  var objet = null;       // <object type="application/avplayer"> : zone vidéo
  var rappels = {};
  var enCours = false;
  var gels = 0;          // passages en chargement depuis l'ouverture (diagnostic)

  function zoneVideo() {
    if (objet) return objet;
    objet = document.createElement('object');
    objet.type = 'application/avplayer';
    objet.id = 'avplayer';
    objet.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:0;pointer-events:none';
    document.body.insertBefore(objet, document.body.firstChild);
    return objet;
  }

  // Coordonnées d'affichage d'AVPlay : celles de la résolution de
  // l'application (1920×1080), pas celles de la fenêtre en pixels CSS.
  // Image entière (bandes noires si le format diffère) ou plein écran
  // (étirée) : réglage mémorisé, comme le zoom de l'APK.
  var CLE_REMPLIR = 'iptv:tv:remplir';
  function remplir() { try { return localStorage.getItem(CLE_REMPLIR) === '1'; } catch (e) { return false; } }
  function plein() {
    try { av().setDisplayRect(0, 0, 1920, 1080); } catch (e) {}
    try {
      av().setDisplayMethod(remplir() ? 'PLAYER_DISPLAY_MODE_FULL_SCREEN' : 'PLAYER_DISPLAY_MODE_LETTER_BOX');
    } catch (e) {}
  }
  TizenTV.remplit = remplir;
  TizenTV.setRemplir = function (on) {
    try { localStorage.setItem(CLE_REMPLIR, on ? '1' : '0'); } catch (e) {}
    if (enCours) plein();
  };

  function fermer() {
    try { av().stop(); } catch (e) {}
    try { av().close(); } catch (e) {}
  }

  /**
   * Lance un flux. r = { pret(), chargement(bool), erreur(message), fin() }.
   * Chaque appel remplace le précédent.
   */
  TizenTV.lire = function (url, r) {
    var p = av();
    if (!p) return false;
    fermer();
    rappels = r || {};
    enCours = true;
    gels = 0;
    sousTitresActifs = false;
    zoneVideo();
    document.documentElement.classList.add('avplay-actif');
    try {
      p.open(url);
      plein();
      // Réserve avant de démarrer et après un gel : marge contre les
      // serveurs IPTV qui livrent par à-coups (même logique que l'APK).
      try { p.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 8); } catch (e) {}
      try { p.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', 15); } catch (e) {}
      p.setListener({
        onbufferingstart: function () { gels++; if (rappels.chargement) rappels.chargement(true); },
        onbufferingcomplete: function () { if (rappels.chargement) rappels.chargement(false); },
        onstreamcompleted: function () { if (rappels.fin) rappels.fin(); },
        onerror: function (type) { if (rappels.erreur) rappels.erreur(String(type)); },
        onsubtitlechange: function (duree, texte) { if (rappels.sousTitre) rappels.sousTitre(String(texte || ''), Number(duree) || 0); },
        onevent: function () {},
        oncurrentplaytime: function () {}
      });
      p.prepareAsync(function () {
        if (!enCours) return;
        try { p.play(); } catch (e) { if (rappels.erreur) rappels.erreur(e.message || String(e)); return; }
        if (rappels.pret) rappels.pret();
      }, function (e) {
        if (rappels.erreur) rappels.erreur((e && (e.name || e.message)) || 'préparation impossible');
      });
    } catch (e) {
      if (rappels.erreur) rappels.erreur(e.message || String(e));
    }
    return true;
  };

  TizenTV.arreter = function () {
    if (!enCours) return;
    enCours = false;
    rappels = {};
    fermer();
    document.documentElement.classList.remove('avplay-actif');
  };

  TizenTV.lit = function () { return enCours; };

  TizenTV.basculerPause = function () {
    var p = av();
    if (!p || !enCours) return;
    try {
      if (p.getState() === 'PLAYING') p.pause(); else p.play();
    } catch (e) {}
  };

  // Pistes audio : [{ index, langue, codec }]
  TizenTV.pistesAudio = function () { return pistes('AUDIO'); };

  function pistes(type) {
    var p = av();
    if (!p || !enCours) return [];
    try {
      return p.getTotalTrackInfo().filter(function (t) { return t.type === type; }).map(function (t) {
        var info = {};
        try { info = JSON.parse(t.extra_info || '{}'); } catch (e) {}
        return { index: t.index, langue: info.language || info.track_lang || '', codec: info.fourCC || '', info: info };
      });
    } catch (e) { return []; }
  }

  function courante(type) {
    var p = av();
    if (!p || !enCours) return null;
    try {
      var c = p.getCurrentStreamInfo().filter(function (t) { return t.type === type; })[0];
      if (!c) return null;
      var info = {};
      try { info = JSON.parse(c.extra_info || '{}'); } catch (e) {}
      return { index: c.index, info: info };
    } catch (e) { return null; }
  }

  TizenTV.pisteAudioCourante = function () { var c = courante('AUDIO'); return c ? c.index : -1; };
  TizenTV.pistesSousTitres = function () { return pistes('TEXT'); };
  var sousTitresActifs = false;
  TizenTV.sousTitreCourant = function () {
    if (!sousTitresActifs) return -1;
    var c = courante('TEXT');
    return c ? c.index : -1;
  };
  TizenTV.choisirSousTitres = function (index) {
    var p = av();
    if (!p || !enCours) return;
    sousTitresActifs = index !== -1;
    try {
      if (index !== -1) p.setSelectTrack('TEXT', index);
      p.setSilentSubtitle(index === -1);
    } catch (e) {}
  };

  // Mesures pour le diagnostic à l'écran.
  TizenTV.mesures = function () {
    var p = av();
    var m = { gels: gels };
    if (!p || !enCours) return m;
    try { m.etat = p.getState(); } catch (e) {}
    try { m.debit = Number(p.getStreamingProperty('CURRENT_BANDWIDTH')) || 0; } catch (e) {}
    var v = courante('VIDEO');
    if (v) {
      m.largeur = Number(v.info.Width) || 0;
      m.hauteur = Number(v.info.Height) || 0;
      m.codecVideo = v.info.fourCC || '';
      m.debitVideo = Number(v.info.Bit_rate) || 0;
      m.images = v.info.framerate || '';
    }
    var a = courante('AUDIO');
    if (a) {
      m.codecAudio = a.info.fourCC || '';
      m.langueAudio = a.info.language || '';
      m.frequence = a.info.sample_rate || '';
      m.canaux = a.info.channels || '';
    }
    return m;
  };

  TizenTV.choisirAudio = function (index) {
    var p = av();
    if (!p || !enCours) return;
    try { p.setSelectTrack('AUDIO', index); } catch (e) {}
  };

  // L'application passe en arrière-plan (touche Maison, autre appli) :
  // AVPlay doit être suspendu, puis repris au retour.
  document.addEventListener('visibilitychange', function () {
    var p = av();
    if (!p || !enCours) return;
    try {
      if (document.hidden) p.suspend(); else p.restore();
    } catch (e) {}
  });
})(window);

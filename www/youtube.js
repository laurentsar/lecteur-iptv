/* youtube.js — onglet YouTube : un top 5 de chaînes francophones par
 * sous-catégorie, chacune ouverte comme une playlist (ses dernières vidéos).
 *
 * Sans clé d'API YouTube, aucun classement « en direct » n'est possible :
 * la sélection est donc écrite ici, à la main. Chaque identifiant a été
 * vérifié le 2026-09-27 par le flux RSS officiel de la chaîne
 * (youtube.com/feeds/videos.xml?channel_id=…), qui renvoie son nom — ne pas
 * en ajouter un sans la même vérification : un identifiant faux ouvre une
 * page vide sur la télé.
 *
 * La « playlist » d'une chaîne est sa liste d'envois : même identifiant,
 * préfixe UU au lieu de UC. Sur l'APK, le lien part vers l'appli YouTube
 * installée (YouTube pour TV sur un téléviseur) par NativePlayer.openExternal ;
 * sur la PWA, dans un nouvel onglet. */
(function (global) {
  'use strict';

  var CATEGORIES = [
    { id: 'actus', nom: '📰 Actualités', chaines: [
      { id: 'UCAcAnMF0OrCtUep3Y4M-ZPw', nom: 'HugoDécrypte', desc: 'L’actu du jour expliquée' },
      { id: 'UCO6K_kkdP-lnSCiO3tPx7WA', nom: 'franceinfo', desc: 'Info en continu, reportages' },
      { id: 'UCCCPCZNChQdGa9EkATeye4g', nom: 'FRANCE 24', desc: 'Actualité internationale' },
      { id: 'UCYpRDnhk5H8h16jpS84uqsA', nom: 'Le Monde', desc: 'Vidéos explicatives du quotidien' },
      { id: 'UCJE3Mi77VYiirkGW_l_SpGQ', nom: 'ARTE Info', desc: 'Journal et décryptages d’ARTE' }
    ] },
    { id: 'sciences', nom: '🔬 Sciences', chaines: [
      { id: 'UCaNlbnghtwlsGF-KzAFThqA', nom: 'ScienceEtonnante', desc: 'Physique, maths, IA' },
      { id: 'UCWnfDPdZw6A23UtuBpYBbAg', nom: 'Dr Nozman', desc: 'Sciences et expériences' },
      { id: 'UCtqICqGbPSbTN09K1_7VZ3Q', nom: 'DirtyBiology', desc: 'Biologie décalée' },
      { id: 'UC5X4e8ScZI2AFd_vkjSoyoQ', nom: 'AstronoGeek', desc: 'Astronomie et espace' },
      { id: 'UCLXDNUOO3EQ80VmD9nQBHPg', nom: 'Fouloscopie', desc: 'Science des foules' }
    ] },
    { id: 'culture', nom: '📚 Histoire & culture', chaines: [
      { id: 'UCP46_MXP_WG_auH88FnfS1A', nom: 'Nota Bene', desc: 'Histoire racontée' },
      { id: 'UC5Twj1Axp_-9HLsZ5o_cEQQ', nom: 'Doc Seven', desc: 'Anecdotes et culture générale' },
      { id: 'UC7sXGI8p8PvKosLWagkK9wQ', nom: 'Heu?reka', desc: 'Économie et finance' },
      { id: 'UCqA8H22FwgBVcF3GJpp0MQw', nom: 'Monsieur Phi', desc: 'Philosophie' },
      { id: 'UCofQxJWd4qkqc7ZgaLkZfcw', nom: 'Linguisticae', desc: 'Langues et linguistique' }
    ] },
    { id: 'humour', nom: '😂 Humour', chaines: [
      { id: 'UCWeg2Pkate69NFdBeuRFTAw', nom: 'Squeezie', desc: 'Divertissement, concepts' },
      { id: 'UCyWqModMQlbIo8274Wh_ZsQ', nom: 'Cyprien', desc: 'Sketchs et vidéos humour' },
      { id: 'UCww2zZWg4Cf5xcRKG-ThmXQ', nom: 'Norman', desc: 'Sketchs du quotidien' },
      { id: 'UCgvqvBoSHB1ctlyyhoHrGwQ', nom: 'Amixem', desc: 'Défis et divertissement' },
      { id: 'UCo3i0nUzZjjLuM7VjAVz4zA', nom: 'Michou', desc: 'Défis et vlogs' }
    ] },
    { id: 'jeux', nom: '🎮 Jeux vidéo', chaines: [
      { id: 'UC_yP2DpIgs5Y1uWC0T03Chw', nom: 'Joueur du Grenier', desc: 'Tests de jeux rétro' },
      { id: 'UCCMxHHciWRBBouzk-PGzmtQ', nom: 'Bazar du Grenier', desc: 'Parties et découvertes' },
      { id: 'UCYGjxo5ifuhnmvhPvCc3DJQ', nom: 'Wankil Studio', desc: 'Laink et Terracid' },
      { id: 'UC9NB2nXjNtRabu3YLPB16Hg', nom: 'J’suis pas content TV', desc: 'Critiques de jeux' },
      { id: 'UCLOAPb7ATQUs_nDs9ViLcMw', nom: 'Benjamin Code', desc: 'Informatique et jeux' }
    ] },
    { id: 'cuisine', nom: '🍳 Cuisine', chaines: [
      { id: 'UCgCEqjKOabA2_IvZ-agkQCQ', nom: 'Hervé Cuisine', desc: 'Recettes pas à pas' },
      { id: 'UCmKCpHH5ATFMURHTRC2jLyA', nom: 'Marmiton', desc: 'Recettes du quotidien' },
      { id: 'UC8qxftC5pwxJZsfuLrlClJA', nom: '750g', desc: 'Recettes et techniques' },
      { id: 'UC8AdLDn2gJf2sam4HJXGX3g', nom: 'CuisineAZ', desc: 'Recettes faciles' },
      { id: 'UC-gypmlgWrRXTW_TGgrgtZg', nom: 'Ma cuisine du monde', desc: 'Cuisines d’ailleurs' }
    ] },
    { id: 'musique', nom: '🎵 Musique', chaines: [
      { id: 'UCcVkWrg_Q00xVigRquzSY4g', nom: 'Universal Music France', desc: 'Clips officiels' },
      { id: 'UCAJuYnKFVGBoVsBO4_svrrQ', nom: 'Warner Music France', desc: 'Clips officiels' },
      { id: 'UC2kZYr2B929kXdSG6LPa9pQ', nom: 'NRJ', desc: 'Hits et lives' },
      { id: 'UC-OLGr8mJW6EfFbCt-E6yOg', nom: 'Nostalgie', desc: 'Années 70, 80, 90' },
      { id: 'UC-smeLB9AnOTeypr1YyjJ3A', nom: 'ARTE Concert', desc: 'Concerts filmés' }
    ] },
    { id: 'sport', nom: '⚽ Sport', chaines: [
      { id: 'UC8ggH3zU61XO0nMskSQwZdA', nom: 'CANAL+ Sport', desc: 'Foot, rugby, F1' },
      { id: 'UCfj4kQ6_mYO5r4hzX5KloVw', nom: 'beIN SPORTS France', desc: 'Résumés et temps forts' },
      { id: 'UCGSiCI_RdAIezAAedP_46TA', nom: 'L’Équipe', desc: 'Toute l’actu sport' },
      { id: 'UChysErndYl-zSsmB-0H0S_g', nom: 'FFF TV', desc: 'Équipes de France de foot' },
      { id: 'UCDqrC9HH1w7hyZCspmukU6A', nom: 'RMC Sport Combat', desc: 'MMA, UFC, boxe' }
    ] },
    { id: 'enfants', nom: '🧸 Enfants', chaines: [
      { id: 'UCaIcgxGFjyfZgoIaJT0s0hQ', nom: 'Gulli', desc: 'Dessins animés' },
      { id: 'UCaAHSGlYiU2fgxwKOIWBlpQ', nom: 'Tchoupi', desc: 'Épisodes pour les petits' },
      { id: 'UC8I-UIlXPNS4luC4iV7dRdQ', nom: 'Titounis', desc: 'Comptines' },
      { id: 'UCCWAytpcZqyTfRsLJvDHxLg', nom: 'Comptines.net', desc: 'Chansons pour enfants' },
      { id: 'UCSp2f6yQYuzOavit1V81pZA', nom: 'Little Angel Français', desc: 'Comptines animées' }
    ] }
  ];

  function playlistUrl(channelId) {
    return 'https://www.youtube.com/playlist?list=UU' + channelId.slice(2);
  }

  function ouvrir(url) {
    var cap = global.Capacitor;
    var natif = cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.NativePlayer;
    if (natif && natif.openExternal) {
      return natif.openExternal({ url: url }).catch(function (err) {
        if (global.AppToast) global.AppToast('YouTube introuvable : ' + (err && err.message || err));
      });
    }
    global.open(url, '_blank', 'noopener');
    return Promise.resolve();
  }

  // Dernière vidéo de la chaîne (miniature + titre) lue dans son flux RSS :
  // donne à chaque carte un visuel à jour, sans clé d'API. Échec = carte
  // sans image, jamais bloquant.
  var apercus = {};
  function apercu(channelId) {
    if (apercus[channelId]) return apercus[channelId];
    var Net = global.Net;
    var p = !Net ? Promise.resolve(null) :
      Net.fetchText('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId).then(function (xml) {
        var vid = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(xml);
        var titres = xml.match(/<title>([^<]*)<\/title>/g) || [];
        var titre = titres[1] ? titres[1].replace(/<\/?title>/g, '') : '';
        return vid ? { videoId: vid[1], titre: decode(titre) } : null;
      }).catch(function () { return null; });
    apercus[channelId] = p;
    return p;
  }

  function decode(s) {
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }

  var courante = CATEGORIES[0].id;

  function render() {
    var chips = document.getElementById('ytCategories');
    var grille = document.getElementById('ytChaines');
    if (!chips || !grille) return;

    chips.innerHTML = '';
    CATEGORIES.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (c.id === courante ? ' active' : '');
      b.textContent = c.nom;
      b.addEventListener('click', function () {
        courante = c.id;
        render();
        var actif = chips.querySelector('.chip.active');
        if (actif) actif.focus();
      });
      chips.appendChild(b);
    });

    var cat = CATEGORIES.filter(function (c) { return c.id === courante; })[0];
    grille.innerHTML = '';
    cat.chaines.forEach(function (ch, i) {
      var carte = document.createElement('button');
      carte.type = 'button';
      carte.className = 'carte yt-carte';
      var vignette = document.createElement('div');
      vignette.className = 'yt-vignette';
      var rang = document.createElement('span');
      rang.className = 'yt-rang';
      rang.textContent = String(i + 1);
      vignette.appendChild(rang);
      var nom = document.createElement('div');
      nom.className = 'yt-nom';
      nom.textContent = ch.nom;
      var desc = document.createElement('div');
      desc.className = 'yt-desc';
      desc.textContent = ch.desc;
      carte.appendChild(vignette);
      carte.appendChild(nom);
      carte.appendChild(desc);
      carte.title = 'Ouvrir la playlist de ' + ch.nom + ' dans YouTube';
      carte.addEventListener('click', function () { ouvrir(playlistUrl(ch.id)); });
      grille.appendChild(carte);

      apercu(ch.id).then(function (a) {
        if (!a) return;
        vignette.style.backgroundImage = 'url("https://i.ytimg.com/vi/' + a.videoId + '/mqdefault.jpg")';
        desc.textContent = 'Dernière vidéo : ' + a.titre;
      });
    });
  }

  global.YouTubeTab = { render: render, CATEGORIES: CATEGORIES, playlistUrl: playlistUrl };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.YouTubeTab;

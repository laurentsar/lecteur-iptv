/* youtube.js — onglet YouTube : un top 5 (ou plus) de chaînes francophones
 * par sous-catégorie, chacune ouverte comme une playlist (ses dernières
 * vidéos).
 *
 * Sans clé d'API YouTube, aucun classement « en direct » n'est possible :
 * le classement est tiré de sources publiques croisées (voir CATEGORIES). Chaque identifiant a été
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

  /* Chaque catégorie croise au moins 3 classements publics (liens dans
   * `sources`, affichés sous les onglets). Règle : on compte combien de
   * sources citent la chaîne (`cite`), puis on départage par le rang moyen ;
   * on garde toutes celles citées par ≥ 3 sources, et on complète jusqu'à 5
   * avec les mieux classées citées par 2. Relevé du 2026-09-27.
   * Écartées faute d'identifiant vérifiable : Wiloo (sport, 3 citations),
   * Grizzy & les Lemmings (enfants, aucune chaîne FR officielle trouvée). */
  var CATEGORIES = [
    { id: 'actus', nom: '📰 Actualités', sources: [
      { nom: 'HypeAuditor', url: 'https://hypeauditor.com/top-youtube-news-politics-france/' },
      { nom: 'Insight NPA', url: 'https://insight.npaconseil.com/contenus-audiences/chaines-info-youtube/' },
      { nom: 'Netguide', url: 'https://www.netguide.com/Chaines-Youtube-sur-l-actualite/' }
    ], chaines: [
      { id: 'UCewhc0fvja891XkpIPGRMxQ', nom: 'LCI', cite: 3 },
      { id: 'UCXwDLMDV86ldKoFVc_g8P0g', nom: 'BFMTV', cite: 2 },
      { id: 'UCIMGfEAERXjmWwQeg15BFsg', nom: 'Europe 1', cite: 2 },
      { id: 'UCW2QcKZiU8aUGg4yxCIditg', nom: 'euronews (en français)', cite: 2 },
      { id: 'UCXKJrYczY2_fJEZgFPGY0HQ', nom: 'CNEWS', cite: 2 }
    ] },
    { id: 'sciences', nom: '🔬 Sciences', sources: [
      { nom: 'OkayDoc', url: 'https://okaydoc.fr/vulgarisation-scientifique-top-10-influenceurs-francais/' },
      { nom: 'Agence Waldo', url: 'https://www.blog.agencewaldo.com/classement-de-12-chaines-youtube-francaises-specialisees-en-sciences/' },
      { nom: 'TechRadar', url: 'https://global.techradar.com/fr-fr/news/meilleures-chaines-youtube-science' },
      { nom: 'Ekole', url: 'https://www.ekole.fr/blog/top-15-influenceurs-science-education' }
    ], chaines: [
      { id: 'UCWnfDPdZw6A23UtuBpYBbAg', nom: 'Dr Nozman', cite: 4 },
      { id: 'UC4ii4_aeS8iOFzsHuhJTq2w', nom: 'Poisson Fécond', cite: 4 },
      { id: 'UCaNlbnghtwlsGF-KzAFThqA', nom: 'ScienceEtonnante', cite: 4 },
      { id: 'UC5X4e8ScZI2AFd_vkjSoyoQ', nom: 'AstronoGeek', cite: 4 },
      { id: 'UCtqICqGbPSbTN09K1_7VZ3Q', nom: 'DirtyBiology', cite: 3 },
      { id: 'UCS_7tplUgzJG4DhA16re5Yg', nom: 'Balade Mentale', cite: 3 }
    ] },
    { id: 'histoire', nom: '📚 Histoire', sources: [
      { nom: 'GoStudent', url: 'https://www.gostudent.org/fr-fr/blog/meilleures-chaines-youtube-histoire' },
      { nom: 'SensCritique', url: 'https://www.senscritique.com/liste/10_meilleures_chaines_youtube_d_histoire_youtubeur_histoire/3219066' },
      { nom: 'Master Your French', url: 'https://www.masteryourfrench.com/culture/history-youtube-channels/' },
      { nom: 'Histoire itinérante', url: 'https://histoire-itinerante.fr/conseils-visionnages/chaines-histoire-youtube-youtubing-historique/' }
    ], chaines: [
      { id: 'UCCGRtSqLfljpX9mzCYDsQIg', nom: 'Questions d’Histoire', cite: 4 },
      { id: 'UCP46_MXP_WG_auH88FnfS1A', nom: 'Nota Bene', cite: 3 },
      { id: 'UCcT7B4zCzrfywO2Q19OJIzA', nom: 'Histoire Appliquée', cite: 3 },
      { id: 'UCoTIMvoWvphhITZJ62Vr0AQ', nom: 'Sur le Champ', cite: 3 },
      { id: 'UCqMMC5g3WBuc3LmxIgqIsRw', nom: 'Batailles de France', cite: 2 }
    ] },
    { id: 'humour', nom: '😂 Humour', sources: [
      { nom: 'L’ADN', url: 'https://www.ladn.eu/media-mutants/reseaux-sociaux/classement-youtubeurs-humour-influence/' },
      { nom: 'Webeev', url: 'https://www.webeev.fr/top/top-10-meilleurs-youtubeurs-francais-plus-droles/' },
      { nom: '10h26', url: 'https://www.10h26.com/top-youtubeurs-francais-droles-interessants' },
      { nom: 'O-pentech', url: 'https://www.o-pentech.com/meilleurs-youtubeurs-francais/' },
      { nom: 'Woo Paris', url: 'https://www.woo.paris/blog/top-chaines-youtube-france' }
    ], chaines: [
      { id: 'UCyWqModMQlbIo8274Wh_ZsQ', nom: 'Cyprien', cite: 5 },
      { id: 'UCWeg2Pkate69NFdBeuRFTAw', nom: 'Squeezie', cite: 4 },
      { id: 'UCtihF1ZtlYVzoaj_bKLQZ-Q', nom: 'Natoo', cite: 4 },
      { id: 'UCww2zZWg4Cf5xcRKG-ThmXQ', nom: 'Norman', cite: 3 },
      { id: 'UC8Q0SLrZLiTj5s4qc9aad-w', nom: 'Mister V', cite: 3 },
      { id: 'UCDPK_MTu3uTUFJXRVcTJcEw', nom: 'McFly et Carlito', cite: 3 },
      { id: 'UCK3inMNRNAVUleEbpDU1k2g', nom: 'SEB', cite: 3 }
    ] },
    { id: 'jeux', nom: '🎮 Jeux vidéo', sources: [
      { nom: 'Influence4You', url: 'https://blogfr.influence4you.com/classement-des-5-youtubers-de-jeux-video/' },
      { nom: 'TechRadar', url: 'https://global.techradar.com/fr-fr/news/meilleures-chaines-youtube-jeux-video' },
      { nom: 'Filmora', url: 'https://filmora.wondershare.fr/vlogger/top10-gameurs-francais-youtube.html' },
      { nom: 'Woo Paris', url: 'https://www.woo.paris/blog/top-chaines-youtube-france' },
      { nom: 'HypeAuditor', url: 'https://hypeauditor.com/top-youtube-video-games-france/' }
    ], chaines: [
      { id: 'UCY-_QmcW09PHAImgVnKxU2g', nom: 'Squeezie Gaming', cite: 4 },
      { id: 'UCCFqUJYKT97UerMmb6DM0bw', nom: 'Gotaga', cite: 4 },
      { id: 'UC_yP2DpIgs5Y1uWC0T03Chw', nom: 'Joueur du Grenier', cite: 3 },
      { id: 'UCgvqvBoSHB1ctlyyhoHrGwQ', nom: 'Amixem', cite: 2 },
      { id: 'UCDlg0T0r9v2_XRCG8yqB2vQ', nom: 'Galax', cite: 2 }
    ] },
    { id: 'cuisine', nom: '🍳 Cuisine', sources: [
      { nom: 'Agence Waldo', url: 'https://www.blog.agencewaldo.com/classement-de-12-chaines-youtube-francaises-specialisees-en-food/' },
      { nom: 'L’ADN', url: 'https://www.ladn.eu/media-mutants/top-chaine-cuisine-reseaux-sociaux/' },
      { nom: 'SensCritique', url: 'https://www.senscritique.com/liste/30_meilleure_chaine_de_recette_de_cuisine_facile_vegetarienn/3219074' },
      { nom: 'Woo Paris', url: 'https://www.woo.paris/blog/top-chaines-youtube-france' }
    ], chaines: [
      { id: 'UCT4mPf6yV7QJMhRSckfwghA', nom: 'Chez Jigmé', cite: 3 },
      { id: 'UCfI1q93ZYNR_mJYKFEqxfrA', nom: 'Gastronogeek', cite: 2 },
      { id: 'UCgCEqjKOabA2_IvZ-agkQCQ', nom: 'Hervé Cuisine', cite: 2 },
      { id: 'UCKq9JxyISqBHDd-fXfV3QtQ', nom: 'FastGoodCuisine', cite: 2 },
      { id: 'UC-YIuf9kbZoPcnmONP-iGIA', nom: 'JustInCooking', cite: 2 }
    ] },
    { id: 'musique', nom: '🎵 Musique', sources: [
      { nom: 'Digitiz', url: 'https://digitiz.fr/chaines-youtube-france/' },
      { nom: 'Blog du Modérateur', url: 'https://www.blogdumoderateur.com/chaines-youtube-suivies-france-monde/' },
      { nom: 'Les 10 meilleurs', url: 'https://les10meilleurs.net/chaines-youtube-francaises-avec-le-plus-abonnes/' },
      { nom: 'HypeAuditor', url: 'https://hypeauditor.com/top-youtube-all-france/' },
      { nom: 'Séries Animes', url: 'https://www.series-animes.fr/youtube-classement-france-2026/' }
    ], chaines: [
      { id: 'UCCB1Byx5yTbLpQaV-rlfmtA', nom: 'GIMS', cite: 5 },
      { id: 'UCSJ4gkVC6NrvII8umztf0Ow', nom: 'Lofi Girl', cite: 4 },
      { id: 'UCz6JjQtnK9XjMwKuqlEkRxw', nom: 'Soolking', cite: 4 },
      { id: 'UC-69vhXlCa3XHbF8JHCQHfg', nom: 'Aya Nakamura', cite: 2 }
    ] },
    { id: 'sport', nom: '⚽ Sport', sources: [
      { nom: 'LiveSports', url: 'https://livesports.co/fr/top-30-des-chaines-youtube-sportives-francophones-a-suivre-en-2026/' },
      { nom: 'SPEAKRJ', url: 'https://www.speakrj.com/audit/top/youtube/fr/Sport' },
      { nom: 'HypeAuditor', url: 'https://hypeauditor.com/top-youtube-sports-france/' }
    ], chaines: [
      { id: 'UCGSiCI_RdAIezAAedP_46TA', nom: 'L’Équipe', cite: 3 },
      { id: 'UC0D-vfqoAHvOYmHxDJDlLFw', nom: 'Foot Mercato', cite: 3 },
      { id: 'UCQEWraynL44i7RC8UZcjE8Q', nom: 'Oh My Goal', cite: 3 },
      { id: 'UChysErndYl-zSsmB-0H0S_g', nom: 'FFF TV', cite: 2 },
      { id: 'UCaHUPgzDZgMGGe0dAixfVhQ', nom: 'L’Immigré Parisien', cite: 2 }
    ] },
    { id: 'enfants', nom: '🧸 Enfants', sources: [
      { nom: 'Digitiz', url: 'https://digitiz.fr/chaines-youtube-france/' },
      { nom: 'Blog du Modérateur', url: 'https://www.blogdumoderateur.com/chaines-youtube-suivies-france-monde/' },
      { nom: 'Les 10 meilleurs', url: 'https://les10meilleurs.net/chaines-youtube-francaises-avec-le-plus-abonnes/' },
      { nom: 'Happy Mums', url: 'https://www.happymumsandcoolkids.fr/chaines-youtubes-pour-enfants' },
      { nom: 'Netguide', url: 'https://www.netguide.com/Chaines-Youtube-de-dessins-animes/' },
      { nom: 'Hop’Toys', url: 'https://www.bloghoptoys.fr/5-chaine-youtubes-a-connaitre' },
      { nom: 'Maxi Flash', url: 'https://haguenau.maxi-flash.com/confinement-des-chaines-youtube-pour-les-enfants/' }
    ], chaines: [
      { id: 'UCVJBBtQvsJVNkl9KGBnhAQA', nom: 'Oggy et les Cafards', cite: 3 },
      { id: 'UCW9KPpAY22Nqdw-1heAh5Cw', nom: 'Mouk', cite: 2 },
      { id: 'UCjd32KVfRCli1d9iqo4YZ5A', nom: 'Masha et Michka', cite: 2 },
      { id: 'UCvMmE1XrtxPgxZNePpedUBg', nom: 'Le Monde des Titounis', cite: 2 },
      { id: 'UC9pxNghOaqpW4FzW74_KS1Q', nom: 'Les P’tits z’Amis', cite: 2 }
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
      desc.textContent = '';
      var texte = document.createElement('div');
      texte.className = 'yt-texte';
      texte.appendChild(nom);
      texte.appendChild(desc);
      carte.appendChild(vignette);
      carte.appendChild(texte);
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

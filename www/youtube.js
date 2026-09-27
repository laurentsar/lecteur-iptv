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
      { id: 'UCtBzfGaJzGGNJVOVM0mK4uQ', nom: 'JustInCooking', cite: 2 }
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
      { id: 'UCyIV8rkza5Uk_sJIhqilBvQ', nom: 'L’Équipe', cite: 3 },
      { id: 'UCrzDtXyuSBch2u_31JJj-Dw', nom: 'Foot Mercato', cite: 3 },
      { id: 'UCQEWraynL44i7RC8UZcjE8Q', nom: 'Oh My Goal', cite: 3 },
      { id: 'UCeJlXGyEl7kBgQJKADAHM3A', nom: 'Fédération Française de Football', cite: 2 },
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
      { id: 'UC8I-UIlXPNS4luC4iV7dRdQ', nom: 'Titounis', cite: 2 },
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

  // Dernière vidéo de la chaîne (miniature + titre) et audience, lues dans son
  // flux RSS : sans clé d'API. Échec = carte sans image, jamais bloquant.
  var apercus = {};
  function apercu(channelId) {
    if (apercus[channelId]) return apercus[channelId];
    var Net = global.Net;
    var p = !Net ? Promise.resolve(null) :
      Net.fetchText('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId).then(function (xml) {
        var vid = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(xml);
        var titres = xml.match(/<title>([^<]*)<\/title>/g) || [];
        var titre = titres[1] ? titres[1].replace(/<\/?title>/g, '') : '';
        return { videoId: vid ? vid[1] : null, titre: decode(titre), audience: audienceDepuisRss(xml, Date.now()) };
      }).catch(function () { return null; });
    apercus[channelId] = p;
    return p;
  }

  /* Audience d'une chaîne, mesurée dans son flux RSS (15 dernières vidéos) :
   * - j : vues par jour = total des vues du flux ÷ nombre de jours qu'il
   *   couvre. Juste pour tous les rythmes : une chaîne d'info qui publie 15
   *   vidéos par jour et un vidéaste qui en sort une par mois sont comparés
   *   sur ce qu'ils attirent réellement, par jour.
   * - d : date de la dernière vidéo, pour écarter les chaînes à l'arrêt.
   * null = flux vide ou illisible. */
  function audienceDepuisRss(xml, maintenant) {
    var entrees = String(xml || '').split('<entry>').slice(1);
    var total = 0, premiere = maintenant, derniere = 0, n = 0;
    entrees.forEach(function (e) {
      var pub = /<published>([^<]+)<\/published>/.exec(e);
      var st = /<media:statistics views="(\d+)"/.exec(e);
      if (!pub || !st) return;
      var t = Date.parse(pub[1]);
      if (isNaN(t)) return;
      total += Number(st[1]); n++;
      premiere = Math.min(premiere, t); derniere = Math.max(derniere, t);
    });
    if (!n) return null;
    var jours = Math.max(1, (maintenant - premiere) / (24 * 3600 * 1000));
    return { j: Math.round(total / jours), d: derniere };
  }

  // Une chaîne sans nouvelle vidéo depuis 6 mois disparaît du classement.
  var INACTIVE = 183 * 24 * 3600 * 1000;

  // Ordre d'affichage : vues par jour décroissantes, chaînes à l'arrêt
  // retirées ; celles sans mesure (réseau) gardent leur place, à la fin.
  function trierParAudience(chaines, audiences, maintenant) {
    if (!audiences) return chaines.slice();
    maintenant = maintenant || Date.now();
    return chaines.map(function (ch, i) { return { ch: ch, i: i, a: audiences[ch.id] }; })
      .filter(function (x) { return !(x.a && maintenant - x.a.d > INACTIVE); })
      .sort(function (x, y) {
        if (x.a && y.a && x.a.j !== y.a.j) return y.a.j - x.a.j;
        if (!!x.a !== !!y.a) return x.a ? -1 : 1;
        return x.i - y.i;
      })
      .map(function (x) { return x.ch; });
  }

  /* Recalcul mensuel, dans l'appli : une fois par mois (cache IndexedDB),
   * l'audience de toutes les chaînes est remesurée et le classement de chaque
   * catégorie suit. Quatre flux à la fois au plus, pour ne pas saturer une
   * télé ou une petite connexion. */
  var audiences = null;
  function recalculerAudience(apres) {
    var St = global.Store;
    if (!St || !St.kvGet) return;
    St.kvGet('yt-audience-v2').catch(function () { return null; }).then(function (c) {
      if (c && c.audiences) { audiences = c.audiences; apres(); }
      if (c && Date.now() - c.t < MOIS) return;
      var ids = [];
      categories().forEach(function (cat) { cat.chaines.forEach(function (ch) { if (ids.indexOf(ch.id) < 0) ids.push(ch.id); }); });
      var res = {}, k = 0;
      function suivant() {
        if (k >= ids.length) return Promise.resolve();
        var id = ids[k++];
        return apercu(id).then(function (a) { if (a && a.audience) res[id] = a.audience; }).then(suivant);
      }
      return Promise.all([suivant(), suivant(), suivant(), suivant()]).then(function () {
        if (!Object.keys(res).length) return;   // hors ligne : on réessaiera
        audiences = res;
        St.kvSet('yt-audience-v2', { t: Date.now(), audiences: res }).catch(function () {});
        apres();
      });
    }).catch(function () {});
  }

  function decode(s) {
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }

  /* Mise à jour mensuelle du classement.
   *
   * Le recalcul (lire les classements publics, les croiser, vérifier les
   * identifiants) ne peut pas tourner dans l'appli : il demande du jugement.
   * Il est refait une fois par mois hors de l'appli et publié dans
   * www/youtube-top.json du dépôt ; l'appli relit ce fichier au plus une fois
   * par mois (cache IndexedDB), et garde CATEGORIES ci-dessus si le réseau
   * échoue ou si le fichier est mal formé. */
  var URL_TOP = 'https://raw.githubusercontent.com/laurentsar/lecteur-iptv/main/www/youtube-top.json';
  var MOIS = 30 * 24 * 3600 * 1000;
  var distantes = null;

  function valide(d) {
    if (!d || !Array.isArray(d.categories) || !d.categories.length) return false;
    return d.categories.every(function (c) {
      return c && c.id && c.nom && Array.isArray(c.chaines) && c.chaines.length &&
        c.chaines.every(function (ch) { return ch && ch.nom && /^UC[\w-]{22}$/.test(ch.id); });
    });
  }

  function categories() { return distantes || CATEGORIES; }

  function chargerDistant(apres) {
    var St = global.Store, Net = global.Net;
    if (!St || !St.kvGet || !Net) return;
    St.kvGet('yt-top').catch(function () { return null; }).then(function (c) {
      if (c && valide(c.data)) distantes = c.data;
      if (c && Date.now() - c.t < MOIS) { if (distantes) apres(); return; }
      return Net.fetchText(URL_TOP + '?t=' + Date.now()).then(function (txt) {
        var d = JSON.parse(txt);
        if (!valide(d)) return;
        distantes = d;
        St.kvSet('yt-top', { t: Date.now(), data: d }).catch(function () {});
        apres();
      });
    }).catch(function () {});
  }

  var courante = CATEGORIES[0].id;
  var chargeLance = false;

  function render() {
    if (!chargeLance) {
      chargeLance = true;
      var rafraichir = function () {
        var panneau = document.getElementById('tab-youtube');
        if (panneau && panneau.classList.contains('active')) render();
      };
      chargerDistant(rafraichir);
      recalculerAudience(rafraichir);
    }
    var chips = document.getElementById('ytCategories');
    var grille = document.getElementById('ytChaines');
    if (!chips || !grille) return;

    chips.innerHTML = '';
    categories().forEach(function (c) {
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

    var cat = categories().filter(function (c) { return c.id === courante; })[0] || categories()[0];
    courante = cat.id;
    grille.innerHTML = '';
    trierParAudience(cat.chaines, audiences).forEach(function (ch, i) {
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
        if (!a || !a.videoId) return;
        vignette.style.backgroundImage = 'url("https://i.ytimg.com/vi/' + a.videoId + '/mqdefault.jpg")';
        desc.textContent = 'Dernière vidéo : ' + a.titre;
      });
    });
  }

  global.YouTubeTab = { render: render, CATEGORIES: CATEGORIES, playlistUrl: playlistUrl, valide: valide,
    audienceDepuisRss: audienceDepuisRss, trierParAudience: trierParAudience };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.YouTubeTab;

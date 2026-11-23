/* catalogue.js — noms de chaînes, de bouquets et radios par défaut.
 *
 * Fonctions sans état d'interface, sorties d'app.js : regroupement des
 * doublons d'une chaîne, entrées à masquer, icône et pays d'un bouquet,
 * catégories « adulte », recherche par nom, stations de radio fournies
 * d'office. app.js les reprend sous leurs noms d'origine.
 */
(function (global) {
  'use strict';

  var Epg = global.Epg, SourceQuality = global.SourceQuality;

  // Chaînes de bienvenue/pub insérées par certains fournisseurs IPTV, sans
  // contenu réel — masquées par préfixe (insensible à la casse), le
  // fournisseur faisant varier le suffixe ("... TV", "... IPTV", ...).
  // Un premier correctif (caractères invisibles retirés) n'a pas suffi :
  // encore visible sur le terrain avec le JS pourtant à jour (donc pas un
  // problème de cache) — un espace insécable ou une autre décoration entre
  // "welcome" et "ultimate" (espace multiple, tiret...) faisait toujours
  // échouer le \s littéral du motif. Repli sur la même normalisation que
  // l'appariement EPG par nom (Epg.normalizeChanName, voir epg.js) :
  // accents/casse retirés, tout caractère non alphanumérique supprimé — un
  // simple test de sous-chaîne ne peut alors plus être mis en échec par la
  // ponctuation ou l'espacement, quels qu'ils soient.
  // Ces deux fonctions sont appelées une fois PAR ENTRÉE à chaque rendu d'une
  // grille — donc jusqu'à dix mille fois par affichage, et de nouveau à chaque
  // recherche. Or elles sont coûteuses : normalizeChanName fait une
  // normalisation Unicode NFD complète, et channelFamilyKey enchaîne cinq
  // expressions régulières. Les noms, eux, ne changent pas tant qu'on reste
  // sur la même playlist : on mémorise le résultat par nom (vidé en changeant
  // de playlist, voir resetNameCaches).
  var hiddenCache = Object.create(null);
  var familyCache = Object.create(null);
  function resetNameCaches() {
    hiddenCache = Object.create(null);
    familyCache = Object.create(null);
  }

  function isHiddenChannel(name) {
    var k = name || '';
    var v = hiddenCache[k];
    if (v === undefined) {
      v = Epg.normalizeChanName(k).indexOf('welcomeultimate') !== -1;
      hiddenCache[k] = v;
    }
    return v;
  }

  // Beaucoup de playlists (surtout M3U) listent la même chaîne ou le même
  // film plusieurs fois sous des noms voisins — sources de secours,
  // qualités différentes ("TF1", "TF1 HD", "TF1 FHD (2)", "Inception 4K"...).
  // On les regroupe sous une seule carte à partir d'une clé normalisée (nom
  // sans mention de qualité/source ni ponctuation), et on garde chaque
  // entrée d'origine dans `versions` : pratique pour retomber sur une
  // source plus légère si le débit est faible, sans avoir à fouiller une
  // liste pleine de doublons.
  var CHANNEL_QUALITY_TAGS = /\b(4k|uhd|fhd|full ?hd|hd|sd|hevc|h ?265|h ?264|vostfr|vf|vo|multi)\b/gi;
  function channelFamilyKey(name) {
    var memo = familyCache[name || ''];
    if (memo !== undefined) return memo;
    var key = String(name || '')
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(CHANNEL_QUALITY_TAGS, ' ')
      .replace(/[^a-z0-9+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    key = key || String(name || '').toLowerCase().trim();
    familyCache[name || ''] = key;
    return key;
  }

  // Exclut les entrées radio (catégorie détectée par nom, voir kind:'radio'
  // dans ensureXtreamItems/m3u.js classifyGroup) des vues « En direct » —
  // elles ont leur propre onglet Radio. Pour les playlists M3U, ce filtre
  // est déjà implicite (les items radio ne passent jamais kind==='live') ;
  // utile surtout côté Xtream où get_live_streams renvoie tout ensemble.
  function excludeRadio(items) { return items.filter(function (it) { return it.kind !== 'radio'; }); }
  function excludeHidden(items) { return items.filter(function (it) { return !isHiddenChannel(it.name); }); }

  function groupChannels(items) {
    var byKey = {}, order = [];
    items.forEach(function (it) {
      var fam = channelFamilyKey(it.name);
      if (!byKey[fam]) { byKey[fam] = []; order.push(fam); }
      byKey[fam].push(it);
    });
    return order.map(function (fam) {
      var versions = byKey[fam];
      var logo = versions.map(function (v) { return v.logo; }).filter(Boolean)[0] || null;
      // La source jouée par défaut est la mieux notée par SourceQuality
      // (4K > FHD > HD > SD, devinée au nom) — la meilleure image dès le
      // premier lancement, pas seulement en cas de repli. Si elle se coupe
      // sans arrêt, les lecteurs basculent automatiquement sur la suivante
      // dans cette même liste triée, donc de qualité inférieure ou égale,
      // sans jamais remonter (voir source-quality.js) : la fiabilité reste
      // couverte par ce mécanisme de repli, pas par le choix initial.
      var ordonnees = SourceQuality.ordonner(versions);
      var principal = ordonnees[0];
      return Object.assign({}, principal, { logo: logo, versions: ordonnees });
    });
  }

  function matchesSearch(item, q) {
    if (!q) return true;
    return (item.name || '').toLowerCase().indexOf(q) !== -1;
  }

  // Chaîne demandée PAR SON NOM depuis une autre appli (Flux RSS :
  // lecteuriptv://chaine?nom=Canal%2B%20Sport), à retrouver dans la
  // playlist, où elle s'appelle plutôt « FR| CANAL+ SPORT FHD ».
  // Les diffuseurs cités par l'agenda ne sont pas toujours une chaîne
  // (« France TV », « beIN Sports ») : on essaie alors la chaîne principale.
  var ALIAS_CHAINE = {
    francetv: ['france2'], francetelevisions: ['france2'], francetelevision: ['france2'],
    beinsports: ['beinsports1', 'beinsport1'], beinsport: ['beinsports1', 'beinsport1'],
    lequipe: ['lachainelequipe', 'lequipetv'], lachainelequipe: ['lequipe', 'lequipetv'],
    canalplus: ['canal'], canalplussport: ['canalsport', 'canalsports'],
    rmcsport: ['rmcsport1'], eurosport: ['eurosport1'],
    ligue1plus: ['ligue1', 'dazn1'], dazn: ['dazn1']
  };
  // Préfixe pays des fournisseurs : « FR| », « [FR] », « FR: », « FR - »…
  var PREFIXE_PAYS = /^\s*[[(|]?\s*[a-z]{2,3}\s*(?:[\])|:]+|\s-)\s*/i;
  // « Canal+ » donne « canalplus » : la playlist écrit aussi « Canal + » ou
  // « CANAL PLUS » ; « Canal » tout court est couvert par l'alias.
  function cleNomChaine(nom) {
    var n = String(nom || '').replace(/\+/g, ' plus ').replace(PREFIXE_PAYS, '');
    return Epg.normalizeChanName(n.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(CHANNEL_QUALITY_TAGS, ' '));
  }
  // Clés à essayer, dans l'ordre : chaque diffuseur cité (« TF1 / La Chaîne
  // L'Équipe »), ses alias, puis le nom raccourci mot à mot (« France 3
  // Occitanie » → « France 3 »), au cas où la variante n'existe pas.
  function clesRecherchees(nom) {
    var cles = [], ajoute = function (c) { if (c && cles.indexOf(c) === -1) cles.push(c); };
    var morceaux = String(nom || '').split(/\s*[\/,]\s*|\s+et\s+/i).filter(function (m) { return m.trim(); });
    morceaux.forEach(function (m) {
      var k = cleNomChaine(m);
      ajoute(k);
      (ALIAS_CHAINE[k] || []).forEach(ajoute);
    });
    morceaux.forEach(function (m) {
      var mots = m.trim().split(/\s+/);
      for (var n = mots.length - 1; n >= 1; n--) {
        var k = cleNomChaine(mots.slice(0, n).join(' '));
        if (k.length < 2) break;
        ajoute(k);
        (ALIAS_CHAINE[k] || []).forEach(ajoute);
      }
    });
    return cles;
  }
  // Toutes les sources de la chaîne demandée, la meilleure d'abord ; tableau
  // vide si rien ne correspond. Nom identique d'abord (pour chaque clé, dans
  // l'ordre) ; à défaut, un nom qui COMMENCE par une clé (« beIN Sports » →
  // « beIN Sports MAX »), jamais suivi d'un chiffre (« France 2 » ne doit pas
  // donner « France 24 »). Une source d'un bouquet français passe devant.
  function trouverChaine(items, nom) {
    var cles = clesRecherchees(nom);
    var liste = (items || []).filter(function (it) { return it && it.url; })
      .map(function (it) { return { it: it, k: cleNomChaine(it.name) }; });
    var francais = function (it) { return isFrenchBouquet(it.group || it.groupTitle) || /^\s*[[(|]?\s*fr\b/i.test(it.name || ''); };
    var garde = function (trouves) {
      var fr = trouves.filter(francais);
      return SourceQuality.ordonner(fr.length ? fr : trouves);
    };
    var i, trouves;
    for (i = 0; i < cles.length; i++) {
      trouves = liste.filter(function (x) { return x.k === cles[i]; });
      if (trouves.length) return garde(trouves.map(function (x) { return x.it; }));
    }
    for (i = 0; i < cles.length; i++) {
      var cle = cles[i];
      trouves = liste.filter(function (x) { return x.k.length > cle.length && x.k.indexOf(cle) === 0 && !/^\d/.test(x.k.slice(cle.length)); });
      if (!trouves.length) continue;
      // Parmi les noms plus longs, la famille la plus courte seulement.
      var court = Math.min.apply(null, trouves.map(function (x) { return x.k.length; }));
      return garde(trouves.filter(function (x) { return x.k.length === court; }).map(function (x) { return x.it; }));
    }
    return [];
  }

  // Code PIN des bouquets : catégories « adulte » détectées par leur nom.
  var ADULT_GROUP_RE = /adult|adulte|xxx|18\+|porn/i;
  function isAdultGroup(name) { return ADULT_GROUP_RE.test(name || ''); }

  function iconFor(kind) { return kind === 'films' ? '🎬' : kind === 'series' ? '🎞️' : kind === 'bouquet' ? '🗂️' : kind === 'radio' ? '📻' : '📺'; }

  // Icône de bouquet inspirée de son thème plutôt qu'un pictogramme
  // générique — heuristique par mots-clés sur le nom (même esprit que
  // isAdultGroup/classifyGroup), best-effort et sans prétention d'exhaustivité.
  function iconForBouquet(label) {
    var s = String(label || '').toLowerCase();
    if (/adulte|xxx|18\+|porn/.test(s)) return '🔞';
    if (/sport|foot|tennis|golf|rugby|basket|f1\b|ufc|boxe|nba|nfl|moto ?gp/.test(s)) return '⚽';
    if (/cin[ée]|movie|vod/.test(s)) return '🎬';
    if (/s[ée]rie|show|drama/.test(s)) return '🎞️';
    if (/jeunesse|kids?\b|enfant|cartoon|disney|nickelodeon|toon/.test(s)) return '🧸';
    if (/musique|music|clip|mtv|hits?\b/.test(s)) return '🎵';
    if (/info|news|actu/.test(s)) return '📰';
    if (/document|discovery|nat ?geo|histoire|science/.test(s)) return '🔭';
    if (/religio|god|dieu|coran|bible|islam|chr[ée]tien/.test(s)) return '🕊️';
    if (/r[ée]gion|local/.test(s)) return '📍';
    if (/g[ée]n[ée]ralist|national/.test(s)) return '📺';
    return '🗂️';
  }

  // Beaucoup de playlists agrègent plusieurs pays, avec un marqueur "FR" en
  // début de nom de bouquet ("FR| ...", "FR LIGUE 1 + FR"...) ou le mot
  // France/français en toutes lettres, ou encore le nom d'un bouquet/offre
  // français bien connu (Canal+/CanalSat...) — sert à n'afficher que les
  // bouquets français par défaut (voir renderBouquetTiles) et éviter une
  // liste de centaines de bouquets étrangers au premier affichage.
  var FR_BOUQUET = /(^|[^a-zàâäéèêëïîôöùûüç])(fr|france|fran[cç]ais)([^a-zàâäéèêëïîôöùûüç]|$)|canal ?\+|canal ?sat/i;
  function isFrenchBouquet(label) { return FR_BOUQUET.test(String(label || '')); }

  // Stations toujours proposées dans l'onglet Radio, en plus de celles de la
  // playlist.
  var DEFAULT_RADIOS = [
    { name: 'France Inter', url: 'https://icecast.radiofrance.fr/franceinter-midfi.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/France_Inter_logo_2021.svg/500px-France_Inter_logo_2021.svg.png' },
    { name: 'France Info', url: 'https://icecast.radiofrance.fr/franceinfo-midfi.mp3',
      logo: 'https://www.francetvinfo.fr/assets/common/images/pwa/ios/120-5487caf3.png' },
    { name: 'France Culture', url: 'https://icecast.radiofrance.fr/franceculture-midfi.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/France_Culture_logo_2021.svg/500px-France_Culture_logo_2021.svg.png' },
    { name: 'France Musique', url: 'https://icecast.radiofrance.fr/francemusique-midfi.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/France_Musique_logo_2021.svg/500px-France_Musique_logo_2021.svg.png' },
    { name: 'FIP', url: 'https://icecast.radiofrance.fr/fip-midfi.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/FIP_logo_2021.svg/500px-FIP_logo_2021.svg.png' },
    { name: 'Mouv\'', url: 'https://icecast.radiofrance.fr/mouv-midfi.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Mouv_logo_2022.svg/500px-Mouv_logo_2022.svg.png' },
    { name: 'Europe 1', url: 'https://europe1.lmn.fm/europe1.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Europe1_FLAT.png/500px-Europe1_FLAT.png' },
    { name: 'RMC', url: 'https://audio.bfmtv.com/rmcradio_128.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/RMC_2025.svg/500px-RMC_2025.svg.png' },
    { name: 'NRJ', url: 'https://cdn.nrjaudio.fm/audio1/fr/30001/mp3_128.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/d/dc/Logo_Nrj_%28radio%29_2008.svg/500px-Logo_Nrj_%28radio%29_2008.svg.png' },
    // #radio.mp3 : astuce sans risque pour les flux sans extension (URL
    // envoyée telle quelle au serveur, le fragment n'est jamais transmis —
    // seul isDirectFile() dans player.js le lit, pour choisir la lecture
    // directe plutôt que le démultiplexage mpeg-ts, qui échoue sur du MP3
    // brut). Voir le correctif FIP (v2.35) pour l'historique du problème.
    { name: 'Skyrock', url: 'https://icecast.skyrock.net/s/natio_mp3_128k#radio.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/SKYROCK_FM_LOGO.svg/500px-SKYROCK_FM_LOGO.svg.png' },
    { name: 'Radio Nova', url: 'https://novazz.ice.infomaniak.ch/novazz-128.mp3',
      logo: 'https://www.nova.fr/wp-content/uploads/sites/2/2021/02/cropped-favicon.png' },
    { name: 'Radio Classique', url: 'https://radioclassique.ice.infomaniak.ch/radioclassique-high.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Logo_Radio_Classique.svg/500px-Logo_Radio_Classique.svg.png' },
    { name: 'TSF Jazz', url: 'https://tsfjazz.ice.infomaniak.ch/tsfjazz-high.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/TSFJazz-2017.jpg/500px-TSFJazz-2017.jpg' },
    { name: 'Ouï FM', url: 'https://ouifm.ice.infomaniak.ch/ouifm-high.mp3',
      logo: 'https://bocir-prod-bucket.s3.amazonaws.com/radios/oui-fm/images/favicon.ico' },
    { name: 'Radio Meuh', url: 'https://radiomeuh.ice.infomaniak.ch/radiomeuh-128.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/9/9a/Radio_Meuh_Logo.svg/500px-Radio_Meuh_Logo.svg.png' },
    { name: 'Nostalgie', url: 'https://streaming.nrjaudio.fm/oug7girb92oc?origine=tingfm#radio.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/2/2d/Nostalgie_logo_simple.png' },
    // France Bleu a été rebaptisé « ici » (Radio France) : le favicon de
    // francebleu.fr redirige désormais vers www.ici.fr — URL finale utilisée
    // directement, sans passer par la redirection à chaque affichage.
    { name: 'France Bleu Limousin', url: 'https://icecast.radiofrance.fr/fblimousin-midfi.mp3',
      logo: 'https://www.ici.fr/images/favicon-112.png' },
    { name: 'Sud Radio', url: 'https://ice.creacast.com/sudradio#radio.mp3',
      logo: 'https://www.sudradio.fr/wp-content/uploads/2019/06/cropped-favicon-180x180.png' },
    { name: 'Europe 2', url: 'https://europe2.lmn.fm/europe2.mp3',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Europe_2_blanc_2024.png/500px-Europe_2_blanc_2024.png' }
  ].map(function (r) {
    return { key: 'default-radio:' + r.url, kind: 'radio', name: r.name, url: r.url, logo: r.logo || null, group: 'Stations par défaut' };
  });

  var Catalogue = {
    isHiddenChannel: isHiddenChannel, resetNameCaches: resetNameCaches, channelFamilyKey: channelFamilyKey,
    excludeRadio: excludeRadio, excludeHidden: excludeHidden, groupChannels: groupChannels,
    iconFor: iconFor, iconForBouquet: iconForBouquet, isFrenchBouquet: isFrenchBouquet,
    isAdultGroup: isAdultGroup, matchesSearch: matchesSearch,
    cleNomChaine: cleNomChaine, trouverChaine: trouverChaine, DEFAULT_RADIOS: DEFAULT_RADIOS
  };
  global.Catalogue = Catalogue;
  if (typeof module !== 'undefined' && module.exports) module.exports = Catalogue;
})(typeof window !== 'undefined' ? window : globalThis);

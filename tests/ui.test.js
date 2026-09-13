/* Test de fumée de l'interface dans jsdom : charge la vraie page et les vrais
   scripts, puis exerce la vue Immersion 3D. But : attraper les erreurs
   d'exécution (référence manquante, DOM absent) et vérifier que le carrousel
   ne construit qu'une poignée de cartes quel que soit le nombre de chaînes. */
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const WWW = require('path').join(__dirname, '..', 'www');
const html = fs.readFileSync(WWW + '/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;

const erreurs = [];
w.addEventListener('error', e => erreurs.push('window.error: ' + e.message));
w.onerror = (m) => erreurs.push('onerror: ' + m);

// --- garnitures que jsdom n'a pas ---
w.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} };
w.requestIdleCallback = fn => setTimeout(fn, 0);
w.cancelIdleCallback = id => clearTimeout(id);
if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
w.scrollTo = () => {};
w.HTMLElement.prototype.scrollIntoView = function () {};
const VERSION = JSON.parse(fs.readFileSync(WWW + '/version.json', 'utf8')).version;
w.APP_VERSION = VERSION;
w.UPDATE_REPO = 'laurentsar/lecteur-iptv';
w.fetch = () => Promise.reject(new Error('réseau coupé dans le test'));

// jsdom n'implémente pas la lecture média ni le chargement des scripts
// externes. Sans ces deux garnitures, startPlayback reste bloqué en attente de
// hls.js et video.play() lève au lieu de rendre une promesse.
w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
w.HTMLMediaElement.prototype.pause = function () {};
w.HTMLMediaElement.prototype.load = function () {};
w.HTMLMediaElement.prototype.canPlayType = function () { return ''; };
const vraiCreate = w.document.createElement.bind(w.document);
w.document.createElement = function (tag) {
  const el = vraiCreate(tag);
  if (String(tag).toLowerCase() === 'script') {
    // Échec de chargement simulé : le code de repli continue au lieu d'attendre
    // indéfiniment un fichier que jsdom n'ira jamais chercher.
    setTimeout(() => { if (el.onerror) el.onerror(new w.Event('error')); }, 0);
  }
  return el;
};

function charger(f) {
  const code = fs.readFileSync(WWW + '/' + f, 'utf8');
  try { vm.runInContext(code, dom.getInternalVMContext(), { filename: f }); }
  catch (e) { erreurs.push(`${f} : ${e.message}`); }
}

// --- playlist M3U de test, écrite avant le chargement de l'app ---
const NB = 500;
let m3u = '#EXTM3U url-tvg="http://example.invalid/epg.xml"\n';
for (let i = 1; i <= NB; i++) {
  m3u += `#EXTINF:-1 tvg-id="c${i}" tvg-chno="${i}" group-title="Bouquet FR ${i % 7}",Chaine ${i}\nhttp://example.invalid/live/${i}.ts\n`;
}
w.localStorage.setItem('iptv:playlists', JSON.stringify([{ id: 'p1', nom: 'Test', type: 'm3u', m3uUrl: 'http://example.invalid/pl.m3u', creeLe: 1 }]));
w.localStorage.setItem('iptv:active', JSON.stringify('p1'));

['net.js', 'hls-native-loader.js', 'source-quality.js', 'store.js', 'crypto.js', 'm3u.js', 'xtream.js', 'tmdb.js', 'epg.js', 'player.js', 'recorder.js', 'app.js'].forEach(charger);

// Net est chargé : on court-circuite le réseau pour servir la playlist de test.
w.Net.fetchText = () => Promise.resolve(m3u);
w.Net.fetchBytes = () => Promise.reject(new Error('pas d\'EPG dans le test'));
w.Net.fetchJson = () => Promise.reject(new Error('pas de réseau dans le test'));

const $ = id => w.document.getElementById(id);
const attendre = ms => new Promise(r => setTimeout(r, ms));

let ok = 0, ko = 0;
function verifie(nom, cond, detail) {
  if (cond) { console.log('  ✓ ' + nom); ok++; }
  else { console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); ko++; }
}

(async () => {
  await attendre(300);

  console.log('\n— Démarrage —');
  verifie('aucune erreur au chargement', erreurs.length === 0, erreurs.join(' | '));
  verifie('version affichée', $('verChip').textContent === 'v' + VERSION, $('verChip').textContent);
  verifie('accueil rendu', $('accueil').children.length > 0);

  console.log('\n— Onglet En direct, vue Liste —');
  $('tabs').querySelector('[data-tab="direct"]').click();
  await attendre(150);
  w.document.querySelector('#directViewToggle [data-view="liste"]').click();
  await attendre(250);
  const grille = $('listeDirect');
  verifie('scène 3D masquée', $('scene3d').style.display === 'none');
  verifie('grille visible', grille.style.display !== 'none');
  verifie('grille paginée à 60', grille.children.length === 60, 'children=' + grille.children.length);
  verifie('bouton « Charger plus » visible', $('plusDirect').style.display !== 'none');

  console.log('\n— Charger plus (rendu incrémental) —');
  const premier = grille.firstChild;
  $('plusDirect').click();
  await attendre(250);
  verifie('120 cartes après', grille.children.length === 120, 'children=' + grille.children.length);
  verifie('les 60 premières cartes NE sont PAS recréées', grille.firstChild === premier);

  console.log('\n— Bascule Immersion 3D —');
  w.document.querySelector('#directViewToggle [data-view="3d"]').click();
  await attendre(250);
  const scene = $('scene3d');
  verifie('scène visible', scene.style.display !== 'none');
  verifie('grille masquée', $('listeDirect').style.display === 'none');
  verifie('bouton « Charger plus » masqué', $('plusDirect').style.display === 'none');
  const piste = scene.querySelector('.scene3d-piste');
  const nb = piste.querySelectorAll('.carte3d').length;
  verifie('carrousel borné (<= 9 cartes pour 500 chaînes)', nb > 0 && nb <= 9, 'cartes=' + nb);
  verifie('compteur de position', /1 \/ \d+/.test(scene.querySelector('.scene3d-pos').textContent),
          scene.querySelector('.scene3d-pos').textContent);
  verifie('flèche précédente désactivée au début', scene.querySelector('.scene3d-nav.prec').disabled);

  console.log('\n— Navigation au clavier —');
  function touche(k) {
    scene.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  }
  touche('ArrowRight'); await attendre(60);
  verifie('flèche droite avance d\'une chaîne', scene.querySelector('.scene3d-pos').textContent.startsWith('2 /'),
          scene.querySelector('.scene3d-pos').textContent);
  touche('PageDown'); await attendre(60);
  verifie('PageDown avance de 10', scene.querySelector('.scene3d-pos').textContent.startsWith('12 /'),
          scene.querySelector('.scene3d-pos').textContent);
  touche('ArrowLeft'); await attendre(60);
  verifie('flèche gauche recule', scene.querySelector('.scene3d-pos').textContent.startsWith('11 /'),
          scene.querySelector('.scene3d-pos').textContent);
  const nb2 = piste.querySelectorAll('.carte3d').length;
  verifie('toujours borné après navigation', nb2 <= 9, 'cartes=' + nb2);
  const actives = piste.querySelectorAll('.carte3d.actif').length;
  verifie('une seule carte active', actives === 1, 'actives=' + actives);

  console.log('\n— Lecture depuis la carte centrale —');
  let ouvert = null;
  const vraiOpen = w.Player.open;
  w.Player.open = (url, titre) => { ouvert = { url, titre }; };
  touche('Enter'); await attendre(60);
  verifie('Entrée lance la chaîne centrée', ouvert && /live\/11\.ts$/.test(ouvert.url), JSON.stringify(ouvert));
  w.Player.open = vraiOpen;

  console.log('\n— Recherche : la scène suit le filtre —');
  const rech = $('rechDirect');
  rech.value = 'Chaine 25';
  rech.dispatchEvent(new w.Event('input', { bubbles: true }));
  await attendre(500);
  verifie('position remise à 1 après filtrage', scene.querySelector('.scene3d-pos').textContent.startsWith('1 /'),
          scene.querySelector('.scene3d-pos').textContent);
  const totalFiltre = parseInt(scene.querySelector('.scene3d-pos').textContent.split('/')[1], 10);
  verifie('liste réellement filtrée', totalFiltre > 0 && totalFiltre < 500, 'total=' + totalFiltre);

  console.log('\n— Croix d\'effacement —');
  const croix = rech.parentNode.querySelector('.rech-clear');
  verifie('croix présente et visible quand le champ est rempli', croix && croix.classList.contains('on'));
  croix.click();
  await attendre(500);
  verifie('champ vidé', rech.value === '');
  verifie('liste complète restaurée', scene.querySelector('.scene3d-pos').textContent.endsWith('/ 500'),
          scene.querySelector('.scene3d-pos').textContent);

  console.log('\n— Retour arrière —');
  w.document.querySelector('#directViewToggle [data-view="3d"]').click();
  await attendre(200);

  console.log('\n— Bouton VR : ni WebXR ni plugin natif ici —');
  {
    // L'interface du lecteur n'est bâtie qu'à la première ouverture.
    w.Player.open('http://example.invalid/live/1.ts', 'Test', { live: true });
    await attendre(120);
    const vr = $('playerVr');
    verifie('bouton 🥽 présent dans le lecteur', !!vr);
    // Sans navigator.xr (pas de casque) et sans plugin natif (pas d'APK), ni
    // le cinéma VR ni la passerelle n'ont de sens : le bouton reste caché.
    verifie('bouton 🥽 masqué dans un navigateur ordinaire', vr && vr.style.display === 'none', vr && vr.style.display);
    w.Player.close();
    await attendre(60);
  }

  console.log('\n— Reprise automatique après une coupure —');
  {
    // Symptôme corrigé : à la première erreur de flux, la lecture s'arrêtait
    // définitivement (« la chaîne se met en pause »). Elle doit maintenant se
    // relancer d'elle-même avant d'envisager d'abandonner.
    w.Player.open('http://example.invalid/live/77.ts', 'Chaine 77', { live: true });
    await attendre(200);
    const statut = $('playerStatus');
    const video = w.document.querySelector('#playerOverlay video');
    verifie('lecteur ouvert avec son élément vidéo', !!video && !!statut);

    video.dispatchEvent(new w.Event('error'));
    await attendre(60);
    verifie('une reconnexion est annoncée, pas un abandon',
            /reconnexion/i.test(statut.textContent), statut.textContent);
    verifie('la tentative est numérotée', /\(1\)/.test(statut.textContent), statut.textContent);

    // Deuxième échec d'affilée sur une chaîne qui n'a jamais donné d'image :
    // au-delà de deux essais on passe aux replis plutôt que d'insister.
    await attendre(1700);
    video.dispatchEvent(new w.Event('error'));
    await attendre(60);
    verifie('deuxième tentative comptée', /\(2\)/.test(statut.textContent), statut.textContent);
    await attendre(3200);
    video.dispatchEvent(new w.Event('error'));
    await attendre(80);
    verifie('abandon après les tentatives à froid',
            !/reconnexion/i.test(statut.textContent), statut.textContent);

    // Une pause demandée ne doit rien relancer derrière l'utilisateur.
    w.Player.open('http://example.invalid/live/78.ts', 'Chaine 78', { live: true });
    await attendre(200);
    video.dispatchEvent(new w.Event('pause'));
    video.dispatchEvent(new w.Event('error'));
    await attendre(60);
    verifie('aucune reconnexion pendant une pause voulue',
            !/reconnexion/i.test($('playerStatus').textContent), $('playerStatus').textContent);
    w.Player.close();
    await attendre(60);
  }

  console.log('\n— Bascule vers une source de qualité inférieure —');
  {
    // Une chaîne à plusieurs sources : quand la meilleure se coupe sans arrêt,
    // le lecteur doit descendre d'un cran plutôt que d'abandonner — et ne
    // jamais remonter, ce qui serait absurde sur une ligne qui ne suit pas.
    const versions = [
      { name: 'Chaine 90 FHD', url: 'http://example.invalid/live/90-fhd.ts' },
      { name: 'Chaine 90 HD', url: 'http://example.invalid/live/90-hd.ts' },
      { name: 'Chaine 90 SD', url: 'http://example.invalid/live/90-sd.ts' }
    ];
    w.Player.open(versions[0].url, versions[0].name, { live: true, versions: versions });
    await attendre(200);
    const statut = $('playerStatus');
    const video = w.document.querySelector('#playerOverlay video');

    // Épuise les tentatives de la source FHD (2 à froid).
    video.dispatchEvent(new w.Event('error'));
    await attendre(1700);
    video.dispatchEvent(new w.Event('error'));
    await attendre(3300);
    video.dispatchEvent(new w.Event('error'));
    await attendre(120);
    verifie('bascule annoncée vers la source inférieure',
            /bascule/i.test(statut.textContent), statut.textContent);
    verifie('c\'est bien la HD qui est visée, pas la SD ni un retour en FHD',
            /Chaine 90 HD/.test(statut.textContent), statut.textContent);

    // Vraie panne : quand TOUTES les sources sont tombées, l'app doit le dire
    // au lieu de tourner en rond. Les reprises ne doivent jamais masquer un
    // échec réel — c'est la contrepartie de leur existence.
    for (let i = 0; i < 12; i++) {
      video.dispatchEvent(new w.Event('error'));
      await attendre(1700);
      video.dispatchEvent(new w.Event('error'));
      await attendre(3300);
    }
    video.dispatchEvent(new w.Event('error'));
    await attendre(150);
    const fin = statut.textContent;
    verifie('abandon annoncé une fois toutes les sources épuisées',
            !!fin && !/bascule/i.test(fin) && !/reconnexion/i.test(fin), fin);
    verifie('le message d\'abandon explique la panne', /impossible|hors service|ne répond|interrompu/i.test(fin), fin);

    w.Player.close();
    await attendre(60);
  }

  console.log('\n— API des menus VR : pagination et plafond mémoire —');
  {
    // La page VR tourne dans une autre fenêtre et appelle ces fonctions par
    // window.opener. L'enjeu n'est pas l'affichage — invérifiable sans casque —
    // mais le CONTRAT : ne jamais lui livrer plus que ce qu'elle affiche.
    const idx = await w.AppZap.vrIndex('direct');
    verifie('index des bouquets renvoyé', Array.isArray(idx) && idx.length === 7, 'n=' + (idx && idx.length));
    verifie('chaque bouquet porte un libellé et un compte',
            idx.every(c => c.label && typeof c.count === 'number'), JSON.stringify(idx[0]));
    verifie('l\'index ne contient AUCUNE chaîne',
            idx.every(c => !c.chaines && !c.items), JSON.stringify(idx[0]));

    const p1 = await w.AppZap.vrPage('direct', idx[0].id, 0, 10);
    verifie('une page rend au plus ce qui est demandé', p1.items.length <= 10, 'n=' + p1.items.length);
    verifie('le total du bouquet est annoncé', p1.total === idx[0].count, p1.total + ' vs ' + idx[0].count);
    verifie('les entrées portent le strict nécessaire',
            p1.items.every(e => e.url && e.name && !('group' in e)), JSON.stringify(p1.items[0]));

    // Le plafond doit tenir même si l'appelant demande la lune : c'est ce qui
    // empêche un catalogue entier de traverser vers le casque.
    const enorme = await w.AppZap.vrPage('direct', idx[0].id, 0, 99999);
    verifie('demande démesurée plafonnée', enorme.items.length <= 40, 'n=' + enorme.items.length);

    const p2 = await w.AppZap.vrPage('direct', idx[0].id, 10, 10);
    verifie('la page suivante décale bien',
            p2.items.length === 0 || p2.items[0].url !== p1.items[0].url);

    const fav = w.AppZap.vrFavoris();
    verifie('favoris exposés sous forme de tableau', Array.isArray(fav));
  }

  console.log('\n— Erreurs JS survenues pendant le test —');
  verifie('aucune erreur', erreurs.length === 0, erreurs.join(' | '));

  console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
  process.exit(ko ? 1 : 0);
})();

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

['net.js', 'hls-native-loader.js', 'store.js', 'crypto.js', 'm3u.js', 'xtream.js', 'tmdb.js', 'epg.js', 'player.js', 'recorder.js', 'app.js'].forEach(charger);

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

  console.log('\n— Erreurs JS survenues pendant le test —');
  verifie('aucune erreur', erreurs.length === 0, erreurs.join(' | '));

  console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
  process.exit(ko ? 1 : 0);
})();

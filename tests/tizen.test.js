/* Application Samsung (www/tizen-tv.js) dans une page simulée : faux objet
   tizen et faux AVPlay. Vérifie que la lecture passe par AVPlay, que la page
   devient transparente pendant la lecture, et que Retour/fermeture
   l'arrêtent. */
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const WWW = require('path').join(__dirname, '..', 'www');

let ok = 0, ko = 0;
function verifie(nom, cond, detail) {
  if (cond) { console.log('  ✓ ' + nom); ok++; }
  else { console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); ko++; }
}
const attendre = ms => new Promise(r => setTimeout(r, ms));

const dom = new JSDOM(fs.readFileSync(WWW + '/index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
w.requestIdleCallback = f => setTimeout(f, 0);
w.scrollTo = () => {};
w.HTMLElement.prototype.scrollIntoView = function () {};
w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
w.fetch = () => Promise.reject(new Error('hors ligne'));
w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
w.HTMLMediaElement.prototype.pause = function () {};
w.HTMLMediaElement.prototype.load = function () {};

const journal = { touches: [], ouvert: null, etat: 'NONE', arrets: 0, quitte: 0 };
w.tizen = {
  tvinputdevice: {
    getSupportedKeys: () => ['ChannelUp', 'ChannelDown', 'MediaPlayPause', '1'].map(name => ({ name })),
    registerKey: n => journal.touches.push(n)
  },
  application: { getCurrentApplication: () => ({ exit: () => journal.quitte++ }) }
};
w.webapis = {
  avplay: {
    open: u => { journal.ouvert = u; journal.etat = 'IDLE'; },
    setDisplayRect() {}, setDisplayMethod() {}, setBufferingParam() {},
    setListener: l => { journal.ecouteur = l; },
    prepareAsync: (ok) => setTimeout(ok, 0),
    play: () => { journal.etat = 'PLAYING'; },
    pause: () => { journal.etat = 'PAUSED'; },
    stop: () => { journal.arrets++; journal.etat = 'IDLE'; },
    close() {}, getState: () => journal.etat,
    getTotalTrackInfo: () => [{ index: 1, type: 'AUDIO', extra_info: '{"language":"fra","fourCC":"AC3"}' }],
    setSelectTrack() {}, suspend() {}, restore() {}
  }
};
const erreurs = [];
w.addEventListener('error', e => erreurs.push(e.message));
['net.js', 'serveurs.js', 'hls-native-loader.js', 'source-quality.js', 'store.js', 'crypto.js', 'm3u.js', 'xtream.js', 'tmdb.js', 'epg.js', 'player.js', 'recorder.js', 'tvlink.js', 'tizen-tv.js', 'dpad-nav.js', 'app.js'].forEach(f => {
  try { vm.runInContext(fs.readFileSync(WWW + '/' + f, 'utf8'), dom.getInternalVMContext(), { filename: f }); }
  catch (e) { erreurs.push(f + ' : ' + e.message); }
});

(async () => {
  await attendre(50);
  verifie('détectée comme TV Samsung', w.TizenTV.actif && w.document.documentElement.classList.contains('tizen'));
  verifie('touches chaîne/lecture enregistrées', journal.touches.includes('ChannelUp') && journal.touches.includes('MediaPlayPause'));
  verifie('affichage TV activé d\'office', w.document.body.classList.contains('tv'));

  w.Player.open('http://srv/live/u/p/1.ts', 'Canal+', { live: true });
  await attendre(20);
  verifie('lecture confiée à AVPlay', journal.ouvert === 'http://srv/live/u/p/1.ts' && journal.etat === 'PLAYING', journal.ouvert);
  verifie('page transparente pendant la lecture', w.document.documentElement.classList.contains('avplay-actif'));
  verifie('zone vidéo AVPlay créée', !!w.document.querySelector('object[type="application/avplayer"]'));
  verifie('pistes audio lues', w.TizenTV.pistesAudio()[0].codec === 'AC3');

  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { keyCode: 10252, bubbles: true }));
  verifie('lecture/pause', journal.etat === 'PAUSED');

  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { keyCode: 10009, bubbles: true }));
  await attendre(10);
  verifie('Retour ferme le lecteur et arrête AVPlay', !w.Player.isOpen() && journal.arrets > 0 && !w.document.documentElement.classList.contains('avplay-actif'));

  console.log('\n— Erreurs JS —');
  verifie('aucune erreur', erreurs.length === 0, erreurs.join(' | '));
  console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
  process.exit(ko ? 1 : 0);
})();

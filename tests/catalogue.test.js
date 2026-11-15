/* Noms de chaînes et de bouquets (www/catalogue.js), formes d'URL de flux
   et textes du lecteur (www/flux.js). */
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const WWW = require('path').join(__dirname, '..', 'www');

let ok = 0, ko = 0;
function verifie(nom, cond, detail) {
  if (cond) { console.log('  ✓ ' + nom); ok++; }
  else { console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); ko++; }
}

const dom = new JSDOM('', { runScripts: 'outside-only' });
['epg.js', 'source-quality.js', 'catalogue.js', 'flux.js', 'natif-pont.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(WWW + '/' + f, 'utf8'), dom.getInternalVMContext(), { filename: f }));
const C = dom.window.Catalogue;

console.log('— Regroupement des doublons —');
verifie('« TF1 », « TF1 HD », « TF1 FHD (2) » : même famille',
  C.channelFamilyKey('TF1') === C.channelFamilyKey('TF1 HD') && C.channelFamilyKey('TF1') === C.channelFamilyKey('TF1 FHD (2)'));
verifie('« France 2 » et « France 24 » : familles distinctes', C.channelFamilyKey('France 2') !== C.channelFamilyKey('France 24'));
const g = C.groupChannels([{ name: 'TF1 SD', url: 'a' }, { name: 'TF1 FHD', url: 'b', logo: 'l.png' }, { name: 'M6', url: 'c' }]);
verifie('deux cartes, la meilleure source d\'abord', g.length === 2 && g[0].versions.length === 2 && g[0].url === 'b' && g[0].logo === 'l.png', JSON.stringify(g.map(x => x.url)));

console.log('— Entrées masquées, catégories —');
verifie('chaîne de bienvenue masquée malgré la ponctuation', C.isHiddenChannel('Welcome — Ultimate TV') && !C.isHiddenChannel('TF1'));
verifie('radios exclues des vues TV', C.excludeRadio([{ kind: 'radio' }, { kind: 'live' }]).length === 1);
verifie('catégorie adulte reconnue', C.isAdultGroup('FR| ADULTE 18+') && !C.isAdultGroup('FR| SPORT'));
verifie('bouquet français reconnu', C.isFrenchBouquet('FR| CINEMA') && C.isFrenchBouquet('Canal+') && !C.isFrenchBouquet('DE| SPORT'));
verifie('icône selon le thème', C.iconForBouquet('FR| SPORT') === '⚽' && C.iconForBouquet('Jeunesse') === '🧸');
verifie('recherche par nom', C.matchesSearch({ name: 'France 2' }, 'france') && !C.matchesSearch({ name: 'TF1' }, 'france'));
verifie('radios par défaut prêtes à l\'emploi', C.DEFAULT_RADIOS.length > 10 && C.DEFAULT_RADIOS.every(r => r.kind === 'radio' && r.url && r.key));

console.log('— Flux —');
const F = dom.window.Flux;
verifie('HLS reconnu, avec paramètres', F.isM3u8('http://s/a.m3u8?t=1') && !F.isM3u8('http://s/live/1.ts'));
verifie('fichier direct (film, radio mp3)', F.isDirectFile('http://s/f.mkv') && F.isDirectFile('http://r/flux.mp3') && !F.isDirectFile('http://s/live/u/p/1'));
verifie('variante .m3u8 en gardant la query', F.swapExtToM3u8('http://s/live/1.ts?x=1') === 'http://s/live/1.m3u8?x=1');
verifie('Chromecast : un .ts part en HLS', F.castUrl('http://s/live/1.ts') === 'http://s/live/1.m3u8' && F.castMimeType('http://s/a.m3u8') === 'application/x-mpegurl');
verifie('durée lisible', F.formatTime(65) === '1:05' && F.formatTime(3725) === '1:02:05');
const debut = new Date(2026, 0, 1, 20, 0).getTime(), fin = new Date(2026, 0, 1, 20, 45).getTime();
verifie('bandeau en cours / ensuite', F.texteMaintenantEnsuite({ now: { titre: 'JT', start: debut, stop: fin }, next: { titre: 'Météo', start: fin } }) === '▶ JT (20:00–20:45)\nEnsuite 20:45 Météo');

console.log('— Pont avec le lecteur natif —');
const N = dom.window.NatifPont;
dom.window.AppZap = { list: () => [{ name: 'TF1', url: 'u1', chno: 1 }, { name: 'M6', url: 'u2' }], favoris: () => [{ name: 'M6', url: 'u2' }] };
const pl = N.payload('u2', { live: true, versions: [{ name: 'M6 HD', url: 'v1' }, { name: 'M6 SD', url: 'v2' }] });
verifie('direct : chaînes, position, sources, favoris', pl.channels.length === 2 && pl.index === 1 && pl.channels[0].chno === '1' && pl.versions.length === 2 && pl.favorites.length === 1);
const pe = N.payload('e2', { live: false, episodes: [{ title: 'S1E1', url: 'e1' }, { title: 'S1E2', url: 'e2' }] });
verifie('série : les épisodes tiennent lieu de liste', pe.channels.length === 2 && pe.index === 1 && pe.channels[1].name === 'S1E2');
const jour = {};
dom.window.Store = { setProgress: (u, d) => { jour[u] = d; }, clearProgress: u => { jour[u] = 'effacé'; } };
const r = { min: 0.03, max: 0.95, dureeMin: 60 };
N.progression({ url: 'f', positionMs: 600000, durationMs: 6000000 }, 'Film', r);
N.progression({ url: 'g', positionMs: 5900000, durationMs: 6000000 }, 'Fini', r);
verifie('position mémorisée, film terminé effacé', jour.f && jour.f.position === 600 && jour.f.title === 'Film' && jour.g === 'effacé');

console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
process.exit(ko ? 1 : 0);

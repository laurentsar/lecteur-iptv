/* Noms de chaînes et de bouquets (www/catalogue.js). */
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
['epg.js', 'source-quality.js', 'catalogue.js'].forEach(f =>
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

console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
process.exit(ko ? 1 : 0);

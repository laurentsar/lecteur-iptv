/* Classement des sources d'une chaîne (www/source-quality.js).
   Ce qui compte : le repli après échecs ne doit JAMAIS remonter en qualité, et
   ne doit jamais reproposer une source qui vient de tomber. */
const Q = require('../www/source-quality.js');

let ok = 0, ko = 0;
function verifie(nom, cond, detail) {
  if (cond) { console.log('  ✓ ' + nom); ok++; }
  else { console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); ko++; }
}

console.log('\n— Qualité devinée au nom —');
verifie('4K', Q.rang('CANAL+ 4K') === 4);
verifie('UHD', Q.rang('Sport UHD') === 4);
verifie('FHD', Q.rang('TF1 FHD') === 3);
verifie('1080', Q.rang('M6 1080p') === 3);
verifie('HD', Q.rang('TF1 HD') === 2);
verifie('SD', Q.rang('TF1 SD') === 1);
verifie('sans mention = HD par défaut', Q.rang('TF1') === 2);
// Pièges de sous-chaîne : « FHD » et « UHD » contiennent « HD ».
verifie('FHD n\'est pas dégradé en HD', Q.rang('TF1 FHD') > Q.rang('TF1 HD'));
verifie('UHD n\'est pas dégradé en HD', Q.rang('TF1 UHD') > Q.rang('TF1 HD'));
verifie('4K au-dessus de FHD', Q.rang('X 4K') > Q.rang('X FHD'));

console.log('\n— Tri par qualité décroissante —');
{
  const v = [
    { name: 'TF1 SD', url: 'sd' },
    { name: 'TF1 FHD', url: 'fhd' },
    { name: 'TF1', url: 'nu' },
    { name: 'TF1 4K', url: '4k' },
    { name: 'TF1 HD', url: 'hd' }
  ];
  const t = Q.ordonner(v).map(x => x.url);
  verifie('ordre 4K > FHD > (HD, sans mention) > SD', JSON.stringify(t) === JSON.stringify(['4k', 'fhd', 'nu', 'hd', 'sd']), JSON.stringify(t));
  verifie('tri stable à qualité égale (ordre de playlist conservé)',
          t.indexOf('nu') < t.indexOf('hd'), JSON.stringify(t));
  verifie('la liste d\'origine n\'est pas modifiée', v[0].url === 'sd');
}

console.log('\n— Choix du repli —');
{
  const t = Q.ordonner([
    { name: 'C+ 4K', url: '4k' },
    { name: 'C+ FHD', url: 'fhd' },
    { name: 'C+ HD', url: 'hd' },
    { name: 'C+ SD', url: 'sd' }
  ]);
  verifie('depuis la 4K -> FHD', Q.suivante(t, '4k', []).url === 'fhd');
  verifie('depuis la FHD -> HD', Q.suivante(t, 'fhd', []).url === 'hd');
  verifie('jamais de remontée en qualité', Q.suivante(t, 'sd', []) === null);
  verifie('saute une source déjà tombée', Q.suivante(t, '4k', ['fhd']).url === 'hd');
  verifie('rend la main quand tout a été essayé',
          Q.suivante(t, '4k', ['fhd', 'hd', 'sd']) === null);
  verifie('source courante absente de la liste -> commence au début',
          Q.suivante(t, 'inconnue', []).url === '4k');
  verifie('liste vide -> null', Q.suivante([], 'x', []) === null);
  verifie('source unique -> null', Q.suivante(Q.ordonner([{ name: 'A', url: 'a' }]), 'a', []) === null);
  // Une entrée sans URL ne doit pas être proposée comme repli.
  verifie('entrée sans URL ignorée',
          Q.suivante(Q.ordonner([{ name: 'A HD', url: 'a' }, { name: 'vide' }, { name: 'B SD', url: 'b' }]), 'a', []).url === 'b');
}

console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
process.exit(ko ? 1 : 0);

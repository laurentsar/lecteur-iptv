/* Navigation D-pad par position géométrique (www/dpad-nav.js).
   Ce qui compte : la flèche choisit toujours la case la plus proche dans SA
   direction (jamais une case dans le mauvais sens), et rend la main (-1)
   quand rien ne convient plutôt que de sauter n'importe où. */
const D = require('../www/dpad-nav.js');

let ok = 0, ko = 0;
function verifie(nom, cond, detail) {
  if (cond) { console.log('  ✓ ' + nom); ok++; }
  else { console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); ko++; }
}

function rect(left, top, right, bottom) { return { left: left, top: top, right: right, bottom: bottom }; }

console.log('\n— Grille 3x3 : la flèche vise la case voisine —');
{
  // Rangée 0 : indices 0,1,2 — rangée 1 (courante au centre) : 3,4,5 — rangée 2 : 6,7,8.
  // Cases 100x50, espacées de 10.
  const cases = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      cases.push(rect(col * 110, row * 60, col * 110 + 100, row * 60 + 50));
    }
  }
  const centre = cases[4]; // rangée 1, colonne 1
  const autres = cases.filter((_, i) => i !== 4); // ce que le DOM fournirait, sans la case active
  const idxDe = (r) => autres.indexOf(r);

  verifie('droite -> voisine de droite (même rangée)',
          D.pickCandidate(centre, autres, 'right') === idxDe(cases[5]));
  verifie('gauche -> voisine de gauche (même rangée)',
          D.pickCandidate(centre, autres, 'left') === idxDe(cases[3]));
  verifie('haut -> case au-dessus (même colonne)',
          D.pickCandidate(centre, autres, 'up') === idxDe(cases[1]));
  verifie('bas -> case en-dessous (même colonne)',
          D.pickCandidate(centre, autres, 'down') === idxDe(cases[7]));

  console.log('\n— Coin haut-gauche : deux directions n\'ont rien —');
  const coin = cases[0];
  const sansCoin = cases.filter((_, i) => i !== 0);
  const idxDe2 = (r) => sansCoin.indexOf(r);
  verifie('droite -> voisine de droite', D.pickCandidate(coin, sansCoin, 'right') === idxDe2(cases[1]));
  verifie('bas -> voisine du bas', D.pickCandidate(coin, sansCoin, 'down') === idxDe2(cases[3]));
  verifie('gauche -> rien (-1)', D.pickCandidate(coin, sansCoin, 'left') === -1);
  verifie('haut -> rien (-1)', D.pickCandidate(coin, sansCoin, 'up') === -1);
}

console.log('\n— Cas limites —');
verifie('aucun focus courant -> -1 (repli laissé à l\'appelant)',
        D.pickCandidate(null, [rect(0, 0, 10, 10)], 'right') === -1);
verifie('aucun candidat -> -1', D.pickCandidate(rect(0, 0, 10, 10), [], 'right') === -1);
{
  // Une case légèrement décalée en hauteur mais bien plus proche horizontalement
  // doit l'emporter sur une case alignée mais lointaine : on ne saute pas une
  // rangée entière pour un alignement parfait au loin.
  const centre = rect(100, 100, 200, 150);
  const procheDecalee = rect(210, 90, 310, 140);   // juste à droite, légèrement décalée
  const loinAlignee = rect(600, 100, 700, 150);    // parfaitement alignée mais très loin
  const cands = [loinAlignee, procheDecalee];
  verifie('la case proche légèrement décalée l\'emporte sur la case lointaine alignée',
          D.pickCandidate(centre, cands, 'right') === cands.indexOf(procheDecalee));
}

console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
process.exit(ko ? 1 : 0);

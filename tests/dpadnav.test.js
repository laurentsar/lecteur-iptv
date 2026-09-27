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


{
  // Le cas qui a bloqué les Réglages sur les deux télés : depuis un onglet du
  // bas, la flèche « haut » doit entrer dans le bloc large juste au-dessus,
  // pas sauter à l'onglet voisin de la même rangée.
  const ongletDroite = rect(1700, 980, 1900, 1060);
  const ongletVoisin = rect(1480, 980, 1690, 1060);
  const blocLarge = rect(80, 580, 1830, 660);       // une catégorie des Réglages
  const cands = [blocLarge, ongletVoisin];
  verifie('haut -> le bloc large au-dessus, pas l\'onglet voisin',
          D.pickCandidate(ongletDroite, cands, 'up') === cands.indexOf(blocLarge),
          'choisi=' + D.pickCandidate(ongletDroite, cands, 'up'));
  verifie('gauche -> l\'onglet voisin (même rangée)',
          D.pickCandidate(ongletDroite, cands, 'left') === cands.indexOf(ongletVoisin));
}

// Les catégories des Réglages sont des <summary> : sans eux dans le sélecteur,
// la télécommande ne pouvait atteindre aucun réglage (constaté sur les deux
// télés le 2026-09-26).
verifie('un <summary> est navigable au D-pad',
        DpadNav.FOCUSABLE_SELECTOR.split(',').map(function (s) { return s.trim(); }).indexOf('summary') !== -1,
        DpadNav.FOCUSABLE_SELECTOR);


console.log('\n— Candidat qui refuse le focus : on passe au suivant —');
{
  const depuis = rect(80, 450, 1830, 530);          // en-tête « Playlists »
  const fantome = rect(80, 540, 1830, 560);         // contenu d'une section repliée
  const vrai = rect(1530, 660, 1575, 710);          // bouton ✏️
  const ordre = D.rankCandidates(depuis, [vrai, fantome], 'down');
  verifie('rankCandidates classe tous les voisins, meilleur d\'abord',
          ordre.length === 2 && ordre[0] === 1 && ordre[1] === 0, JSON.stringify(ordre));
  verifie('rien dans la direction -> liste vide', D.rankCandidates(depuis, [vrai], 'up').length === 0);
}

console.log('\n— Contenu d\'un <details> replié : jamais candidat —');
{
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<details id="d"><summary id="s">Infos</summary><input id="i"><details open><summary id="s2">PIN</summary></details></details>');
  const doc = dom.window.document;
  // jsdom ne fait pas de mise en page : on simule ce que la WebView renvoie
  // (un offsetParent et une taille, même pour le contenu replié).
  [doc.getElementById('s'), doc.getElementById('i'), doc.getElementById('s2')].forEach(function (n) {
    Object.defineProperty(n, 'offsetParent', { get: function () { return doc.body; } });
    n.getBoundingClientRect = function () { return { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }; };
  });
  verifie('le <summary> d\'une section repliée reste navigable', D.estNavigable(doc.getElementById('s')));
  verifie('un champ dans une section repliée est ignoré', !D.estNavigable(doc.getElementById('i')));
  verifie('un <summary> imbriqué dans une section repliée est ignoré', !D.estNavigable(doc.getElementById('s2')));
  doc.getElementById('d').open = true;
  verifie('section ouverte -> son champ redevient navigable', D.estNavigable(doc.getElementById('i')));
}

console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
process.exit(ko ? 1 : 0);

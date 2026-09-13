/* Vérifie le découpage UV de la 3D relief (www/stereo-uv.js).
   Ce calcul est invérifiable à l'œil sans casque : on le vérifie donc par ses
   propriétés — chaque œil doit couvrir exactement sa moitié de l'image, dans
   le même sens que la vue 2D, une fois composé avec le miroir horizontal de
   l'écran cylindrique (u_final = 1 - u). */
const S = require('../www/stereo-uv.js');

let ok = 0, ko = 0;
function verifie(nom, cond, detail) {
  if (cond) { console.log('  ✓ ' + nom); ok++; }
  else { console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); ko++; }
}
const proche = (a, b) => Math.abs(a - b) < 1e-9;
// Ce que la texture affiche réellement après son miroir horizontal.
const finalU = u => 1 - u;

console.log('\n— Détection du format dans le nom de la chaîne —');
verifie('« CANAL+ 3D SBS » -> sbs', S.detecterFormat('CANAL+ 3D SBS') === 'sbs');
verifie('« Sky 3D HSBS » -> sbs', S.detecterFormat('Sky 3D HSBS') === 'sbs');
verifie('« Demo 3D TAB » -> ou', S.detecterFormat('Demo 3D TAB') === 'ou');
verifie('« Nature Over-Under » -> ou', S.detecterFormat('Nature Over-Under') === 'ou');
verifie('« Cine 3D » seul -> sbs (format le plus répandu)', S.detecterFormat('Cine 3D') === 'sbs');
verifie('« TF1 HD » -> aucun relief', S.detecterFormat('TF1 HD') === null);
// Piège réel : « 3D » ne doit pas être reconnu à l'intérieur d'un mot.
verifie('« M3D8 » n\'est pas du relief', S.detecterFormat('M3D8') === null);
verifie('« RMC Sport 3 » n\'est pas du relief', S.detecterFormat('RMC Sport 3') === null);
verifie('nom vide -> aucun relief', S.detecterFormat('') === null && S.detecterFormat(null) === null);

console.log('\n— Mode 2D : rien ne doit changer —');
verifie('u et v inchangés', (() => {
  const [u, v] = S.uvOeil(0.3, 0.7, '2d', false);
  return proche(u, 0.3) && proche(v, 0.7);
})());

console.log('\n— Côte-à-côte : chaque œil couvre sa moitié —');
{
  // Bords de la géométrie : u = 0 et u = 1.
  const g0 = S.uvOeil(0, 0.5, 'sbs', false)[0], g1 = S.uvOeil(1, 0.5, 'sbs', false)[0];
  const d0 = S.uvOeil(0, 0.5, 'sbs', true)[0], d1 = S.uvOeil(1, 0.5, 'sbs', true)[0];
  const gauche = [finalU(g0), finalU(g1)].sort((a, b) => a - b);
  const droit = [finalU(d0), finalU(d1)].sort((a, b) => a - b);
  verifie('œil gauche = moitié gauche de l\'image [0 ; 0,5]',
          proche(gauche[0], 0) && proche(gauche[1], 0.5), JSON.stringify(gauche));
  verifie('œil droit = moitié droite de l\'image [0,5 ; 1]',
          proche(droit[0], 0.5) && proche(droit[1], 1), JSON.stringify(droit));
  // Sens de balayage : si les deux yeux ne parcourent pas l'image dans le même
  // sens que la 2D, une vue est en miroir et le relief devient illisible.
  const sens2d = Math.sign(finalU(S.uvOeil(1, 0, '2d', false)[0]) - finalU(S.uvOeil(0, 0, '2d', false)[0]));
  verifie('œil gauche balaie dans le même sens que la 2D', Math.sign(finalU(g1) - finalU(g0)) === sens2d);
  verifie('œil droit balaie dans le même sens que la 2D', Math.sign(finalU(d1) - finalU(d0)) === sens2d);
  verifie('les deux yeux ne se chevauchent pas', proche(gauche[1], droit[0]));
  verifie('v intacte en côte-à-côte', proche(S.uvOeil(0.4, 0.9, 'sbs', true)[1], 0.9));
}

console.log('\n— Haut-bas : gauche en haut, droit en bas —');
{
  const g = [S.uvOeil(0.5, 0, 'ou', false)[1], S.uvOeil(0.5, 1, 'ou', false)[1]].sort((a, b) => a - b);
  const d = [S.uvOeil(0.5, 0, 'ou', true)[1], S.uvOeil(0.5, 1, 'ou', true)[1]].sort((a, b) => a - b);
  // v = 1 est le haut de l'image affichée (texture flipY), d'où la convention.
  verifie('œil gauche = moitié haute [0,5 ; 1]', proche(g[0], 0.5) && proche(g[1], 1), JSON.stringify(g));
  verifie('œil droit = moitié basse [0 ; 0,5]', proche(d[0], 0) && proche(d[1], 0.5), JSON.stringify(d));
  verifie('les deux yeux ne se chevauchent pas', proche(d[1], g[0]));
  verifie('u intacte en haut-bas', proche(S.uvOeil(0.4, 0.9, 'ou', true)[0], 0.4));
}

console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
process.exit(ko ? 1 : 0);

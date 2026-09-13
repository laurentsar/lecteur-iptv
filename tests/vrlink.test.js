/* Contrat du lien vers le cinéma VR (www/vr-link.js).
   Ce qui est vérifié avant tout : l'URL d'un flux — qui porte les identifiants
   du compte Xtream — ne doit JAMAIS se retrouver dans la chaîne de requête,
   sinon elle part dans les journaux du serveur qui héberge la page. */
const V = require('../www/vr-link.js');

let ok = 0, ko = 0;
function verifie(nom, cond, detail) {
  if (cond) { console.log('  ✓ ' + nom); ok++; }
  else { console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); ko++; }
}

const BASE = 'https://laurentsar.github.io/lecteur-iptv/';
const FLUX = 'http://panel.example.net:8080/live/laurent/s3cr3t/4242.ts';

console.log('\n— Construction du lien —');
const lien = V.construire(BASE, FLUX, 'CANAL+ 3D SBS');
verifie('pointe vers vr.html', lien.indexOf('/vr.html#') !== -1, lien);
verifie('aucune chaîne de requête', lien.indexOf('?') === -1, lien);
verifie('identifiants absents de la partie envoyée au serveur',
        lien.split('#')[0].indexOf('s3cr3t') === -1, lien.split('#')[0]);
verifie('identifiants présents dans le fragment', lien.split('#')[1].indexOf('s3cr3t') !== -1);
verifie('base déjà suffixée non redoublée',
        V.construire(BASE + 'vr.html', FLUX, 'x').indexOf('vr.html/vr.html') === -1);
verifie('base sans barre oblique finale acceptée',
        V.construire('https://ex.test/app', FLUX, 'x').indexOf('https://ex.test/app/vr.html#') === 0);

console.log('\n— Relecture —');
{
  const r = V.lire('', '#' + lien.split('#')[1]);
  verifie('flux restitué à l\'identique', r.url === FLUX, r.url);
  verifie('titre restitué', r.titre === 'CANAL+ 3D SBS', r.titre);
}
{
  // Caractères qui cassent un encodage naïf : espaces, +, &, accents.
  const titre = 'Ciné + Séries & 3D';
  const u = 'http://x.test/a b/c+d?e&f=1';
  const r = V.lire('', '#' + V.construire(BASE, u, titre).split('#')[1]);
  verifie('URL à caractères spéciaux restituée', r.url === u, r.url);
  verifie('titre à caractères spéciaux restitué', r.titre === titre, r.titre);
}
{
  const r = V.lire('?url=' + encodeURIComponent(FLUX) + '&title=Vieux', '');
  verifie('ancienne forme ?url= encore acceptée', r.url === FLUX && r.titre === 'Vieux');
}
{
  const r = V.lire('?url=http://ancien.test/a', '#url=' + encodeURIComponent(FLUX));
  verifie('le fragment l\'emporte sur la requête', r.url === FLUX, r.url);
}
{
  const r = V.lire('', '');
  verifie('rien du tout -> champs vides', r.url === '' && r.titre === '');
}

console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
process.exit(ko ? 1 : 0);

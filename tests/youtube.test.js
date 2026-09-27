/* Onglet YouTube (www/youtube.js) : chaque sous-catégorie croise au moins 3
   sources, propose un top, sans doublon, avec des identifiants de chaîne bien formés — un
   identifiant faux ouvrirait une page vide dans l'appli YouTube de la télé. */
const Y = require('../www/youtube.js');
let ok = 0, ko = 0;
function verifie(nom, cond, detail) {
  if (cond) { console.log('  ✓ ' + nom); ok++; }
  else { console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); ko++; }
}
const ids = [];
Y.CATEGORIES.forEach(function (c) {
  verifie(c.nom + ' : au moins 3 sources', c.sources.length >= 3, String(c.sources.length));
  verifie(c.nom + ' : 4 à 8 chaînes', c.chaines.length >= 4 && c.chaines.length <= 8, String(c.chaines.length));
  verifie(c.nom + ' : chaque chaîne citée par ≥ 2 sources, triée',
          c.chaines.every(function (ch, i) { return ch.cite >= 2 && ch.cite <= c.sources.length && (i === 0 || c.chaines[i - 1].cite >= ch.cite); }));
  c.chaines.forEach(function (ch) {
    if (!/^UC[\w-]{22}$/.test(ch.id)) verifie('identifiant bien formé ' + ch.nom, false, ch.id);
    ids.push(ch.id);
  });
});
verifie('aucune chaîne en double', new Set(ids).size === ids.length);
verifie('playlist = liste d\'envois (UU…)',
        Y.playlistUrl('UCAcAnMF0OrCtUep3Y4M-ZPw') === 'https://www.youtube.com/playlist?list=UUAcAnMF0OrCtUep3Y4M-ZPw');
const fichier = JSON.parse(require('fs').readFileSync(__dirname + '/../www/youtube-top.json', 'utf8'));
verifie('youtube-top.json (relu chaque mois par l\'appli) est valide', Y.valide(fichier));
verifie('fichier mal formé refusé', !Y.valide({ categories: [{ id: 'x', nom: 'x', chaines: [{ id: 'faux', nom: 'x' }] }] }));
console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
process.exit(ko ? 1 : 0);

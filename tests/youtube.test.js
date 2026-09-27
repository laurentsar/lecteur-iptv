/* Onglet YouTube (www/youtube.js) : chaque sous-catégorie propose bien un
   top 5, sans doublon, avec des identifiants de chaîne bien formés — un
   identifiant faux ouvrirait une page vide dans l'appli YouTube de la télé. */
const Y = require('../www/youtube.js');
let ok = 0, ko = 0;
function verifie(nom, cond, detail) {
  if (cond) { console.log('  ✓ ' + nom); ok++; }
  else { console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); ko++; }
}
const ids = [];
Y.CATEGORIES.forEach(function (c) {
  verifie(c.nom + ' : 5 chaînes', c.chaines.length === 5, String(c.chaines.length));
  c.chaines.forEach(function (ch) {
    if (!/^UC[\w-]{22}$/.test(ch.id)) verifie('identifiant bien formé ' + ch.nom, false, ch.id);
    ids.push(ch.id);
  });
});
verifie('aucune chaîne en double', new Set(ids).size === ids.length);
verifie('playlist = liste d\'envois (UU…)',
        Y.playlistUrl('UCAcAnMF0OrCtUep3Y4M-ZPw') === 'https://www.youtube.com/playlist?list=UUAcAnMF0OrCtUep3Y4M-ZPw');
console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
process.exit(ko ? 1 : 0);

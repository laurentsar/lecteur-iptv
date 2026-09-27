/* Adresses de secours d'une playlist (www/serveurs.js) : ordre d'essai,
   bascule sur la première adresse qui répond, réécriture des liens. */
const S = require('../www/serveurs.js');
let ok = 0, ko = 0;
function verifie(nom, cond, detail) {
  if (cond) { console.log('  ✓ ' + nom); ok++; }
  else { console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); ko++; }
}
(async () => {
  verifie('origine d\'une URL complète', S.origine('http://Ultimateiptv.me:8080/get.php?a=1') === 'http://ultimateiptv.me:8080');
  verifie('origine sans schéma → http://', S.origine('80.82.64.16:8080') === 'http://80.82.64.16:8080');
  verifie('remplacer l\'origine garde chemin et paramètres',
    S.remplacerOrigine('http://ultimateiptv.me:8080/get.php?username=u&password=p', 'http://80.82.64.16:8080') ===
    'http://80.82.64.16:8080/get.php?username=u&password=p');
  const liste = S.lireListe('http://a.de:8080, b.de:8080\nhttp://a.de:8080/x ;c.de');
  verifie('liste saisie : séparateurs variés, doublons retirés', liste.join(' ') === 'http://a.de:8080 http://b.de:8080 http://c.de', liste.join(' '));

  const pl = { type: 'm3u', m3uUrl: 'http://ultimateiptv.me:8080/get.php?u=1', secours: ['http://80.82.64.16:8080', 'http://localhdes.de.de:8080'] };
  verifie('ordre : principale puis secours', S.candidats(pl).join(' ') === 'http://ultimateiptv.me:8080 http://80.82.64.16:8080 http://localhdes.de.de:8080');
  const pl2 = Object.assign({}, pl, { serveurOk: 'http://80.82.64.16:8080' });
  verifie('ordre : la dernière qui a marché d\'abord', S.candidats(pl2)[0] === 'http://80.82.64.16:8080');

  const vivants = { 'http://80.82.64.16:8080': true };
  const choisi = await S.choisir(pl, o => Promise.resolve(!!vivants[o]));
  verifie('bascule sur la première adresse qui répond', choisi === 'http://80.82.64.16:8080', choisi);
  const aucun = await S.choisir(pl, () => Promise.resolve(false));
  verifie('aucune ne répond → la première (message d\'erreur parlant)', aucun === 'http://ultimateiptv.me:8080');
  const exclu = await S.choisir(pl, () => Promise.resolve(true), ['http://ultimateiptv.me:8080']);
  verifie('adresse vue en panne exclue', exclu === 'http://80.82.64.16:8080', exclu);
  let appels = 0;
  await S.choisir({ type: 'xtream', serveur: 'http://x.de:8080' }, () => { appels++; return true; });
  verifie('sans secours : aucun test réseau', appels === 0);

  verifie('lien d\'une chaîne réécrit vers l\'adresse retenue',
    S.reecrire('http://ultimateiptv.me:8080/live/u/p/1.ts', pl, 'http://80.82.64.16:8080') === 'http://80.82.64.16:8080/live/u/p/1.ts');
  verifie('lien d\'un autre serveur laissé tel quel',
    S.reecrire('http://cdn.autre.com/1.ts', pl, 'http://80.82.64.16:8080') === 'http://cdn.autre.com/1.ts');

  console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
  process.exit(ko ? 1 : 0);
})();

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

console.log('\n— Classement mensuel par audience (calculé dans l\'appli) —');
{
  const J = 24 * 3600 * 1000, now = Date.parse('2026-10-01T00:00:00Z');
  const entree = (joursAvant, vues) => '<entry><published>' + new Date(now - joursAvant * J).toISOString() +
    '</published><media:group><media:statistics views="' + vues + '"/></media:group></entry>';
  const xml = '<feed><published>2015-01-01T00:00:00Z</published>' + entree(1, 300) + entree(4, 500) + entree(10, 1200) + '</feed>';
  const m = Y.audienceDepuisRss(xml, now);
  verifie('vues par jour = total ÷ jours couverts (2000 / 10)', m && m.j === 200, JSON.stringify(m));
  verifie('date de dernière vidéo', m && m.d === now - J);
  verifie('flux vide -> null', Y.audienceDepuisRss('<feed></feed>', now) === null);
  const ch = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  const aud = { a: { j: 10, d: now }, b: { j: 500, d: now }, d: { j: 70, d: now }, e: { j: 9999, d: now - 200 * J } };
  const ordre = Y.trierParAudience(ch, aud, now).map(x => x.id).join('');
  verifie('tri vues/jour décroissant, inactive > 6 mois retirée, sans mesure à la fin', ordre === 'bdac', ordre);
  verifie('sans audience -> ordre d\'origine', Y.trierParAudience(ch, null).map(x => x.id).join('') === 'abcde');
}

// Régression v2.71 → v2.76 : dès que le classement mensuel était en cache,
// l'affichage plantait après avoir vidé la rangée des catégories (le fichier
// entier était pris pour la liste). On rejoue l'onglet avec ce cache.
(async () => {
  console.log('\n— Onglet affiché avec le classement mensuel en cache —');
  const { JSDOM } = require('jsdom');
  const fs = require('fs');
  const dom = new JSDOM('<section class="panel active" id="tab-youtube"><div id="ytCategories"></div><div id="ytChaines"></div></section>',
    { runScripts: 'outside-only' });
  const w = dom.window;
  const kv = { 'yt-top': { t: Date.now(), data: fichier }, 'yt-audience-v2': { t: Date.now(), audiences: {} } };
  w.Store = { kvGet: k => Promise.resolve(kv[k] || null), kvSet: () => Promise.resolve() };
  w.Net = { fetchText: () => Promise.reject(new Error('hors ligne')), note() {} };
  const erreurs = [];
  w.addEventListener('error', e => erreurs.push(e.message));
  w.eval(fs.readFileSync(__dirname + '/../www/youtube.js', 'utf8'));
  w.YouTubeTab.render();
  await new Promise(r => setTimeout(r, 200));
  let plantage = null;
  try { w.YouTubeTab.render(); } catch (e) { plantage = e.message; }
  const n = w.document.getElementById('ytCategories').children.length;
  verifie('rendu avec le cache : aucune erreur', !plantage && !erreurs.length, plantage || erreurs.join(' ; '));
  verifie('les ' + fichier.categories.length + ' catégories restent affichées', n === fichier.categories.length, 'catégories=' + n);

  console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
  process.exit(ko ? 1 : 0);
})();

/* Clavier à l'écran (www/clavier-ecran.js), ouvert par OK dans un champ
   texte atteint à la flèche (www/dpad-nav.js). */
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const WWW = require('path').join(__dirname, '..', 'www');

let ok = 0, ko = 0;
function verifie(nom, cond, detail) {
  if (cond) { console.log('  ✓ ' + nom); ok++; }
  else { console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); ko++; }
}

const dom = new JSDOM('<label>URL de la playlist <input id="url" type="text" placeholder="https://…"></label>' +
  '<input id="mdp" type="password"><button id="autre">Autre</button>', { runScripts: 'outside-only' });
const w = dom.window, doc = w.document;
['clavier-ecran.js', 'dpad-nav.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(WWW + '/' + f, 'utf8'), dom.getInternalVMContext(), { filename: f }));

const url = doc.getElementById('url');
function ok_(cible) {
  const e = new w.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
  (cible || doc.activeElement).dispatchEvent(e);
  return e;
}
function appuie(label) {
  const b = Array.from(doc.querySelectorAll('#clavierEcran .clav-touche')).find(x => x.textContent === label);
  if (!b) throw new Error('touche absente : ' + label);
  b.click();
}
const apercu = () => doc.querySelector('#clavierEcran .clav-apercu').textContent;

(async () => {
console.log('\n— OK sur un champ atteint à la flèche ouvre le clavier à l\'écran —');
w.DpadNav.focusSansClavier(url);
const ev = ok_();
verifie('clavier ouvert', !!doc.getElementById('clavierEcran'));
verifie('OK retenu (pas de clavier système en plus)', ev.defaultPrevented);
verifie('focus sur une touche du clavier', doc.activeElement.classList.contains('clav-touche'));
verifie('titre = libellé du champ', doc.querySelector('.clav-titre').textContent.indexOf('URL de la playlist') === 0);

console.log('\n— Saisie —');
appuie('http://'); appuie('a'); appuie('⇧ Maj'); appuie('B'); appuie('⌫'); appuie('C'); appuie(':8080');
verifie('aperçu à jour', apercu() === 'http://aC:8080', apercu());
let entrees = 0;
url.addEventListener('input', () => entrees++);
appuie('✔ Valider');
verifie('valeur écrite dans le champ', url.value === 'http://aC:8080', url.value);
verifie('évènement input envoyé', entrees === 1);
verifie('clavier fermé', !doc.getElementById('clavierEcran'));
verifie('focus rendu au champ, sans clavier système', doc.activeElement === url && url.getAttribute('inputmode') === 'none');

console.log('\n— Annuler / Retour —');
ok_();
appuie('Tout effacer'); appuie('x');
appuie('✖ Annuler');
verifie('Annuler ne touche pas au champ', url.value === 'http://aC:8080');
ok_();
w.ClavierEcran.fermer(false);
verifie('fermeture (touche Retour) sans modifier', !doc.getElementById('clavierEcran') && url.value === 'http://aC:8080');

console.log('\n— Mot de passe masqué —');
const mdp = doc.getElementById('mdp');
w.DpadNav.focusSansClavier(mdp);
ok_();
appuie('a'); appuie('z');
verifie('aperçu masqué', apercu() === '••', apercu());
appuie('👁');
verifie('👁 affiche le texte', apercu() === 'az', apercu());
appuie('✔ Valider');
verifie('mot de passe écrit', mdp.value === 'az');

console.log('\n— Clavier de l\'appareil —');
w.DpadNav.focusSansClavier(url);
ok_();
appuie('⌨️ Clavier de l\'appareil');
verifie('clavier à l\'écran fermé', !doc.getElementById('clavierEcran'));
verifie('champ prêt pour le clavier système', url.hasAttribute('data-clav-natif') && !url.hasAttribute('inputmode'));

await new Promise(r => setTimeout(r, 100));   // refocus du clavier système

console.log('\n— Champ ouvert par le programme (fenêtre d\'import) : clavier à l\'écran aussi —');
doc.getElementById('autre').focus();
url.focus();
ok_();
verifie('clavier ouvert', !!doc.getElementById('clavierEcran'));
w.ClavierEcran.fermer(false);

console.log('\n— Champ touché du doigt : pas de clavier à l\'écran —');
doc.getElementById('autre').focus();
url.focus();
url.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
ok_();
verifie('rien ne s\'ouvre', !doc.getElementById('clavierEcran'));

console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
process.exit(ko ? 1 : 0);
})();

/* « Envoyer sur la Fire TV » (www/tvlink.js), avec un faux plugin natif
   TvLink : sur le téléphone, la fenêtre liste les TV trouvées et envoie la
   chaîne ; sur la TV, la chaîne reçue est ouverte dans le lecteur. */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const CODE = fs.readFileSync(require('path').join(__dirname, '..', 'www', 'tvlink.js'), 'utf8');

let ok = 0, ko = 0;
function verifie(nom, cond, detail) {
  if (cond) { console.log('  ✓ ' + nom); ok++; }
  else { console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); ko++; }
}
const attendre = ms => new Promise(r => setTimeout(r, ms));

function page(infoTv, avecPlugin = true) {
  const html = '<body><div id="tvLinkInfo" style="display:none"><p id="tvLinkInfoTxt"></p></div></body>';
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  const journal = { envois: [], ouverts: [], ecouteurs: {}, recherche: 0, arret: 0 };
  if (avecPlugin) {
    w.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        TvLink: {
          info: () => Promise.resolve(infoTv),
          addListener: (ev, fn) => { journal.ecouteurs[ev] = fn; return Promise.resolve({ remove() { delete journal.ecouteurs[ev]; } }); },
          startDiscovery: () => { journal.recherche++; return Promise.resolve(); },
          stopDiscovery: () => { journal.arret++; return Promise.resolve(); },
          send: (o) => { journal.envois.push(o); return o.host === '10.0.0.99' ? Promise.reject(new Error('TV injoignable')) : Promise.resolve(); }
        }
      }
    };
  }
  w.Player = { open: (url, titre, opts) => journal.ouverts.push({ url, titre, opts }) };
  require('vm').runInContext(CODE, dom.getInternalVMContext(), { filename: 'tvlink.js' });
  return { w, journal };
}

(async () => {
  console.log('Adresse saisie à la main');
  const { w: w0 } = page({ tv: false });
  const pa = w0.TvLinkUI.parseAdresse;
  verifie('IP seule → port par défaut', JSON.stringify(pa(' 192.168.1.20 ')) === '{"host":"192.168.1.20","port":47800}');
  verifie('IP:port', JSON.stringify(pa('192.168.1.20:5000')) === '{"host":"192.168.1.20","port":5000}');
  verifie('saisie vide ou farfelue refusée', pa('') === null && pa('a b') === null);

  console.log('Téléphone : choix de la TV puis envoi');
  {
    const { w, journal } = page({ tv: false });
    let bouton = false;
    w.TvLinkUI.whenSender(() => { bouton = true; });
    await attendre(10);
    verifie('bouton proposé sur un téléphone', bouton);
    let envoyeA = null;
    w.TvLinkUI.choisir({ url: 'http://srv/live/1.ts', title: 'TF1', live: true, logo: 'l.png', epgKey: 'tf1' }, nom => { envoyeA = nom; });
    await attendre(10);
    verifie('recherche lancée', journal.recherche === 1);
    journal.ecouteurs.device({ name: 'Fire TV du salon', host: '192.168.1.30', port: 47800 });
    journal.ecouteurs.device({ name: 'Fire TV du salon', host: '192.168.1.30', port: 47800 });
    const items = w.document.querySelectorAll('.tvlink-carte .version-item');
    verifie('TV listée une seule fois', items.length === 1 && /Fire TV du salon/.test(items[0].textContent), items.length);
    items[0].click();
    await attendre(10);
    const e = journal.envois[0] || {};
    verifie('chaîne envoyée à la bonne TV', e.host === '192.168.1.30' && e.port === 47800 && e.url === 'http://srv/live/1.ts' && e.title === 'TF1' && e.epgKey === 'tf1');
    verifie('fenêtre refermée, recherche arrêtée, rappel fait', !w.document.querySelector('.tvlink-fond') && journal.arret === 1 && envoyeA === 'Fire TV du salon');
  }

  console.log('Téléphone : envoi par IP qui échoue');
  {
    const { w, journal } = page({ tv: false });
    let rappel = false;
    w.TvLinkUI.choisir({ url: 'http://srv/live/1.ts', title: 'TF1' }, () => { rappel = true; });
    await attendre(10);
    w.document.querySelector('.tvlink-ip input').value = '10.0.0.99';
    w.document.querySelector('.tvlink-ip button').click();
    await attendre(10);
    verifie('erreur affichée, fenêtre gardée ouverte', !rappel && !!w.document.querySelector('.tvlink-fond') &&
      /Envoi impossible/.test(w.document.querySelector('.tvlink-carte .hint').textContent));
    verifie('IP mémorisée', w.localStorage.getItem('iptv:tvlink:ip') === '10.0.0.99');
    w.document.querySelector('.tvlink-annuler').click();
    verifie('Annuler referme', !w.document.querySelector('.tvlink-fond'));
  }

  console.log('TV : réception');
  {
    const { w, journal } = page({ tv: true, receiving: true, name: 'Fire TV du salon', ip: '192.168.1.30', port: 47800 });
    let bouton = false;
    w.TvLinkUI.whenSender(() => { bouton = true; });
    await attendre(10);
    verifie('pas de bouton d\'envoi sur la TV', !bouton);
    verifie('Réglages → Infos : nom et IP affichés', w.document.getElementById('tvLinkInfo').style.display === '' &&
      /Fire TV du salon/.test(w.document.getElementById('tvLinkInfoTxt').textContent) &&
      /192\.168\.1\.30/.test(w.document.getElementById('tvLinkInfoTxt').textContent));
    journal.ecouteurs.play({ url: 'http://srv/live/2.ts', title: 'France 2', live: true, logo: '', epgKey: 'f2' });
    const o = journal.ouverts[0] || {};
    verifie('chaîne reçue ouverte en direct', o.url === 'http://srv/live/2.ts' && o.titre === 'France 2' && o.opts.live === true && o.opts.epgKey === 'f2');
  }

  console.log('Navigateur (PWA) : rien');
  {
    const { w } = page(null, false);
    let bouton = false;
    w.TvLinkUI.whenSender(() => { bouton = true; });
    await attendre(10);
    verifie('pas de bouton sans le plugin natif', !bouton);
  }

  console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
  process.exit(ko ? 1 : 0);
})();

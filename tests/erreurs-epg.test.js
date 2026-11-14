/* Messages d'erreur clairs (www/erreurs.js) et guide allégé (www/epg.js :
   filtrage sur les chaînes de la playlist, fenêtre resserrée). */
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const WWW = require('path').join(__dirname, '..', 'www');

let ok = 0, ko = 0;
function verifie(nom, cond, detail) {
  if (cond) { console.log('  ✓ ' + nom); ok++; }
  else { console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); ko++; }
}

const dom = new JSDOM('', { runScripts: 'outside-only' });
const w = dom.window;
['erreurs.js', 'epg.js'].forEach(f => vm.runInContext(fs.readFileSync(WWW + '/' + f, 'utf8'), dom.getInternalVMContext(), { filename: f }));
const E = w.Erreurs, Epg = w.Epg;

console.log('— Erreurs en clair —');
verifie('403 : abonnement utilisé ailleurs', /autre appareil/.test(E.http(403)));
verifie('401 : identifiants', /Identifiants refusés/.test(E.http(401)));
verifie('404 : chaîne introuvable', /introuvable/.test(E.http(404)));
verifie('503 : serveur en panne', /panne/.test(E.http(503)));
verifie('hls avec code HTTP', /autre appareil/.test(E.hls({ type: 'networkError', details: 'manifestLoadError', response: { code: 458 } })));
verifie('hls délai dépassé', /ne répond pas/.test(E.hls({ type: 'networkError', details: 'fragLoadTimeOut' })));
verifie('hls manifeste illisible', /n’envoie pas de vidéo/.test(E.hls({ type: 'networkError', details: 'manifestParsingError' })));
verifie('mpegts avec code', /introuvable/.test(E.mpegts('NetworkError', 'HttpStatusCodeInvalid', { code: 404 })));
verifie('<video> format non pris en charge', /Format non pris en charge/.test(E.media(4)));
verifie('AVPlay connexion', /injoignable/.test(E.avplay('PLAYER_ERROR_CONNECTION_FAILED')));
verifie('rien de précis : chaîne vide', E.hls({ type: 'otherError', details: 'x' }) === '' && E.http(0) === '');
Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => false });
verifie('hors ligne : « pas de connexion »', /Pas de connexion internet/.test(E.hls({ response: { code: 403 } })) && /Pas de connexion/.test(E.silence()));
Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => true });

console.log('— Guide allégé —');
function date(ms) {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + '00 +0000';
}
const H = 3600000, now = Date.now();
function prog(ch, debutH, finH, titre) {
  return `<programme channel="${ch}" start="${date(now + debutH * H)}" stop="${date(now + finH * H)}"><title>${titre}</title><desc>résumé</desc></programme>`;
}
const xml = '<tv>' +
  '<channel id="tf1.fr"><display-name>TF1</display-name></channel>' +
  '<channel id="f2.fr"><display-name>France 2</display-name></channel>' +
  '<channel id="zdf.de"><display-name>ZDF</display-name></channel>' +
  prog('tf1.fr', -1, 1, 'JT') + prog('tf1.fr', 30, 31, 'Après-demain') + prog('tf1.fr', 100, 101, 'Dans 4 jours') +
  prog('f2.fr', -1, 1, 'Météo') + prog('zdf.de', -1, 1, 'Heute') + '</tv>';

const tout = Epg.parseXmltvText(xml);
verifie('sans filtre : toutes les chaînes', !!tout['zdf.de'] && !!tout['tf1.fr'] && !!tout['f2.fr']);
const voulues = Epg.chainesVoulues([{ epgKey: null, name: '|FR| TF1 FHD' }, { epgKey: 'f2.fr', name: 'France 2' }]);
const filtre = Epg.parseXmltvText(xml, { voulues });
verifie('filtré : chaîne étrangère absente', !filtre['zdf.de']);
verifie('filtré : chaîne retrouvée par son nom', !!filtre['tf1.fr'] && !!Epg.nowNext(filtre, null, '|FR| TF1 FHD'));
verifie('filtré : chaîne retrouvée par identifiant', !!filtre['f2.fr']);
const aucune = Epg.parseXmltvText(xml, { voulues: Epg.chainesVoulues([{ name: 'Inconnue' }]) });
verifie('aucune correspondance : tout est gardé plutôt qu\'un guide vide', !!aucune['zdf.de'] && !!aucune['tf1.fr']);
verifie('signature stable, change avec la playlist',
  Epg.chainesVoulues([{ name: 'TF1' }, { name: 'France 2' }]).signature === Epg.chainesVoulues([{ name: 'France 2' }, { name: 'TF1' }]).signature &&
  Epg.chainesVoulues([{ name: 'TF1' }]).signature !== Epg.chainesVoulues([{ name: 'TF1' }, { name: 'M6' }]).signature);

const normal = Epg.parseXmltvText(xml);
const leger = Epg.parseXmltvText(xml, { leger: true });
verifie('fenêtre normale : J+4 gardé', normal['tf1.fr'].some(p => p.titre === 'Dans 4 jours'));
verifie('fenêtre légère : J+4 écarté', !leger['tf1.fr'].some(p => p.titre === 'Dans 4 jours'));
verifie('fenêtre légère : l\'émission en cours reste', leger['tf1.fr'].some(p => p.titre === 'JT'));
const finLeg = Epg.finLegere(now);
verifie('fenêtre légère : jusqu\'à demain minuit', finLeg > now + 24 * H && finLeg <= now + 48 * H);

console.log(`\n=== ${ok} réussis, ${ko} échoués ===`);
process.exit(ko ? 1 : 0);

/* tvlink.js — « Envoyer sur la Fire TV ».
 *
 * La Fire TV ne sait pas faire Chromecast : elle n'apparaît jamais dans le
 * sélecteur Cast. L'APK, lui, tourne dessus. Le plugin natif TvLink (voir
 * ci/patch_tv_link.py) fait donc écouter l'appli sur la TV et la fait
 * trouver par le téléphone sur le wifi (mDNS) ; ce fichier en est la partie
 * page :
 *  - sur la TV : la chaîne reçue s'ouvre comme si on l'avait choisie, et
 *    Réglages → Infos affiche le nom et l'adresse IP de la TV (repli quand
 *    la box filtre la recherche automatique) ;
 *  - sur le téléphone : la fenêtre de choix de la TV, ouverte par le bouton
 *    📲 du lecteur web (player.js). L'écran de lecture natif a son propre
 *    bouton, entièrement natif.
 * Sans le plugin (PWA, navigateur), rien ne s'affiche : une page web ne peut
 * ni chercher des appareils sur le réseau ni en écouter.
 */
(function (global) {
  'use strict';

  var PORT = 47800;
  var IP_KEY = 'iptv:tvlink:ip';

  function plugin() {
    return (global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform() &&
      global.Capacitor.Plugins && global.Capacitor.Plugins.TvLink) || null;
  }

  // info() est asynchrone : on la demande une fois, et les appelants
  // s'abonnent au résultat.
  var infoPromise = null;
  function info() {
    var P = plugin();
    if (!P) return Promise.resolve(null);
    if (!infoPromise) infoPromise = P.info().catch(function () { return null; });
    return infoPromise;
  }

  // Le bouton d'envoi n'a de sens que sur un appareil qui n'est pas lui-même
  // la TV (téléphone, tablette).
  function whenSender(cb) {
    info().then(function (i) { if (i && !i.tv) cb(); });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // « 192.168.1.20 » ou « 192.168.1.20:47800 ».
  function parseAdresse(txt) {
    var s = String(txt || '').trim();
    var m = /^([^:\s]+)(?::(\d{1,5}))?$/.exec(s);
    if (!m) return null;
    return { host: m[1], port: m[2] ? parseInt(m[2], 10) : PORT };
  }

  // Fenêtre de choix : TV trouvées au fil de la recherche + saisie d'IP.
  // media = { url, title, live, logo, epgKey } ; onSent appelé après un
  // envoi accepté par la TV.
  function choisir(media, onSent) {
    var P = plugin();
    if (!P || !media || !media.url) return;
    var handles = [];
    var fond = el('div', 'tvlink-fond');
    var carte = el('div', 'remote-panel-card tvlink-carte');
    carte.setAttribute('role', 'dialog');
    carte.setAttribute('aria-label', 'Envoyer sur la Fire TV');
    carte.appendChild(el('div', 'tracks-title', '📲 Envoyer sur la Fire TV'));
    var statut = el('p', 'hint', 'Recherche des TV sur le wifi…');
    carte.appendChild(statut);
    var liste = el('div');
    carte.appendChild(liste);

    var ligne = el('div', 'row tvlink-ip');
    var champ = el('input');
    champ.type = 'text';
    champ.inputMode = 'decimal';
    champ.placeholder = 'Adresse IP (ex. 192.168.1.20)';
    champ.value = lsGet(IP_KEY);
    var btnIp = el('button', 'ghost', 'Envoyer');
    ligne.appendChild(champ);
    ligne.appendChild(btnIp);
    carte.appendChild(ligne);
    var annuler = el('button', 'ghost tvlink-annuler', 'Annuler');
    carte.appendChild(annuler);
    fond.appendChild(carte);
    document.body.appendChild(fond);

    var ferme = false;
    function fermer() {
      if (ferme) return;
      ferme = true;
      clearTimeout(minuteur);
      handles.forEach(function (h) { try { h.remove(); } catch (e) {} });
      P.stopDiscovery().catch(function () {});
      if (fond.parentNode) fond.parentNode.removeChild(fond);
    }

    function envoyer(host, port, nom) {
      statut.textContent = 'Envoi vers ' + nom + '…';
      P.send({
        host: host, port: port, url: media.url, title: media.title || '',
        live: media.live !== false, logo: media.logo || '', epgKey: media.epgKey || ''
      }).then(function () {
        fermer();
        if (onSent) onSent(nom);
      }).catch(function (e) {
        statut.textContent = 'Envoi impossible : ' + ((e && e.message) || e);
      });
    }

    var trouvees = {};
    function ajouter(d) {
      if (!d || !d.name || ferme) return;
      if (trouvees[d.name]) liste.removeChild(trouvees[d.name]);
      var b = el('button', 'version-item', '📺 ' + d.name);
      b.style.display = 'block';
      b.style.width = '100%';
      b.addEventListener('click', function () { envoyer(d.host, d.port, d.name); });
      trouvees[d.name] = b;
      liste.appendChild(b);
      statut.textContent = 'Choisis la TV :';
      if (!liste.querySelector(':focus')) b.focus();
    }
    function retirer(d) {
      if (d && trouvees[d.name]) { liste.removeChild(trouvees[d.name]); delete trouvees[d.name]; }
    }

    btnIp.addEventListener('click', function () {
      var a = parseAdresse(champ.value);
      if (!a) { statut.textContent = 'Adresse invalide.'; return; }
      lsSet(IP_KEY, champ.value.trim());
      envoyer(a.host, a.port, a.host);
    });
    annuler.addEventListener('click', fermer);
    fond.addEventListener('click', function (e) { if (e.target === fond) fermer(); });

    var minuteur = setTimeout(function () {
      if (!Object.keys(trouvees).length) {
        statut.textContent = 'Aucune TV trouvée. Ouvre Lecteur IPTV sur la Fire TV (même wifi), ' +
          'ou tape son adresse IP — elle s\'affiche sur la TV dans Réglages → Infos.';
      }
    }, 8000);

    Promise.all([P.addListener('device', ajouter), P.addListener('deviceLost', retirer)]).then(function (hs) {
      if (ferme) { hs.forEach(function (h) { h.remove(); }); return; }
      handles = hs;
      return P.startDiscovery();
    }).catch(function () {
      statut.textContent = 'Recherche automatique impossible : tape l\'adresse IP de la TV.';
    });
    annuler.focus();
    return { fermer: fermer };
  }

  // ---------- côté TV : réception ----------
  function initReception() {
    var P = plugin();
    if (!P) return;
    P.addListener('play', function (m) {
      if (!m || !m.url || !global.Player) return;
      global.Player.open(m.url, m.title || '', { live: m.live !== false, logo: m.logo || '', epgKey: m.epgKey || '' });
    });
    info().then(function (i) {
      var box = document.getElementById('tvLinkInfo');
      if (!box || !i || !i.tv) return;
      var txt = document.getElementById('tvLinkInfoTxt');
      if (i.receiving) {
        txt.textContent = 'Cette TV s\'appelle « ' + i.name + ' » sur le réseau. Depuis le téléphone, bouton 📲 du lecteur' +
          (i.ip ? ' — ou adresse IP à saisir : ' + i.ip + (i.port !== PORT ? ':' + i.port : '') : '') + '.';
      } else {
        txt.textContent = 'Réception indisponible (port réseau occupé ?). Relance l\'appli.';
      }
      box.style.display = '';
    });
  }

  initReception();

  global.TvLinkUI = { whenSender: whenSender, choisir: choisir, parseAdresse: parseAdresse };
})(window);

/* update-check.js — vérification de mise à jour applicative (générique).
 * Interroge la dernière Release GitHub, compare au numéro embarqué et affiche
 * une bannière annonçant la mise à jour trouvée.
 *
 * Config (dans index.html, avant ce script) :
 *   window.UPDATE_REPO = 'laurentsar/<repo>';   // obligatoire
 *   window.APP_VERSION = '1.0';                  // obligatoire (version installée)
 *
 * Autonome : aucune dépendance, styles injectés. Vérifie à CHAQUE démarrage
 * de l'appli (pas de temporisation) ; mémorise la version ignorée pour ne
 * pas la re-proposer. Échec réseau silencieux.
 *
 * Dans l'APK (plugin natif présent, voir apk-update.js) : téléchargement et
 * lancement de l'installation automatiques, sans action de l'utilisateur —
 * seule la popup SYSTÈME Android « Installer cette appli ? » reste
 * incontournable (Android ne laisse aucune appli tierce s'installer sans
 * cette confirmation, sauf droits root/MDM). Dans la PWA (pas de plugin) :
 * lien de téléchargement classique, qui reste manuel — un navigateur exige
 * un geste utilisateur pour déclencher un téléchargement de fichier.
 */
(function () {
  'use strict';
  var REPO = window.UPDATE_REPO;
  var CURRENT = window.APP_VERSION;
  if (!REPO || !CURRENT) return;

  var KEY_DISMISS = 'updDismiss:' + REPO;

  // Exposé pour une vérification déclenchée à la main depuis l'app (bouton
  // « Vérifier maintenant » des réglages), qui reste utile même en vérifiant
  // déjà à chaque démarrage : on peut vouloir revérifier sans redémarrer.
  window.showUpdateBanner = showBanner;

  function ls(get, k, v) {
    try { return get ? localStorage.getItem(k) : localStorage.setItem(k, v); }
    catch (e) { return null; }
  }

  // Compare deux versions "a.b.c" → >0 si va plus récente que vb.
  function cmp(va, vb) {
    var a = String(va).replace(/^v/, '').split('.');
    var b = String(vb).replace(/^v/, '').split('.');
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var d = (parseInt(a[i], 10) || 0) - (parseInt(b[i], 10) || 0);
      if (d) return d;
    }
    return 0;
  }

  // Cache-buster (_) : évite qu'un service worker "cache-first" serve une
  // réponse d'API périmée. GitHub ignore les paramètres inconnus.
  fetch('https://api.github.com/repos/' + REPO + '/releases/latest?_=' + Date.now(), {
    headers: { Accept: 'application/vnd.github+json' }
  })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (rel) {
      if (!rel || !rel.tag_name) return;
      var latest = String(rel.tag_name).replace(/^v/, '');
      if (cmp(latest, CURRENT) <= 0) return;          // déjà à jour
      if (ls(true, KEY_DISMISS) === latest) return;    // version déjà ignorée
      var apk = (rel.assets || []).filter(function (a) {
        return /\.apk$/i.test(a.name);
      })[0];
      showBanner(latest, apk ? apk.browser_download_url : rel.html_url);
    })
    .catch(function () { /* hors-ligne : silencieux */ });

  function showBanner(version, url) {
    if (document.getElementById('update-banner')) return;
    var css = document.createElement('style');
    css.textContent =
      '#update-banner{position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;' +
      'display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;' +
      'background:#1f2937;color:#f9fafb;box-shadow:0 6px 24px rgba(0,0,0,.35);' +
      'font:500 14px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
      'max-width:520px;margin:0 auto}' +
      '#update-banner .ub-txt{flex:1;min-width:0}' +
      '#update-banner b{color:#fff}' +
      '#update-banner a.ub-act,#update-banner button.ub-act{flex:none;background:#22c55e;' +
      'color:#06210f;text-decoration:none;border:0;font-weight:700;font-size:14px;' +
      'padding:8px 14px;border-radius:10px;cursor:pointer}' +
      '#update-banner button.ub-x{flex:none;background:transparent;border:0;color:#9ca3af;' +
      'font-size:18px;line-height:1;cursor:pointer;padding:4px}' +
      // Visible au focus D-pad (télécommande TV) : sans ça, une fois la
      // navigation clavier/D-pad activée côté natif (voir ci/patch_tv_focus.py),
      // le bouton pouvait recevoir le focus sans que ce soit perceptible à
      // l'écran, sur un téléviseur regardé à distance.
      '#update-banner .ub-act:focus,#update-banner .ub-x:focus{outline:3px solid #fff;outline-offset:2px}';
    document.head.appendChild(css);

    var b = document.createElement('div');
    b.id = 'update-banner';
    var txt = document.createElement('span');
    txt.className = 'ub-txt';
    txt.innerHTML = '🔄 Nouvelle version <b>v' + version + '</b> disponible';

    // Si le plugin natif est présent (APK) : télécharge + lance l'INSTALLATION
    // tout seul, sans attendre un clic sur ce bouton — voir plus bas. Sinon
    // lien de téléchargement navigateur (PWA), qui reste manuel : rien ne
    // permet de déclencher un téléchargement de fichier sans geste utilisateur
    // dans un navigateur.
    var canInstall = typeof window.installApkUpdate === 'function' &&
      window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.UpdatePlugin;
    var act;
    if (canInstall) {
      act = document.createElement('button');
      act.className = 'ub-act';
      var lancer = function () {
        act.disabled = true; act.textContent = '⏳ Téléchargement…';
        window.installApkUpdate(url, act, function () {
          // Échec (permission « sources inconnues » pas encore accordée,
          // réseau coupé pendant le téléchargement...) : on rend la main
          // pour un nouvel essai manuel, seul cas où un clic est encore
          // nécessaire.
          act.disabled = false; act.textContent = '⬇ Réessayer';
        });
      };
      act.onclick = lancer;
      // Aucune action requise pour la mise à jour elle-même : lancé tout
      // seul dès l'affichage de la bannière. Seule la popup SYSTÈME Android
      // « Installer cette appli ? » reste incontournable une fois le
      // téléchargement terminé — aucune appli tierce sans droits root/MDM ne
      // peut installer un APK sans cette confirmation, Android l'impose.
      lancer();
    } else {
      act = document.createElement('a');
      act.className = 'ub-act';
      act.href = url; act.target = '_blank'; act.rel = 'noopener';
      act.textContent = 'Télécharger';
    }

    var x = document.createElement('button');
    x.className = 'ub-x';
    x.setAttribute('aria-label', 'Ignorer'); x.textContent = '✕';
    x.onclick = function () { ls(false, KEY_DISMISS, version); b.remove(); };
    b.appendChild(txt); b.appendChild(act); b.appendChild(x);
    (document.body || document.documentElement).appendChild(b);
  }
})();

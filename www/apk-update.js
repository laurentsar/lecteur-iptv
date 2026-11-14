/* apk-update.js — installation d'une mise à jour de l'APK depuis l'appli.
 *
 * update-check.js (partagé avec les autres applications) affiche la bannière
 * « Nouvelle version disponible » et cherche une fonction globale
 * window.installApkUpdate pour proposer « ⬇ Installer » plutôt qu'un simple
 * lien de téléchargement. C'est ce que ce fichier fournit, en s'appuyant sur
 * le plugin natif UpdatePlugin (voir ci/patch_updater.py) : télécharger puis
 * ouvrir l'installateur Android, sans passer par un navigateur.
 *
 * Le lien de téléchargement ne rendait pas service ici : sur une télé Android
 * ou un boîtier IPTV, il n'y a souvent aucun navigateur pour le suivre, ni
 * gestionnaire de fichiers pour rouvrir l'APK une fois téléchargée — la
 * mise à jour se faisait en pratique à la main, en adb, depuis un PC.
 *
 * Sans plugin natif (PWA, navigateur), ce fichier ne définit rien : la
 * bannière retombe d'elle-même sur le lien de téléchargement classique.
 */
(function (global) {
  'use strict';

  function plugin() {
    var cap = global.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
    return (cap.Plugins && cap.Plugins.UpdatePlugin) || null;
  }

  if (!plugin()) return;

  // Fenêtre d'information, navigable à la télécommande (un seul bouton).
  function afficher(titre, texte) {
    var fond = document.createElement('div');
    fond.className = 'version-picker';
    var carte = document.createElement('div');
    carte.className = 'version-picker-card';
    var h = document.createElement('h3');
    h.textContent = titre;
    var p = document.createElement('p');
    p.className = 'hint';
    p.style.whiteSpace = 'pre-line';
    p.textContent = texte;
    var ok = document.createElement('button');
    ok.className = 'primary';
    ok.textContent = 'OK';
    ok.style.marginTop = '12px';
    ok.onclick = function () { if (fond.parentNode) fond.parentNode.removeChild(fond); };
    carte.appendChild(h); carte.appendChild(p); carte.appendChild(ok);
    fond.appendChild(carte);
    document.body.appendChild(fond);
    ok.focus();
  }

  // Signature imposée par update-check.js : (url, bouton, onEchec).
  global.installApkUpdate = function (url, bouton, onEchec) {
    var P = plugin();
    if (!P) { if (onEchec) onEchec(); return; }
    P.downloadAndInstall({ url: url }).then(function () {
      // L'installateur Android a pris la main : le bouton reste en
      // « Installation… », l'appli va être remplacée.
      if (bouton) bouton.textContent = '⏳ Installation…';
    }).catch(function (err) {
      var msg = String((err && err.message) || err || '');
      if (onEchec) onEchec();
      // « Sources inconnues » : Android exige une autorisation explicite,
      // par application, avant de laisser installer une APK. Le message
      // par défaut du système n'explique pas où aller. Pas d'alert() : la
      // WebView de Capacitor ne l'affiche pas (voir askConfirm dans app.js).
      if (/permission|REQUEST_INSTALL|inconnue/i.test(msg)) {
        afficher('Autorise l’installation', 'Pour installer la mise à jour, Lecteur IPTV doit avoir le droit ' +
          'd’installer des applis.\n\nFire TV : Paramètres → Ma Fire TV → Options pour les développeurs → ' +
          'Installer des applis inconnues → Lecteur IPTV : Activé.\n\nAutre Android : Paramètres → ' +
          'Applications → Lecteur IPTV → Installer des applications inconnues.\n\nPuis reviens ici : ' +
          '« Réessayer » sur la bannière.');
      } else {
        afficher('Mise à jour impossible', msg || 'erreur inconnue');
      }
    });
  };
})(window);

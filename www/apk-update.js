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
      // par défaut du système n'explique pas où aller.
      if (/permission|REQUEST_INSTALL|inconnue/i.test(msg)) {
        alert('Autorise l’installation d’applications depuis cette source ' +
              'dans les paramètres Android (Applications → Lecteur IPTV → ' +
              'Installer des applications inconnues), puis réessaie.');
      } else {
        alert('Mise à jour impossible : ' + (msg || 'erreur inconnue'));
      }
    });
  };
})(window);

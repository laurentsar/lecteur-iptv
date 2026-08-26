/* vpn.js — rappel VPN avant la lecture d'une chaîne en direct (natif Android
 * uniquement, voir ci/patch_vpn_check.py pour le plugin natif).
 *
 * Ne construit AUCUN tunnel VPN ici : ce module lit seulement si un VPN
 * système est déjà actif (WireGuard, etc.) et, si ce n'est pas le cas,
 * propose d'ouvrir les réglages VPN de l'appareil avant de lancer la
 * lecture — une fois ce VPN activé, tout le trafic de l'appli y passe
 * automatiquement, sans rien de plus à faire ici. Sur la PWA, aucune API
 * web ne permet de détecter un VPN actif : la fonctionnalité est masquée
 * (isAvailable() renvoie false, confirmBeforePlay() ne bloque jamais).
 */
(function (global) {
  'use strict';

  function plugin() {
    var cap = global.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
    return (cap.Plugins && cap.Plugins.VpnStatus) || null;
  }

  function isAvailable() { return !!plugin(); }

  function isActive() {
    var p = plugin();
    if (!p) return Promise.resolve(null);
    return p.isActive().then(function (res) { return !!(res && res.active); }).catch(function () { return null; });
  }

  function openSettings() {
    var p = plugin();
    return p ? p.openSettings().catch(function () {}) : Promise.resolve();
  }

  // Résout à true si la lecture peut démarrer, false si l'utilisateur est
  // parti vers les réglages VPN à la place. Ne bloque jamais sur la PWA, si
  // le rappel est désactivé, ou si le statut VPN n'a pas pu être déterminé
  // (on ne veut pas empêcher de regarder la TV pour une vérification en échec).
  function confirmBeforePlay() {
    if (!isAvailable() || !global.Store || !global.Store.getVpnWarnEnabled()) return Promise.resolve(true);
    return isActive().then(function (active) {
      return active === false ? showWarnModal() : true;
    });
  }

  var resolveCb = null;
  function showWarnModal() {
    var modal = document.getElementById('vpnWarnModal');
    var dismissBox = document.getElementById('vpnWarnDismiss');
    if (!modal) return true; // DOM absent (ne devrait pas arriver) : ne bloque pas la lecture
    return new Promise(function (resolve) {
      resolveCb = resolve;
      if (dismissBox) dismissBox.checked = false;
      modal.style.display = 'flex';
    });
  }
  function closeWarnModal(proceed) {
    var modal = document.getElementById('vpnWarnModal');
    var dismissBox = document.getElementById('vpnWarnDismiss');
    if (modal) modal.style.display = 'none';
    if (dismissBox && dismissBox.checked && global.Store) global.Store.setVpnWarnEnabled(false);
    var cb = resolveCb;
    resolveCb = null;
    if (cb) cb(proceed);
  }

  function refreshStatus() {
    var statusEl = document.getElementById('vpnStatus');
    if (!statusEl) return;
    if (!isAvailable()) { statusEl.textContent = ''; return; }
    statusEl.textContent = 'Statut : vérification…';
    isActive().then(function (active) {
      statusEl.textContent =
        active === true ? 'Statut : VPN actif ✅' :
        active === false ? 'Statut : aucun VPN actif ⚠️' :
        'Statut : indisponible sur cet appareil';
    });
  }

  function initUi() {
    var card = document.getElementById('vpnCard');
    if (!isAvailable()) { if (card) card.style.display = 'none'; return; }

    var toggle = document.getElementById('vpnWarnToggle');
    if (toggle && global.Store) {
      toggle.checked = global.Store.getVpnWarnEnabled();
      toggle.addEventListener('change', function () { global.Store.setVpnWarnEnabled(toggle.checked); });
    }
    var openBtn = document.getElementById('btnOpenVpnSettings');
    if (openBtn) openBtn.addEventListener('click', openSettings);

    var modalSettingsBtn = document.getElementById('vpnWarnSettings');
    if (modalSettingsBtn) modalSettingsBtn.addEventListener('click', function () { openSettings(); closeWarnModal(false); });
    var modalContinueBtn = document.getElementById('vpnWarnContinue');
    if (modalContinueBtn) modalContinueBtn.addEventListener('click', function () { closeWarnModal(true); });

    refreshStatus();
    // Statut réactualisé au retour dans l'appli : pratique après avoir
    // basculé vers les réglages VPN system depuis le bouton ci-dessus.
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshStatus(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUi);
  else initUi();

  global.Vpn = { isAvailable: isAvailable, isActive: isActive, openSettings: openSettings, confirmBeforePlay: confirmBeforePlay };
})(window);

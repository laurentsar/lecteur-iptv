/* transfert.js — faire passer la configuration (playlists, favoris, clé
 * TMDB) d'un appareil à l'autre, sorti d'app.js :
 *  - export / import chiffrés par une phrase secrète (Réglages), et
 *    ouverture directe d'un import par lien (#import=…, ?sync=…) ;
 *  - envoi au wifi du téléphone vers la TV, réception sur la TV après
 *    confirmation, saisie par QR code et télécommande (tvlink.js).
 *
 * Transfert.monter(app) branche les boutons ; app fournit ce qui vient
 * d'app.js : etat (state), toast, askConfirm, goTab, isTabActive,
 * renderAccueil, renderPlaylists, activerPremierePlaylist.
 */
(function (global) {
  'use strict';

  function $id(id) { return document.getElementById(id); }

  function monter(app) {
    var etat = app.etat, toast = app.toast, askConfirm = app.askConfirm, goTab = app.goTab,
      isTabActive = app.isTabActive, renderAccueil = app.renderAccueil, renderPlaylists = app.renderPlaylists,
      activerPremierePlaylist = app.activerPremierePlaylist;
    var Store = global.Store, ConfigCrypto = global.ConfigCrypto, TvLinkUI = global.TvLinkUI;

    // ---------- Export / import de config (sauvegarde, transfert vers un
    // autre appareil — ex. navigateur Tesla) ----------
    function openExportModal() {
      $id('exportStep1').style.display = '';
      $id('exportStep2').style.display = 'none';
      $id('exportPassphrase').value = '';
      $id('exportError').textContent = '';
      $id('exportModal').style.display = 'flex';
    }
    function closeExportModal() { $id('exportModal').style.display = 'none'; }
    $id('btnExportConfig').addEventListener('click', openExportModal);
    $id('exportCancel').addEventListener('click', closeExportModal);
    $id('exportClose').addEventListener('click', closeExportModal);
    $id('exportModal').addEventListener('click', function (e) { if (e.target.id === 'exportModal') closeExportModal(); });
    $id('exportGenerate').addEventListener('click', function () {
      var pass = $id('exportPassphrase').value;
      if (!pass) { $id('exportError').textContent = 'La phrase secrète est obligatoire.'; return; }
      var cfg = Store.exportConfig({ favoris: $id('exportFavoris').checked, tmdbKey: $id('exportTmdb').checked });
      if (!cfg.playlists.length) { $id('exportError').textContent = 'Aucune playlist à exporter.'; return; }
      $id('exportError').textContent = '';
      ConfigCrypto.encrypt(JSON.stringify(cfg), pass).then(function (code) {
        $id('exportResult').value = code;
        $id('exportStep1').style.display = 'none';
        $id('exportStep2').style.display = '';
      }).catch(function (err) { $id('exportError').textContent = 'Chiffrement impossible : ' + err.message; });
    });
    $id('exportCopy').addEventListener('click', function () {
      var ta = $id('exportResult');
      ta.focus(); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      if (!ok && navigator.clipboard) { navigator.clipboard.writeText(ta.value).then(function () { toast('Code copié'); }); }
      else if (ok) toast('Code copié');
      else toast('Sélectionne le code et copie-le manuellement');
    });

    // Envoi de la configuration à la TV par le wifi (tvlink.js) : bouton
    // visible seulement sur un téléphone/tablette avec l'APK.
    if (TvLinkUI) {
      // TV : saisie de la playlist depuis n'importe quel téléphone (QR code).
      TvLinkUI.whenReceiver(function () {
        etat.qrSaisie = true;
        Array.prototype.forEach.call(document.querySelectorAll('.qr-saisie-ligne'), function (l) { l.style.display = ''; });
        if (isTabActive('accueil')) renderAccueil();
      });
      document.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('.btn-qr-saisie')) TvLinkUI.saisieQr();
      });
      document.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('.btn-telecommande')) TvLinkUI.telecommande();
      });
      TvLinkUI.whenSender(function () {
        etat.telecommande = true;
        if (isTabActive('accueil')) renderAccueil();
        $id('envoiTvLigne').style.display = '';
        $id('envoiTvAide').style.display = '';
      });
      $id('btnEnvoyerTv').addEventListener('click', function () {
        var cfg = Store.exportConfig({ favoris: true, tmdbKey: true });
        if (!cfg.playlists.length && !cfg.tmdbKey) { toast('Rien à envoyer : aucune playlist.'); return; }
        TvLinkUI.envoyerConfig(JSON.stringify(cfg), function (nom) {
          toast('Envoyé à ' + nom + ' — accepte sur la TV');
        });
      });
      // Côté TV : configuration reçue d'un téléphone, importée après accord.
      TvLinkUI.onConfig(function (c) {
        var cfg;
        try { cfg = JSON.parse(c.config); } catch (e) { toast('Configuration reçue illisible'); return; }
        if (!cfg || typeof cfg !== 'object') return;
        var nbPl = (cfg.playlists || []).length, nbFav = (cfg.favoris || []).length;
        var quoi = [nbPl + ' playlist(s)', nbFav + ' favori(s)'];
        if (cfg.tmdbKey) quoi.push('la clé TMDB');
        askConfirm((c.from ? '« ' + c.from + ' »' : 'Un téléphone') + ' t\'envoie ' + quoi.join(', ') +
          '. Les ajouter à cette TV ?', '📲 Configuration reçue').then(function (ok) {
          if (!ok) return;
          var added = Store.importConfig(cfg);
          toast('Ajouté : ' + added.playlists + ' playlist(s), ' + added.favoris + ' favori(s)' +
            (added.tmdbKey ? ', clé TMDB' : ''));
          renderPlaylists();
          activerPremierePlaylist();
        });
      });
    }

    function openImportModal(prefill) {
      $id('importCode').value = prefill || '';
      $id('importPassphrase').value = '';
      $id('importError').textContent = '';
      $id('importModal').style.display = 'flex';
      setTimeout(function () { $id('importPassphrase').focus(); }, 50);
    }
    function closeImportModal() { $id('importModal').style.display = 'none'; }
    $id('btnImportConfig').addEventListener('click', function () { openImportModal(); });
    $id('importCancel').addEventListener('click', closeImportModal);
    $id('importModal').addEventListener('click', function (e) { if (e.target.id === 'importModal') closeImportModal(); });
    $id('importConfirm').addEventListener('click', function () {
      var code = $id('importCode').value.trim();
      var pass = $id('importPassphrase').value;
      if (!code || !pass) { $id('importError').textContent = 'Code et phrase secrète obligatoires.'; return; }
      $id('importError').textContent = '';
      ConfigCrypto.decrypt(code, pass).then(function (json) {
        var cfg = JSON.parse(json);
        var added = Store.importConfig(cfg);
        closeImportModal();
        toast('Importé : ' + added.playlists + ' playlist(s), ' + added.favoris + ' favori(s)');
        renderPlaylists();
        activerPremierePlaylist();
      }).catch(function (err) { $id('importError').textContent = err.message || 'Import impossible.'; });
    });

    // Ouverture directe d'un import depuis un lien (#import=<code>, généré par
    // Exporter) ou depuis un code hébergé sur GitHub Pages (?sync=<id> ->
    // sync/<id>.json, relatif : fonctionne aussi bien sous / que sous un
    // sous-dossier comme /lecteur-iptv/). Utile pour taper un lien court une
    // seule fois sur un écran sans clavier physique (ex. Tesla) plutôt que de
    // recopier tout le code chiffré.
    (function checkIncomingImport() {
      if (location.hash.indexOf('#import=') === 0) {
        var code = decodeURIComponent(location.hash.slice('#import='.length));
        history.replaceState(null, '', location.pathname + location.search);
        goTab('reglages');
        openImportModal(code);
        return;
      }
      var params = new URLSearchParams(location.search);
      var syncId = params.get('sync');
      if (syncId && /^[a-z0-9_-]+$/i.test(syncId)) {
        fetch('sync/' + syncId + '.json').then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        }).then(function (code) {
          goTab('reglages');
          openImportModal(code);
        }).catch(function () { toast('Config « ' + syncId + ' » introuvable'); });
      }
    })();
  }

  global.Transfert = { monter: monter };
})(window);

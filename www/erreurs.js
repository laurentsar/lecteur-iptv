/* erreurs.js — pourquoi une chaîne ne passe pas, en une phrase simple.
 *
 * Les lecteurs (hls.js, mpegts.js, <video>, AVPlay de la TV Samsung) ne
 * donnent que des codes : « networkError — manifestLoadError », « 403 »,
 * « PLAYER_ERROR_CONNECTION_FAILED »… Ce fichier les traduit en ce que
 * l'utilisateur peut comprendre et faire. Le lecteur natif de l'APK a sa
 * propre traduction, côté Java (causeLisible dans ci/patch_native_player.py),
 * alignée sur celle-ci.
 *
 * Chaque fonction rend une phrase, ou '' quand elle n'a rien de plus précis à
 * dire que le message générique de l'appelant.
 */
(function (global) {
  'use strict';

  function horsLigne() {
    return !!(global.navigator && global.navigator.onLine === false);
  }

  var PAS_DE_RESEAU = 'Pas de connexion internet sur cet appareil (wifi coupé ?).';

  // Code HTTP renvoyé par le serveur IPTV.
  function http(code) {
    code = Number(code) || 0;
    if (!code) return '';
    if (code === 401) return 'Identifiants refusés par le fournisseur : abonnement expiré ou mot de passe changé ?';
    if (code === 403 || code === 429 || code === 456 || code === 458 || code === 509) {
      return 'Le fournisseur refuse la connexion : l’abonnement est déjà utilisé sur un autre appareil ' +
        '(arrête la lecture ailleurs) ou il a expiré.';
    }
    if (code === 404 || code === 410) {
      return 'Chaîne introuvable chez le fournisseur : elle a changé d’adresse ou n’existe plus ' +
        '(recharge la playlist dans Réglages).';
    }
    if (code >= 500) return 'Serveur du fournisseur en panne ou surchargé : réessaie dans quelques minutes.';
    return 'Le fournisseur a répondu par une erreur (' + code + ').';
  }

  // Erreur fatale de hls.js (data de l'évènement ERROR).
  function hls(data) {
    if (horsLigne()) return PAS_DE_RESEAU;
    if (!data) return '';
    var code = data.response && data.response.code;
    if (code) return http(code);
    var d = String(data.details || '');
    if (/TimeOut/i.test(d)) return 'Le serveur du fournisseur ne répond pas (trop lent ou surchargé).';
    if (/manifestParsingError|levelEmptyError|manifestIncompatibleCodecs/i.test(d)) {
      return 'Le fournisseur n’envoie pas de vidéo pour cette chaîne (lien mort ou chaîne hors service).';
    }
    if (/LoadError/i.test(d)) return 'Serveur du fournisseur injoignable : chaîne hors service, ou blocage du navigateur.';
    if (data.type === 'mediaError') return 'Vidéo illisible sur cet appareil (format non pris en charge ou flux abîmé).';
    return '';
  }

  // Erreur de mpegts.js : (type, détail, info).
  function mpegts(type, detail, info) {
    if (horsLigne()) return PAS_DE_RESEAU;
    var code = info && info.code;
    if (code && code > 0) return http(code);
    if (/Timeout/i.test(String(detail || ''))) return 'Le serveur du fournisseur ne répond pas (trop lent ou surchargé).';
    if (type === 'NetworkError') return 'Serveur du fournisseur injoignable : chaîne hors service, ou blocage du navigateur.';
    if (type === 'MediaError') return 'Vidéo illisible sur cet appareil (format non pris en charge ou flux abîmé).';
    return '';
  }

  // Code d'erreur d'un élément <video> (MediaError.code).
  function media(code) {
    if (horsLigne()) return PAS_DE_RESEAU;
    switch (code) {
      case 1: return 'Lecture interrompue.';
      case 2: return 'Serveur du fournisseur injoignable : chaîne hors service, ou abonnement à vérifier.';
      case 3: return 'Flux abîmé, ou format que cet appareil ne sait pas décoder.';
      case 4: return 'Format non pris en charge par cet appareil (vidéo HEVC/4K ou son Dolby/DTS) : ' +
        'essaie une autre version de la chaîne, ou l’appli Android.';
      default: return '';
    }
  }

  // Erreur d'AVPlay (TV Samsung) : chaîne « PLAYER_ERROR_… ».
  function avplay(type) {
    if (horsLigne()) return PAS_DE_RESEAU;
    var t = String(type || '');
    if (/CONNECTION_FAILED|NETWORK/i.test(t)) return 'Serveur du fournisseur injoignable : chaîne hors service, ou abonnement à vérifier.';
    if (/INVALID_URI|NOT_SUPPORTED_FILE|INVALID_OPERATION/i.test(t)) {
      return 'Le fournisseur n’envoie pas de vidéo lisible pour cette chaîne (lien mort ou format inconnu).';
    }
    if (/NOT_SUPPORTED|UNSUPPORTED|CODEC/i.test(t)) return 'Format non pris en charge par cette TV : essaie une autre version de la chaîne.';
    if (/TIMEOUT/i.test(t)) return 'Le serveur du fournisseur ne répond pas (trop lent ou surchargé).';
    return '';
  }

  // Aucune image ni erreur au bout du délai de démarrage.
  function silence() {
    return horsLigne() ? PAS_DE_RESEAU
      : 'La chaîne ne démarre pas : le fournisseur ne répond pas (chaîne hors service ?).';
  }

  var Erreurs = { http: http, hls: hls, mpegts: mpegts, media: media, avplay: avplay, silence: silence };
  global.Erreurs = Erreurs;
  if (typeof module !== 'undefined' && module.exports) module.exports = Erreurs;
})(typeof window !== 'undefined' ? window : globalThis);

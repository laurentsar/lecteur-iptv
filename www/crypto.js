/* crypto.js — chiffrement local d'un export de config (playlists, etc.) avec
 * une phrase secrète, avant qu'il ne quitte l'appareil (lien à taper sur un
 * autre écran, fichier hébergé sur GitHub Pages pour Tesla…). Web Crypto
 * (SubtleCrypto) : PBKDF2 (dérivation de clé depuis la phrase) + AES-GCM
 * (chiffrement authentifié). Rien n'est envoyé nulle part par ce module —
 * tout se passe dans le navigateur. */
(function (global) {
  'use strict';

  var PBKDF2_ITERATIONS = 150000;

  function bufToB64(buf) {
    var bytes = new Uint8Array(buf), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBuf(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function deriveKey(passphrase, salt) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
      .then(function (baseKey) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
          baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
      });
  }

  // encrypt(text, passphrase) -> Promise<string> (JSON {s,i,d} en base64, s=salt i=iv d=données)
  function encrypt(text, passphrase) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(passphrase, salt).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text));
    }).then(function (cipher) {
      return JSON.stringify({ s: bufToB64(salt), i: bufToB64(iv), d: bufToB64(cipher) });
    });
  }

  // decrypt(payload, passphrase) -> Promise<string> ; rejette si phrase incorrecte
  // ou payload corrompu (AES-GCM est authentifié : toute altération est détectée).
  function decrypt(payload, passphrase) {
    var p;
    try { p = JSON.parse(payload); } catch (e) { return Promise.reject(new Error('Format invalide')); }
    if (!p || !p.s || !p.i || !p.d) return Promise.reject(new Error('Format invalide'));
    var salt = new Uint8Array(b64ToBuf(p.s)), iv = new Uint8Array(b64ToBuf(p.i));
    return deriveKey(passphrase, salt).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, b64ToBuf(p.d));
    }).then(function (plain) {
      return new TextDecoder().decode(plain);
    }).catch(function () {
      throw new Error('Phrase secrète incorrecte ou fichier corrompu');
    });
  }

  global.ConfigCrypto = { encrypt: encrypt, decrypt: decrypt };
})(window);

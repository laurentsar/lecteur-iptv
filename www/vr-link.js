/* vr-link.js — lien vers le cinéma VR, construit d'un côté et relu de l'autre.
 *
 * Deux usages du même contrat :
 *   - player.js construit le lien (bouton 🥽) ;
 *   - vr.html le relit au chargement.
 * Les garder dans un seul fichier évite qu'ils divergent en silence.
 *
 * POINT IMPORTANT — les paramètres voyagent dans le FRAGMENT (#…), jamais
 * dans la chaîne de requête (?…). L'URL d'un flux IPTV contient les
 * identifiants du compte Xtream (« /live/utilisateur/motdepasse/123.ts ») :
 * placée en ?url=, elle part dans la requête HTTP et se retrouve dans les
 * journaux du serveur qui héberge la page — GitHub Pages quand on ouvre la
 * PWA depuis le casque. Le fragment, lui, n'est jamais transmis au serveur :
 * il reste dans le navigateur. La lecture accepte encore l'ancienne forme
 * ?url= pour ne pas casser un lien déjà ouvert ailleurs.
 */
(function (global) {
  'use strict';

  function construire(base, url, titre) {
    var p = new URLSearchParams();
    p.set('url', url || '');
    if (titre) p.set('title', titre);
    // base peut déjà finir par vr.html, ou n'être que la racine du site.
    var racine = String(base || '');
    if (!/vr\.html$/i.test(racine)) racine = racine.replace(/\/+$/, '') + '/vr.html';
    return racine + '#' + p.toString();
  }

  function lire(search, hash) {
    var frag = String(hash || '').replace(/^#/, '');
    var params = new URLSearchParams(frag);
    // Repli sur l'ancienne forme seulement si le fragment ne dit rien.
    if (!params.get('url')) params = new URLSearchParams(String(search || ''));
    return { url: params.get('url') || '', titre: params.get('title') || '' };
  }

  global.VrLink = { construire: construire, lire: lire };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.VrLink;

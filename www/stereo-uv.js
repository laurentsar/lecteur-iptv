/* stereo-uv.js — découpage gauche/droite d'une vidéo 3D pour le cinéma VR.
 *
 * Une vidéo « 3D » diffusée par un fournisseur IPTV n'a rien de spécial : c'est
 * une image ordinaire qui contient DEUX vues côte à côte (side-by-side) ou
 * l'une au-dessus de l'autre (over-under). Donner le relief consiste donc
 * seulement à montrer la bonne moitié à chaque œil.
 *
 * Pourquoi ce découpage passe par les coordonnées UV de la géométrie et non
 * par les réglages repeat/offset de la texture, qui seraient plus directs :
 * dans three.js ces réglages appartiennent à la TEXTURE, pas au matériau. Les
 * deux écrans (un par œil) partagent la même texture vidéo — c'est justement
 * ce qu'on veut, sans quoi l'image serait envoyée deux fois par trame à la
 * carte graphique, ce qu'un casque autonome ne pardonne pas. Un seul jeu de
 * repeat/offset pour les deux : impossible d'y loger deux cadrages. Les UV,
 * elles, appartiennent à la géométrie, donc à chaque écran.
 *
 * Le calcul doit en plus composer avec la transformation DÉJÀ appliquée à
 * cette texture par l'écran d'origine (repeat: -1 1, offset: 1 0), un miroir
 * horizontal nécessaire parce qu'on regarde la face intérieure du cylindre.
 * La texture calcule u_final = 1 - u. On cherche donc les u à écrire dans la
 * géométrie pour que u_final tombe dans la bonne moitié :
 *
 *   2D    : u_final = 1 - u                      -> u inchangé
 *   SBS   : œil gauche  u_final = (1 - u) / 2         -> u' = 0,5 + 0,5u
 *           œil droit   u_final = (1 - u) / 2 + 0,5   -> u' = 0,5u
 *   OU    : v n'est pas transformée (repeat.y = 1, offset.y = 0), donc
 *           œil gauche (moitié HAUTE, convention) v' = 0,5v + 0,5
 *           œil droit  (moitié basse)             v' = 0,5v
 */
(function (global) {
  'use strict';

  // Formats reconnus dans le nom d'une chaîne. Les fournisseurs IPTV n'ont
  // aucune métadonnée pour ça : le format n'est annoncé, quand il l'est, que
  // dans le libellé (« CANAL+ 3D SBS », « Sky 3D HSBS », « XXX 3D TAB »).
  var RE_SBS = /\b(h?-?sbs|side[ -]?by[ -]?side|3dsbs)\b/i;
  var RE_OU = /\b(h?-?ou|o-?u|tab|top[ -]?(and[ -]?)?bottom|over[ -]?under|3dou)\b/i;
  var RE_3D = /(^|[^a-z0-9])3d([^a-z0-9]|$)/i;

  /** 'sbs' | 'ou' | null (aucune indication de relief dans le nom). */
  function detecterFormat(nom) {
    var s = String(nom || '');
    if (RE_OU.test(s)) return 'ou';
    if (RE_SBS.test(s)) return 'sbs';
    // « 3D » tout court : côte-à-côte, de très loin le plus répandu en
    // diffusion. Mieux vaut un format probable qu'une image plate.
    if (RE_3D.test(s)) return 'sbs';
    return null;
  }

  /**
   * Coordonnées à écrire dans la géométrie d'un œil.
   * @param {number} u,v  coordonnées d'origine du cylindre
   * @param {string} mode '2d' | 'sbs' | 'ou'
   * @param {boolean} droit  true = œil droit
   * @returns {number[]} [u', v']
   */
  function uvOeil(u, v, mode, droit) {
    if (mode === 'sbs') return [droit ? 0.5 * u : 0.5 + 0.5 * u, v];
    if (mode === 'ou') return [u, droit ? 0.5 * v : 0.5 * v + 0.5];
    return [u, v];
  }

  global.StereoUV = { detecterFormat: detecterFormat, uvOeil: uvOeil };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.StereoUV;

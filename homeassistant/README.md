# Relais vidéo IPTV via Home Assistant

Contourne le blocage « contenu mixte » d'un navigateur : la PWA de Lecteur
IPTV est servie en `https://` (GitHub Pages), et tous les navigateurs
refusent qu'une page `https://` joigne directement un serveur en `http://`
(la quasi-totalité des serveurs IPTV/Xtream Codes) — restriction de
sécurité fixe, impossible à lever en JavaScript. Ce composant relaie la
requête depuis Home Assistant, lui-même joignable en `https://` via Nabu
Casa, et réécrit les manifestes vidéo (HLS `.m3u8`) pour que les segments
qu'ils listent passent eux aussi par ce relais.

## Installation (5 minutes)

1. **Copie le dossier `iptv_proxy/`** de ce répertoire dans
   `<config Home Assistant>/custom_components/iptv_proxy/` (crée le dossier
   `custom_components` s'il n'existe pas encore). Le résultat doit
   ressembler à :
   ```
   config/
     custom_components/
       iptv_proxy/
         __init__.py
         manifest.json
   ```
2. **Ajoute la ligne suivante** dans `configuration.yaml` :
   ```yaml
   iptv_proxy:
   ```
3. **Autorise l'origine de la PWA** — nécessaire pour que le navigateur
   accepte la réponse du relais (CORS). Toujours dans `configuration.yaml`,
   sous la section `http:` :
   ```yaml
   http:
     cors_allowed_origins:
       - https://laurentsar.github.io
   ```
   (Si tu utilises déjà la synchro des favoris — `hasync.js` — depuis la
   PWA, cette ligne existe probablement déjà : rien à changer.)
4. **Redémarre Home Assistant** (Paramètres → Système → Redémarrer).
5. Dans Lecteur IPTV, onglet **Réglages → Favoris synchronisés (Home
   Assistant)** :
   - Renseigne l'**URL** de ton Home Assistant — ton adresse Nabu Casa
     (`https://xxxx.ui.nabu.casa`), pas une adresse locale.
   - Renseigne un **jeton d'accès longue durée** (profil HA → tout en bas
     de la page → « Jetons d'accès longue durée » → Créer un jeton).
   - Coche **« Utiliser comme relais vidéo »**.

C'est tout — l'appli détecte elle-même quand un flux a besoin du relais
(uniquement les cas bloqués par le navigateur) et bascule dessus
automatiquement.

## Pourquoi Home Assistant et pas un simple lien

Home Assistant tourne déjà chez toi et Nabu Casa lui donne une adresse
`https://` valide sans rien configurer de plus (pas de certificat, pas de
redirection de port à gérer) — c'est ce qui en fait un relais pratique ici,
pas une propriété spéciale du produit : n'importe quel serveur `https://`
capable de relayer une requête HTTP ferait aussi l'affaire.

## Limites

- **Débit dépendant de ta connexion domicile** : en dehors de ton réseau
  Wi-Fi, la vidéo relayée traverse la connexion internet de ta maison (son
  débit montant, souvent le point faible d'un abonnement résidentiel) —
  contrairement à un CDN. Sur le même Wi-Fi que ta box Home Assistant, ce
  point ne se pose pas.
- **Le jeton d'accès est à conserver privé** : il donne accès à l'API de
  Home Assistant, pas seulement à ce relais. Ne le partage pas, ne le colle
  pas dans un endroit public.
- Fonctionne pour l'API Xtream (liste de chaînes, guide), les playlists
  M3U et les flux vidéo (HLS avec réécriture des manifestes, mpeg-ts et
  fichiers directs en relais simple). Ne concerne que la PWA — l'APK
  Android n'a jamais ce problème (réseau natif, pas soumis au blocage du
  navigateur).

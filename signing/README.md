# Clé de signature

`release.keystore` est un keystore PKCS12 auto-signé, généré pour cette
app uniquement, alias `app`. Il est **volontairement versionné** dans ce
dépôt, ce qui est un choix inhabituel — voici pourquoi.

## Pourquoi une clé versionnée plutôt qu'un secret GitHub

Normalement une clé de signature Android va dans un secret GitHub Actions
chiffré (`ANDROID_KEYSTORE_B64`), jamais dans le dépôt. Ici, aucun outil
disponible ne permettait de créer ce secret par programme, et la session
n'a pas non plus les droits nécessaires pour le faire à la place de
l'utilisateur. Deux options restaient :

1. **Pas de clé stable du tout** (build debug à chaque fois) : chaque
   nouvelle version aurait une signature différente, et Android refuse
   d'installer une mise à jour signée différemment de la précédente — la
   bannière « nouvelle version disponible » de l'app aurait cessé de
   fonctionner (désinstallation manuelle nécessaire à chaque mise à jour).
2. **Une clé versionnée** : la signature reste stable d'une release à
   l'autre, les mises à jour s'installent normalement par-dessus. En
   contrepartie, la clé privée est visible par quiconque peut lire ce
   dépôt.

Le choix retenu est le n°2, pour garder les mises à jour fonctionnelles.

## Ce que ça implique concrètement

- Ce dépôt est **public** : n'importe qui peut donc récupérer cette clé et
  signer un APK qu'Android acceptera comme « mise à jour » de cette app
  s'il arrive à le faire installer sur ton téléphone (ce qui demande déjà
  d'accepter une installation manuelle — Android ne l'installe jamais tout
  seul). Ce n'est pas un risque nul, mais il reste limité pour une app
  perso sideloadée, sans compte, sans données sensibles, et absente du
  Play Store.
- Pour supprimer ce risque : passer le dépôt en privé, ou régénérer une
  vraie clé stockée uniquement dans un secret GitHub Actions
  (`ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASSWORD`) et adapter le
  workflow (`.github/workflows/build-apk.yml`) pour revenir à ce
  fonctionnement — auquel cas ce dossier `signing/` peut être supprimé.
- Le mot de passe du keystore est dans le workflow en clair : il n'a pas
  de valeur de confidentialité propre puisque la clé privée elle-même est
  déjà publique.

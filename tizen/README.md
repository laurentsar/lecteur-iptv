# Lecteur IPTV sur TV Samsung (Tizen)

Les TV Samsung n'exécutent pas d'APK Android : leur système, Tizen, fait
tourner des applications HTML/JavaScript. Ce dossier emballe la page `www/`
telle quelle en application Samsung (`.wgt`). Sur la TV, `www/tizen-tv.js`
ajoute la lecture par **AVPlay** (le lecteur intégré de la TV : TS et HLS en
http://, son Dolby et MP2), la télécommande (Retour, chaînes +/−,
lecture/pause, chiffres) et l'affichage TV.

## Construire

```bash
tizen/build.sh        # → build-tizen/lecteur-iptv-<version>.wgt
```

Fait automatiquement à chaque modification de `www/` ou `tizen/` sur `main`
(`.github/workflows/build-tizen.yml`) : le `.wgt` est publié dans une
pré-version GitHub `tizen-v<version>`, qui ne remplace pas la release de
l'APK.

## Installer sur la TV

Samsung n'installe que des applications **signées avec un certificat lié à
la TV** (son identifiant DUID). Ce certificat se crée gratuitement avec
Tizen Studio et un compte Samsung, sur un ordinateur relié au même réseau
que la TV :

1. **Mode développeur de la TV** : application *Apps* → taper `1 2 3 4 5`
   à la télécommande → activer *Developer mode*, saisir l'adresse IP de
   l'ordinateur → redémarrer la TV.
2. **Tizen Studio** (ordinateur) : installer l'extension *Samsung TV
   Extension* depuis le *Package Manager*.
3. *Device Manager* → *Remote Device Manager* → ajouter la TV par son
   adresse IP → *Connect*.
4. *Certificate Manager* → nouveau profil **Samsung** (type TV), connexion
   au compte Samsung ; le DUID de la TV connectée est ajouté au certificat
   distributeur.
5. Signer et installer le `.wgt` :
   ```bash
   tizen package -t wgt -s <profil> -- lecteur-iptv-<version>.wgt
   tizen install -n lecteur-iptv-<version>.wgt -t <nom de la TV>
   ```

L'application apparaît ensuite dans *Apps* sur la TV. Le certificat reste
valable pour les versions suivantes : seule l'étape 5 est à refaire.

# Clé de signature

La clé de signature Android de cette app vit désormais **hors du dépôt**, dans
les secrets GitHub Actions `ANDROID_KEYSTORE_B64` et
`ANDROID_KEYSTORE_PASSWORD`, restaurés au moment du build par le workflow
partagé (`laurentsar/app-kit`). Copie locale de référence : `~/app-kit/keys`.

## Ce qui a changé (2026-09-05)

`release.keystore` était volontairement versionné ici, faute d'outil pour créer
un secret GitHub par programme au moment où l'app a été créée. Le dépôt étant
public, la clé privée **et** son mot de passe (écrit en clair dans le workflow)
étaient téléchargeables par n'importe qui : un tiers pouvait signer un APK qui
s'installe par-dessus l'app légitime, comme une mise à jour. C'est le même trou
que la rotation de juillet 2026 a bouché sur les autres apps.

La clé a été déplacée telle quelle, sans rotation : la signature reste
identique, donc les installations existantes (téléphone, TV TCL, Freebox Player
POP) continuent de recevoir les mises à jour sans désinstallation.

Empreinte attendue des APK publiés :

    sha256 AB:9B:9A:1C:BD:8B:00:91:20:9F:B5:76:EA:6E:25:FB:E4:FA:5B:6C:59:F9:CC:BA:25:7C:9F:72:88:B0:63:21
    subject C=FR, O=laurentsar, OU=Perso, CN=Lecteur IPTV

Vérifier un APK téléchargé : `python3 ~/app-kit/tools/verify_apk_cert.py`.

## Rotation éventuelle

La clé reste exposée dans l'historique git. La roter fermerait définitivement
le sujet, mais Android refuse une mise à jour signée différemment : il faudrait
désinstaller puis réinstaller l'app sur **tous** les appareils, en perdant les
données locales non exportées. À décider séparément, pas à l'occasion d'un
build.

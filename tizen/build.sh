#!/usr/bin/env bash
# Construit l'application Samsung (Tizen) : build-tizen/lecteur-iptv-<version>.wgt
#
# Le .wgt produit n'est PAS signé : une TV Samsung n'installe qu'une
# application signée avec un certificat lié à CETTE TV (son identifiant DUID,
# obtenu par Tizen Studio avec un compte Samsung). La signature se fait donc
# chez soi, à l'installation — voir tizen/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json; print(json.load(open('www/version.json'))['version'])")
SORTIE=build-tizen
APP=$SORTIE/app
rm -rf "$SORTIE"
mkdir -p "$APP"
cp -r www/. "$APP/"

# Service worker inutile dans une application installée (pas de cache hors
# ligne à gérer, pages servies depuis le paquet) : retiré.
rm -f "$APP/sw.js"

# API Samsung (webapis : AVPlay, informations produit). Ce chemin n'existe
# que dans le runtime Tizen : ajouté au seul paquet Tizen, avant les scripts
# de l'application.
python3 - "$APP/index.html" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
balise = '<script src="$WEBAPIS/webapis/webapis.js"></script>\n  '
i = s.index('<script')
s = s[:i] + balise + s[i:]
open(p, 'w', encoding='utf-8').write(s)
PY

# Tizen veut une version x.y.z.
sed "s/VERSION/${VERSION}.0/" tizen/config.xml > "$APP/config.xml"
cp www/img/icon-512.png "$APP/icon.png"

(cd "$APP" && zip -qr "../lecteur-iptv-${VERSION}.wgt" .)
echo "$SORTIE/lecteur-iptv-${VERSION}.wgt"

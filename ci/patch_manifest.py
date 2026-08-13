#!/usr/bin/env python3
"""Autorise le HTTP en clair vers les serveurs IPTV (android/ régénéré au build).

Android 9+ bloque le HTTP non chiffré ; beaucoup de fournisseurs IPTV et de
panels Xtream Codes ne servent qu'en http://. base-config plutôt que des
domaines : on ne connaît pas à l'avance le serveur de l'utilisateur.
Idempotent.
"""
import os
import re

NSC = """<?xml version="1.0" encoding="utf-8"?>
<!-- HTTP en clair autorisé (serveurs IPTV souvent servis en http://). -->
<network-security-config>
    <base-config cleartextTrafficPermitted="true"/>
</network-security-config>
"""

xmldir = "android/app/src/main/res/xml"
os.makedirs(xmldir, exist_ok=True)
with open(xmldir + "/network_security_config.xml", "w") as fh:
    fh.write(NSC)

mf = "android/app/src/main/AndroidManifest.xml"
s = open(mf).read()
if "networkSecurityConfig" not in s:
    s = re.sub(r"(<application\b)",
               r'\1\n        android:networkSecurityConfig="@xml/network_security_config"',
               s, count=1)
    open(mf, "w").write(s)
    print("cleartext local autorisé")
else:
    print("networkSecurityConfig déjà présent")

# Picture-in-Picture pour le direct : le bouton PiP du lecteur web
# (player.js, video.requestPictureInPicture()) ne fonctionne dans la WebView
# Android que si l'activité hôte se déclare capable de PiP dans le manifeste
# — sinon la promesse est simplement rejetée par le système, sans erreur
# claire. Aucun code Java supplémentaire n'est nécessaire pour ce cas (le
# déclenchement reste un geste utilisateur explicite, comme l'exige l'API) ;
# c'est WebView qui gère la fenêtre PiP elle-même.
s = open(mf).read()
if "supportsPictureInPicture" not in s:
    def _add_pip(m):
        return m.group(0).replace("<activity", '<activity\n            android:supportsPictureInPicture="true"', 1)
    s2, n = re.subn(r'<activity\b[^>]*android:name="\.MainActivity"[^>]*>', _add_pip, s, count=1)
    if n:
        open(mf, "w").write(s2)
        print("MainActivity : Picture-in-Picture activé")
    else:
        print("MainActivity introuvable dans le manifeste — PiP non ajouté")
else:
    print("supportsPictureInPicture déjà présent")

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

#!/usr/bin/env python3
"""Ajoute un intent-filter "lecteuriptv://config" à MainActivity (android/
régénéré à chaque build par `cap add android`, donc ce script tourne à
chaque fois).

Permet d'injecter un compte Xtream ou une playlist M3U sans passer par le
clavier tactile de l'appli (pénible à la télécommande sur TV/boîtier) : un
outil externe (ex. ADB TV Pilot) lance simplement

  adb shell am start -a android.intent.action.VIEW \
      -d "lecteuriptv://config?type=xtream&server=...&user=...&pass=..." \
      com.laurent.iptvlecteur

et l'appli reçoit l'URL via le plugin Capacitor App (événement
"appUrlOpen", géré dans www/app.js), qui l'ajoute comme n'importe quelle
playlist créée à la main. Aucune donnée ne transite par le réseau — l'intent
est local à l'appareil.

Idempotent.
"""
import re

INTENT_FILTER = """
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="lecteuriptv" android:host="config" />
            </intent-filter>
"""

mf = "android/app/src/main/AndroidManifest.xml"
s = open(mf).read()

if 'android:scheme="lecteuriptv"' in s:
    print("intent-filter lecteuriptv:// déjà présent")
else:
    m = re.search(r'<activity\b[^>]*android:name="\.MainActivity"[^>]*>', s)
    if not m:
        raise SystemExit("MainActivity introuvable dans le manifeste — intent-filter non ajouté")
    close_tag = s.index("</activity>", m.end())
    s = s[:close_tag] + INTENT_FILTER + s[close_tag:]
    open(mf, "w").write(s)
    print("intent-filter lecteuriptv:// ajouté à MainActivity")

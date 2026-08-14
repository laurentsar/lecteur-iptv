#!/usr/bin/env python3
"""Restreint l'APK aux ABI utilisées par de vrais téléphones (armeabi-v7a,
arm64-v8a) : x86/x86_64 ne servent qu'aux émulateurs, jamais à un appareil
réel, et doublaient inutilement la taille des libs natives (Media3
ExoPlayer, Google Play Services Cast, extension FFmpeg vendorisée) en les
embarquant pour quatre ABI au lieu de deux. Idempotent.
"""
import re

p = "android/app/build.gradle"
s = open(p).read()
if "abiFilters" in s:
    print("build.gradle : abiFilters déjà restreint")
else:
    s = re.sub(
        r'(testInstrumentationRunner "androidx\.test\.runner\.AndroidJUnitRunner"\n)',
        r'\1        ndk {\n            abiFilters "armeabi-v7a", "arm64-v8a"\n        }\n',
        s, count=1,
    )
    if "abiFilters" not in s:
        raise SystemExit("build.gradle : ancre testInstrumentationRunner introuvable, abiFilters non ajouté")
    open(p, "w").write(s)
    print("build.gradle : ABI restreintes à armeabi-v7a / arm64-v8a")

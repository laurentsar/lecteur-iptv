#!/usr/bin/env python3
"""Aligne versionName ET versionCode (android/app/build.gradle) sur
www/version.json.

versionCode est le seul champ qu'Android regarde réellement pour décider
si une APK est une mise à jour valide de l'appli installée (le
versionName "2.09" n'est qu'un texte d'affichage, ignoré pour cette
décision). Le laisser figé à la valeur par défaut du gabarit Capacitor
(1, jamais changée) revient à publier CHAQUE release avec le même
versionCode : certains appareils (observé sur un boîtier TV, plus stricts
qu'un téléphone) refusent alors l'installation par-dessus l'existante, ou
l'ignorent silencieusement en la traitant comme « déjà installée ».

Dérivé de version.json plutôt qu'un compteur séparé à maintenir à la
main : "MAJOR.MM" (MM sur deux chiffres, la convention suivie par ce
projet depuis le début) -> MAJOR*100 + MM, strictement croissant tant que
MM reste sous 100 (largement suffisant ici — il faudrait 100 releases
rien que pour un MAJOR donné avant collision).
"""
import json, re

ver = json.load(open('www/version.json'))['version']
major, minor = ver.split('.')
code = int(major) * 100 + int(minor)

P = 'android/app/build.gradle'
s = open(P).read()
s = re.sub(r'versionName\s+"[^"]*"', 'versionName "%s"' % ver, s, count=1)
s = re.sub(r'versionCode\s+\d+', 'versionCode %d' % code, s, count=1)
open(P, 'w').write(s)
print('versionName ->', ver)
print('versionCode ->', code)

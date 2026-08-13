#!/usr/bin/env python3
"""Remplace l'icône Capacitor par défaut par celle du Lecteur IPTV.

android/ n'est pas versionné (il est régénéré à chaque build par `cap add
android`), donc ce script tourne à chaque fois.

Sources, produites par tools_gen_icon.py :
  www/img/icon-flat.png  logo + fond, plein cadre (icônes legacy)
  www/img/icon-mark.png  logo seul sur fond transparent, cadré dans la zone de
                         sécurité de 66 % (icône adaptative Android)
"""
from PIL import Image

FLAT = Image.open('www/img/icon-flat.png').convert('RGBA')
MARK = Image.open('www/img/icon-mark.png').convert('RGBA')
BG_COLOR = '#0B1420'

RES = 'android/app/src/main/res'
# (densité, taille legacy ic_launcher, taille foreground adaptatif = 2.25x)
DENSITIES = [
    ('mipmap-mdpi', 48),
    ('mipmap-hdpi', 72),
    ('mipmap-xhdpi', 96),
    ('mipmap-xxhdpi', 144),
    ('mipmap-xxxhdpi', 192),
]

for folder, legacy_size in DENSITIES:
    flat_resized = FLAT.resize((legacy_size, legacy_size), Image.LANCZOS)
    flat_resized.save(f'{RES}/{folder}/ic_launcher.png')
    flat_resized.save(f'{RES}/{folder}/ic_launcher_round.png')

    fg_size = round(legacy_size * 2.25)
    mark_resized = MARK.resize((fg_size, fg_size), Image.LANCZOS)
    mark_resized.save(f'{RES}/{folder}/ic_launcher_foreground.png')

# Fond de l'icône adaptative (derrière ic_launcher_foreground.png)
COLOR_XML = f'''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">{BG_COLOR}</color>
</resources>
'''
open(f'{RES}/values/ic_launcher_background.xml', 'w').write(COLOR_XML)

print('Icônes Android remplacées par le logo du Lecteur IPTV')

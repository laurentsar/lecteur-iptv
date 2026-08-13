#!/usr/bin/env python3
"""Aligne versionName (android/app/build.gradle) sur www/version.json."""
import json, re

ver = json.load(open('www/version.json'))['version']
P = 'android/app/build.gradle'
s = open(P).read()
s = re.sub(r'versionName\s+"[^"]*"', 'versionName "%s"' % ver, s, count=1)
open(P, 'w').write(s)
print('versionName ->', ver)

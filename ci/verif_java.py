#!/usr/bin/env python3
"""Compile le code Java que les patches ajoutent à l'APK, sans construire
l'APK : vérification rapide des pull requests (.github/workflows/verif-pr.yml).

Les scripts ci/patch_*.py portent le Java sous forme de chaînes ; une erreur
(constante mal nommée, import oublié) ne se voyait qu'au build complet, après
la fusion — la release de la version partait alors en échec. Ici, chaque
classe est compilée par javac contre de vraies bibliothèques :
  - android-all (Robolectric, Maven Central) : l'API Android 14 complète ;
  - Capacitor (com.capacitorjs:core), androidx.core (Google Maven).

Hors champ : les classes qui dépendent de Media3/Cast (lecteur natif, service
radio) — trop de bibliothèques à rapatrier. Elles sont remplacées par des
bouchons qui exposent juste ce que les autres classes appellent.

Usage : python3 ci/verif_java.py [dossier de cache]
Code de sortie 1 et erreurs javac affichées si une classe ne compile pas.
"""
import ast
import json
import os
import re
import subprocess
import sys
import urllib.request
import zipfile

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
CACHE = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(RACINE, ".verif-java"))
PKG = "com.laurent.iptvlecteur"

CAP_VERSION = json.load(open(os.path.join(RACINE, "node_modules/@capacitor/android/package.json")))["version"]
BIBLIOS = {
    "android-all.jar": "https://repo1.maven.org/maven2/org/robolectric/android-all/14-robolectric-10818077/"
                       "android-all-14-robolectric-10818077.jar",
    "capacitor.aar": "https://repo1.maven.org/maven2/com/capacitorjs/core/%s/core-%s.aar" % (CAP_VERSION, CAP_VERSION),
    "androidx-core.aar": "https://dl.google.com/android/maven2/androidx/core/core/1.12.0/core-1.12.0.aar",
}

# Classes Media3/Cast non compilées ici : ce que le reste du code en utilise.
BOUCHONS = {
    "NativePlayerActivity": """package %s;
public class NativePlayerActivity extends androidx.appcompat.app.AppCompatActivity {
    public static class Channel {
        public String name, url, chno, epgKey, logo;
        public Channel(String name, String url, String chno, String epgKey, String logo) {}
    }
    static NativePlayerActivity current() { return null; }
    void setProgramInfo(String t) {}
    void switchTo(java.util.List<Channel> l, int i, String n) {}
}
""" % PKG,
    "RadioPlaybackService": """package %s;
public class RadioPlaybackService extends android.app.Service {
    public static final String ACTION_PLAY = "play", ACTION_STOP = "stop";
    public android.os.IBinder onBind(android.content.Intent i) { return null; }
}
""" % PKG,
    "MainActivity": "package %s;\npublic class MainActivity extends com.getcapacitor.BridgeActivity {}\n" % PKG,
}
APPCOMPAT = "package androidx.appcompat.app;\npublic class AppCompatActivity extends android.app.Activity {}\n"
# Classes de l'application générées par Gradle, absentes ici.
R_JAVA = """package %s;
public final class R {
    public static final class id { public static int playerView, playerRoot; }
    public static final class layout { public static int activity_native_player; }
    public static final class drawable { public static int ic_send_tv; }
    public static final class mipmap { public static int ic_launcher; }
}
""" % PKG


def telecharger():
    os.makedirs(CACHE, exist_ok=True)
    jars = []
    for nom, url in BIBLIOS.items():
        chemin = os.path.join(CACHE, nom)
        if not os.path.exists(chemin):
            print("téléchargement", url)
            urllib.request.urlretrieve(url, chemin)
        if nom.endswith(".aar"):
            jar = chemin[:-4] + "-classes.jar"
            if not os.path.exists(jar):
                with zipfile.ZipFile(chemin) as z, open(jar, "wb") as out:
                    out.write(z.read("classes.jar"))
            chemin = jar
        jars.append(chemin)
    return jars


def classes_des_patches():
    """{NomDeClasse: source Java} pour chaque chaîne « package … » des patches."""
    trouvees = {}
    for f in sorted(os.listdir(ICI)):
        if not (f.startswith("patch_") and f.endswith(".py")):
            continue
        arbre = ast.parse(open(os.path.join(ICI, f)).read())
        espace = {"PKG": PKG, "os": os}
        for n in arbre.body:
            if not (isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name)):
                continue
            try:
                valeur = eval(compile(ast.Expression(n.value), f, "eval"), espace)
            except Exception:
                continue
            espace[n.targets[0].id] = valeur
            if isinstance(valeur, str) and valeur.lstrip().startswith("package "):
                m = re.search(r"^(?:public\s+)?(?:final\s+)?class (\w+)", valeur, re.M)
                if m:
                    trouvees[m.group(1)] = (f, valeur)
    return trouvees


def main():
    jars = telecharger()
    src = os.path.join(CACHE, "src")
    dossier = os.path.join(src, *PKG.split("."))
    if os.path.isdir(src):
        subprocess.run(["rm", "-rf", src], check=True)
    os.makedirs(dossier)
    os.makedirs(os.path.join(src, "androidx/appcompat/app"))
    open(os.path.join(src, "androidx/appcompat/app/AppCompatActivity.java"), "w").write(APPCOMPAT)
    open(os.path.join(dossier, "R.java"), "w").write(R_JAVA)
    compilees = []
    for nom, (f, java) in classes_des_patches().items():
        if "androidx.media3" in java or "gms.cast" in java:
            print("ignorée (Media3/Cast) :", nom, "—", f)
            continue
        open(os.path.join(dossier, nom + ".java"), "w").write(java)
        compilees.append(nom)
    for nom, java in BOUCHONS.items():
        if nom not in compilees:
            open(os.path.join(dossier, nom + ".java"), "w").write(java)
    fichiers = [os.path.join(r, x) for r, _, fs in os.walk(src) for x in fs if x.endswith(".java")]
    sortie = os.path.join(CACHE, "classes")
    res = subprocess.run(["javac", "-nowarn", "-encoding", "UTF-8", "-proc:none", "-cp", os.pathsep.join(jars),
                          "-d", sortie] + fichiers, capture_output=True, text=True)
    print("compilées :", ", ".join(sorted(compilees)))
    if res.returncode != 0:
        print(res.stdout + res.stderr)
        print("ÉCHEC : le Java des patches ne compile pas.")
        sys.exit(1)
    print("OK : le Java des patches compile.")


if __name__ == "__main__":
    main()

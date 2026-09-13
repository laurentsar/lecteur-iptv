#!/usr/bin/env python3
"""Empêche l'écran de se verrouiller pendant la lecture (android/ est
régénéré à chaque build par `cap add android`, donc ce script tourne à
chaque fois).

Pourquoi natif plutôt que l'API web Screen Wake Lock (déjà utilisée dans
player.js pour la PWA) : cette API dépend de l'implémentation de la
WebView Android embarquée par Capacitor, pas toujours fiable ni supportée
selon la version/le fabricant — un utilisateur a constaté l'écran se
verrouiller malgré tout. Le flag FLAG_KEEP_SCREEN_ON, lui, agit
directement au niveau de la fenêtre Android (Activity.getWindow()),
indépendamment de la WebView : c'est le mécanisme standard et fiable
utilisé par les lecteurs vidéo natifs. Les deux mécanismes sont appliqués
ensemble dans player.js (le web reste utile pour la PWA hors APK), sans
ajouter de dépendance Gradle ni de permission (FLAG_KEEP_SCREEN_ON n'en
demande aucune).
"""
import os

PKG_DIR = "android/app/src/main/java/com/laurent/iptvlecteur"

PLUGIN_JAVA = """package com.laurent.iptvlecteur;

import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Empêche/autorise à nouveau la mise en veille de l'écran — voir
 * requestWakeLock/releaseWakeLock dans player.js. FLAG_KEEP_SCREEN_ON agit
 * directement sur la fenêtre Android, indépendamment de la WebView. */
@CapacitorPlugin(name = "KeepAwake")
public class KeepAwakePlugin extends Plugin {

    @PluginMethod
    public void keepAwake(PluginCall call) {
        getActivity().runOnUiThread(() ->
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
        call.resolve();
    }

    @PluginMethod
    public void allowSleep(PluginCall call) {
        getActivity().runOnUiThread(() ->
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
        call.resolve();
    }
}
"""


def write_if_changed(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path) and open(path).read() == content:
        print(path, "déjà à jour")
        return
    open(path, "w").write(content)
    print(path, "écrit")


def patch_main_activity():
    p = "android/app/src/main/java/com/laurent/iptvlecteur/MainActivity.java"
    s = open(p).read()
    if "registerPlugin(KeepAwakePlugin.class)" in s:
        print("MainActivity.java : KeepAwakePlugin déjà enregistré")
        return
    # Chaîné après le dernier registerPlugin(...) déjà en place (scripts de
    # patch précédents), sinon crée l'onCreate depuis zéro.
    for marker in (
        "registerPlugin(RadioPlayerPlugin.class);",
        "registerPlugin(RecorderPlugin.class);",
        "registerPlugin(NativePlayerPlugin.class);",
    ):
        if marker in s:
            s = s.replace(marker, marker + "\n        registerPlugin(KeepAwakePlugin.class);", 1)
            open(p, "w").write(s)
            print("MainActivity.java : KeepAwakePlugin enregistré")
            return
    s = s.replace(
        "public class MainActivity extends BridgeActivity {}",
        "public class MainActivity extends BridgeActivity {\n"
        "    @Override\n"
        "    public void onCreate(android.os.Bundle savedInstanceState) {\n"
        "        registerPlugin(KeepAwakePlugin.class);\n"
        "        super.onCreate(savedInstanceState);\n"
        "    }\n"
        "}\n",
    )
    open(p, "w").write(s)
    print("MainActivity.java : KeepAwakePlugin enregistré")


write_if_changed(PKG_DIR + "/KeepAwakePlugin.java", PLUGIN_JAVA)
patch_main_activity()

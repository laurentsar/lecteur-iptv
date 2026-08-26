#!/usr/bin/env python3
"""Injecte le plugin de statut VPN dans android/ (régénéré à chaque build par
`cap add android`, donc ce script tourne à chaque fois).

Ne construit AUCUN tunnel VPN : ça reviendrait à réimplémenter un client
VPN complet (VpnService, gestion de tunnel, chiffrement) pour un bénéfice
nul face à un VPN système déjà installé par l'utilisateur (WireGuard,
etc.) — celui-ci prend déjà en charge tout le trafic de l'appli
automatiquement dès qu'il est activé, sans rien à développer ici. Ce
plugin se contente de lire l'état du VPN système (actif/inactif) via
ConnectivityManager, pour afficher un statut dans Réglages et proposer un
rappel avant de lancer une chaîne en direct si aucun VPN n'est actif (voir
www/vpn.js pour la logique côté JS, www/player.js pour l'appel avant
lecture).
"""
import os
import re

PKG_DIR = "android/app/src/main/java/com/laurent/iptvlecteur"

PLUGIN_JAVA = """package com.laurent.iptvlecteur;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lit uniquement l'état du VPN système (actif ou non) — n'établit ni ne
 * gère de tunnel VPN, voir ci/patch_vpn_check.py pour le pourquoi. */
@CapacitorPlugin(name = "VpnStatus")
public class VpnStatusPlugin extends Plugin {

    @PluginMethod
    public void isActive(PluginCall call) {
        boolean active = false;
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            Network network = cm.getActiveNetwork();
            NetworkCapabilities caps = network != null ? cm.getNetworkCapabilities(network) : null;
            active = caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
        }
        JSObject ret = new JSObject();
        ret.put("active", active);
        call.resolve(ret);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_VPN_SETTINGS);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Réglages VPN indisponibles sur cet appareil", e);
        }
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


def patch_manifest():
    p = "android/app/src/main/AndroidManifest.xml"
    s = open(p).read()
    if "ACCESS_NETWORK_STATE" in s:
        print("AndroidManifest.xml : ACCESS_NETWORK_STATE déjà présente")
        return
    s = s.replace(
        '<uses-permission android:name="android.permission.INTERNET" />',
        '<uses-permission android:name="android.permission.INTERNET" />\n'
        '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
        1,
    )
    open(p, "w").write(s)
    print("AndroidManifest.xml : ACCESS_NETWORK_STATE ajoutée")


def patch_main_activity():
    p = PKG_DIR + "/MainActivity.java"
    s = open(p).read()
    if "registerPlugin(VpnStatusPlugin.class)" in s:
        print("MainActivity.java : VpnStatusPlugin déjà enregistré")
        return
    # Chaîné après le dernier registerPlugin(...) déjà en place (scripts de
    # patch précédents), sinon crée l'onCreate depuis zéro.
    for marker in (
        "registerPlugin(RadioPlayerPlugin.class);",
        "registerPlugin(RecorderPlugin.class);",
        "registerPlugin(NativePlayerPlugin.class);",
    ):
        if marker in s:
            s = s.replace(marker, marker + "\n        registerPlugin(VpnStatusPlugin.class);", 1)
            open(p, "w").write(s)
            print("MainActivity.java : VpnStatusPlugin enregistré")
            return
    s = s.replace(
        "public class MainActivity extends BridgeActivity {}",
        "public class MainActivity extends BridgeActivity {\n"
        "    @Override\n"
        "    public void onCreate(android.os.Bundle savedInstanceState) {\n"
        "        registerPlugin(VpnStatusPlugin.class);\n"
        "        super.onCreate(savedInstanceState);\n"
        "    }\n"
        "}\n",
    )
    open(p, "w").write(s)
    print("MainActivity.java : VpnStatusPlugin enregistré")


write_if_changed(PKG_DIR + "/VpnStatusPlugin.java", PLUGIN_JAVA)
patch_manifest()
patch_main_activity()

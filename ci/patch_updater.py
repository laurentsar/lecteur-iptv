#!/usr/bin/env python3
"""Plugin natif de mise à jour de l'APK (android/ est régénéré à chaque build).

Sans lui, la bannière « Nouvelle version disponible » (www/update-check.js)
n'a qu'un lien de téléchargement à proposer — inutilisable sur une télé
Android ou un boîtier IPTV, où il n'y a ni navigateur pour suivre le lien ni
gestionnaire de fichiers pour rouvrir l'APK ensuite : la mise à jour se
faisait en pratique en adb depuis un PC.

Le plugin télécharge l'APK dans le cache de l'application puis ouvre
l'installateur d'Android par un Intent ACTION_VIEW sur un FileProvider (un
file:// est refusé depuis Android 7). Il faut donc aussi :
  - la permission REQUEST_INSTALL_PACKAGES ;
  - un <provider> FileProvider + son res/xml/file_paths.xml ;
  - l'enregistrement du plugin dans MainActivity.

Doit tourner APRÈS ci/patch_native_player.py, qui réécrit MainActivity.
Idempotent.
"""
import os
import re

PKG = "com.laurent.iptvlecteur"
PKG_DIR = "android/app/src/main/java/com/laurent/iptvlecteur"
MF = "android/app/src/main/AndroidManifest.xml"
RES_XML = "android/app/src/main/res/xml"

PLUGIN_JAVA = """package %s;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Mise à jour de l'application depuis l'application elle-même : téléchargement
 * de l'APK publiée en Release GitHub, puis ouverture de l'installateur
 * d'Android. Appelé par www/apk-update.js, lui-même branché sur la bannière de
 * www/update-check.js.
 */
@CapacitorPlugin(name = "UpdatePlugin")
public class UpdatePlugin extends Plugin {

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String apkUrl = call.getString("url");
        if (apkUrl == null || apkUrl.isEmpty()) {
            call.reject("URL manquante");
            return;
        }
        final Context ctx = getContext();
        final File apkFile = new File(ctx.getCacheDir(), "lecteur-iptv-update.apk");

        // Hors du thread principal : le téléchargement peut durer plusieurs
        // dizaines de secondes sur une connexion de boîtier TV.
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    downloadFile(apkUrl, apkFile);
                    getActivity().runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                installApk(ctx, apkFile);
                                call.resolve();
                            } catch (Exception e) {
                                call.reject("Installation impossible : " + e.getMessage());
                            }
                        }
                    });
                } catch (Exception e) {
                    call.reject("Erreur de téléchargement : " + e.getMessage());
                }
            }
        }).start();
    }

    /** Version installée, pour l'écran Réglages (évite de la coder en dur deux fois). */
    @PluginMethod
    public void currentVersion(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ret.put("version", getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0).versionName);
        } catch (Exception e) {
            ret.put("version", "");
        }
        call.resolve(ret);
    }

    // Les binaires de Release GitHub sont servis par redirection vers un
    // stockage d'objets : HttpURLConnection ne suit pas automatiquement une
    // redirection qui change de protocole (http -> https), d'où la boucle.
    private void downloadFile(String urlStr, File dest) throws IOException {
        URL url = new URL(urlStr);
        int maxRedirects = 5;
        HttpURLConnection conn = null;
        while (maxRedirects-- > 0) {
            conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(120000);
            conn.connect();
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null) throw new IOException("redirection sans destination");
                url = new URL(location);
            } else if (code >= 400) {
                conn.disconnect();
                throw new IOException("HTTP " + code);
            } else {
                break;
            }
        }
        if (conn == null) throw new IOException("Connexion impossible");
        InputStream in = null;
        FileOutputStream out = null;
        try {
            in = conn.getInputStream();
            out = new FileOutputStream(dest);
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            out.flush();
        } finally {
            if (in != null) try { in.close(); } catch (IOException ignored) {}
            if (out != null) try { out.close(); } catch (IOException ignored) {}
            conn.disconnect();
        }
    }

    private void installApk(Context ctx, File apkFile) {
        Uri apkUri = FileProvider.getUriForFile(
                ctx, ctx.getPackageName() + ".fileprovider", apkFile);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        ctx.startActivity(intent);
    }
}
""" % PKG

FILE_PATHS_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- Chemins exposés par le FileProvider : uniquement le cache de l'app, où
     UpdatePlugin dépose l'APK téléchargée avant de lancer l'installateur. -->
<paths>
    <cache-path name="updates" path="." />
</paths>
"""


def write_if_changed(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path) and open(path).read() == content:
        print(os.path.basename(path), ": inchangé")
        return
    open(path, "w").write(content)
    print(os.path.basename(path), ": écrit")


def patch_manifest():
    s = open(MF).read()
    changed = False

    if "REQUEST_INSTALL_PACKAGES" not in s:
        s = re.sub(r"(</manifest>)",
                   '    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n\\1',
                   s, count=1)
        changed = True
        print("manifeste : permission REQUEST_INSTALL_PACKAGES ajoutée")

    if "${applicationId}.fileprovider" not in s:
        provider = (
            '        <provider\n'
            '            android:name="androidx.core.content.FileProvider"\n'
            '            android:authorities="${applicationId}.fileprovider"\n'
            '            android:exported="false"\n'
            '            android:grantUriPermissions="true">\n'
            '            <meta-data\n'
            '                android:name="android.support.FILE_PROVIDER_PATHS"\n'
            '                android:resource="@xml/file_paths" />\n'
            '        </provider>\n'
        )
        s = re.sub(r"([ \t]*</application>)", provider + r"\1", s, count=1)
        changed = True
        print("manifeste : FileProvider déclaré")

    if changed:
        open(MF, "w").write(s)
    else:
        print("manifeste : déjà à jour pour la mise à jour d'APK")


def patch_main_activity():
    p = PKG_DIR + "/MainActivity.java"
    s = open(p).read()
    if "registerPlugin(UpdatePlugin.class)" in s:
        print("MainActivity.java : UpdatePlugin déjà enregistré")
        return
    # Chaîné après le dernier registerPlugin(...) déjà posé par les autres
    # scripts (l'ordre entre plugins n'a pas d'importance, leur présence si).
    for marker in ("registerPlugin(KeepAwakePlugin.class);",
                   "registerPlugin(RadioPlayerPlugin.class);",
                   "registerPlugin(RecorderPlugin.class);",
                   "registerPlugin(NativePlayerPlugin.class);"):
        if marker in s:
            s = s.replace(marker, marker + "\n        registerPlugin(UpdatePlugin.class);", 1)
            open(p, "w").write(s)
            print("MainActivity.java : UpdatePlugin enregistré")
            return
    # Aucun autre plugin : gabarit Capacitor nu.
    s2 = s.replace(
        "public class MainActivity extends BridgeActivity {}",
        "public class MainActivity extends BridgeActivity {\n"
        "    @Override\n"
        "    public void onCreate(android.os.Bundle savedInstanceState) {\n"
        "        registerPlugin(UpdatePlugin.class);\n"
        "        super.onCreate(savedInstanceState);\n"
        "    }\n"
        "}\n",
    )
    if s2 == s:
        raise SystemExit("MainActivity.java : point d'insertion introuvable")
    open(p, "w").write(s2)
    print("MainActivity.java : UpdatePlugin enregistré (activité nue)")


write_if_changed(PKG_DIR + "/UpdatePlugin.java", PLUGIN_JAVA)
write_if_changed(RES_XML + "/file_paths.xml", FILE_PATHS_XML)
patch_manifest()
patch_main_activity()

#!/usr/bin/env python3
"""Injecte un lecteur vidéo natif (Media3 ExoPlayer) dans android/ (régénéré
à chaque build par `cap add android`, donc ce script tourne à chaque fois).

Pourquoi : le lecteur web (hls.js / mpegts.js / <video>) ne peut décoder que
les codecs exposés au navigateur/WebView. Beaucoup de rips IPTV utilisent
HEVC ou de l'audio AC3/DTS que Chrome/WebView ne décode pas, alors que le
décodeur MediaCodec de l'appareil (accédé nativement par ExoPlayer, hors
WebView) le peut souvent. Le plugin Capacitor « NativePlayer » ouvre un
écran natif plein écran pour ces cas — pas de contournement CORS nécessaire
non plus, ExoPlayer utilisant le réseau natif comme CapacitorHttp.

L'audio AC3/E-AC3/DTS/TrueHD (courant sur des rips IPTV, non décodé par
MediaCodec sur la plupart des appareils) est pris en charge via l'extension
FFmpeg vendorisée dans native/decoder-ffmpeg/ (voir NOTICE.md dans ce
dossier) : ce script relie ce module au projet Android (settings.gradle +
dépendance app) et configure le lecteur pour la préférer quand disponible.
"""
import os
import re

PKG_DIR = "android/app/src/main/java/com/laurent/iptvlecteur"
RES_DIR = "android/app/src/main/res"

PLUGIN_JAVA = """package com.laurent.iptvlecteur;

import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "");
        if (url == null || url.isEmpty()) {
            call.reject("url manquante");
            return;
        }
        Intent intent = new Intent(getContext(), NativePlayerActivity.class);
        intent.putExtra("url", url);
        intent.putExtra("title", title);
        getActivity().startActivity(intent);
        call.resolve();
    }
}
"""

ACTIVITY_JAVA = """package com.laurent.iptvlecteur;

import android.os.Bundle;
import android.view.View;
import android.widget.ImageButton;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

public class NativePlayerActivity extends AppCompatActivity {
    private ExoPlayer player;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_native_player);

        String url = getIntent().getStringExtra("url");
        String title = getIntent().getStringExtra("title");

        TextView titleView = findViewById(R.id.playerTitle);
        titleView.setText(title == null ? "" : title);

        ImageButton closeBtn = findViewById(R.id.playerCloseBtn);
        closeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        final TextView statusView = findViewById(R.id.playerStatusText);
        PlayerView playerView = findViewById(R.id.playerView);
        // PREFER : utilise l'extension FFmpeg (native/decoder-ffmpeg) pour
        // l'audio AC3/E-AC3/DTS/TrueHD quand le décodeur de l'appareil ne
        // sait pas le faire ; sans effet sur les formats qu'elle ne couvre
        // pas (elle ne déclare le support que pour ces codecs précis).
        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(this)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);
        player = new ExoPlayer.Builder(this, renderersFactory).build();
        playerView.setPlayer(player);

        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                statusView.setText("Lecture impossible : " + error.getErrorCodeName());
                statusView.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) {
                    statusView.setVisibility(View.GONE);
                }
            }
        });

        if (url != null && !url.isEmpty()) {
            player.setMediaItem(MediaItem.fromUri(url));
            player.prepare();
            player.setPlayWhenReady(true);
        } else {
            statusView.setText("Lecture impossible : URL manquante.");
            statusView.setVisibility(View.VISIBLE);
        }
    }

    @Override
    protected void onDestroy() {
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}
"""

LAYOUT_XML = """<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#000000">

    <androidx.media3.ui.PlayerView
        android:id="@+id/playerView"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:gravity="center_vertical"
        android:background="#CC101A24"
        android:padding="12dp">

        <TextView
            android:id="@+id/playerTitle"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:textColor="#FFFFFF"
            android:textSize="16sp"
            android:textStyle="bold"
            android:maxLines="1"
            android:ellipsize="end" />

        <ImageButton
            android:id="@+id/playerCloseBtn"
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:src="@android:drawable/ic_menu_close_clear_cancel"
            android:contentDescription="Fermer" />
    </LinearLayout>

    <TextView
        android:id="@+id/playerStatusText"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_centerInParent="true"
        android:textColor="#FFB454"
        android:textAlignment="center"
        android:padding="20dp"
        android:visibility="gone" />

</RelativeLayout>
"""

MEDIA3_VERSION = "1.4.1"
DEPENDENCY_LINES = (
    '    implementation "androidx.media3:media3-exoplayer:%s"\n'
    '    implementation "androidx.media3:media3-exoplayer-hls:%s"\n'
    '    implementation "androidx.media3:media3-ui:%s"\n'
) % (MEDIA3_VERSION, MEDIA3_VERSION, MEDIA3_VERSION)


def write_if_changed(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path) and open(path).read() == content:
        print(path, "déjà à jour")
        return
    open(path, "w").write(content)
    print(path, "écrit")


def patch_build_gradle():
    p = "android/app/build.gradle"
    s = open(p).read()
    lines = DEPENDENCY_LINES
    if "decoder-ffmpeg" not in s:
        lines += '    implementation project(":decoder-ffmpeg")\n'
    if "media3-exoplayer" in s and "decoder-ffmpeg" in s:
        print("build.gradle : dépendances media3/decoder-ffmpeg déjà présentes")
        return
    s = s.replace("dependencies {\n", "dependencies {\n" + lines, 1)
    open(p, "w").write(s)
    print("build.gradle : dépendances media3/decoder-ffmpeg ajoutées")


def patch_settings_gradle():
    p = "android/settings.gradle"
    s = open(p).read()
    if "decoder-ffmpeg" in s:
        print("settings.gradle : module decoder-ffmpeg déjà inclus")
        return
    s += (
        "\n"
        "include ':decoder-ffmpeg'\n"
        "project(':decoder-ffmpeg').projectDir = new File(rootDir, '../native/decoder-ffmpeg')\n"
    )
    open(p, "w").write(s)
    print("settings.gradle : module decoder-ffmpeg inclus")


def patch_manifest():
    p = "android/app/src/main/AndroidManifest.xml"
    s = open(p).read()
    if "NativePlayerActivity" in s:
        print("AndroidManifest.xml : NativePlayerActivity déjà déclarée")
        return
    activity = (
        '        <activity\n'
        '            android:name=".NativePlayerActivity"\n'
        '            android:theme="@style/AppTheme.NoActionBar"\n'
        '            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|screenLayout|uiMode"\n'
        '            android:exported="false" />\n\n'
        '        <provider\n'
    )
    s = re.sub(r"[ \t]*<provider\n", activity, s, count=1)
    open(p, "w").write(s)
    print("AndroidManifest.xml : NativePlayerActivity déclarée")


def patch_main_activity():
    p = "android/app/src/main/java/com/laurent/iptvlecteur/MainActivity.java"
    s = open(p).read()
    if "registerPlugin(NativePlayerPlugin.class)" in s:
        print("MainActivity.java : plugin déjà enregistré")
        return
    s = s.replace(
        "public class MainActivity extends BridgeActivity {}",
        "public class MainActivity extends BridgeActivity {\n"
        "    @Override\n"
        "    public void onCreate(android.os.Bundle savedInstanceState) {\n"
        "        registerPlugin(NativePlayerPlugin.class);\n"
        "        super.onCreate(savedInstanceState);\n"
        "    }\n"
        "}\n",
    )
    open(p, "w").write(s)
    print("MainActivity.java : NativePlayerPlugin enregistré")


write_if_changed(PKG_DIR + "/NativePlayerPlugin.java", PLUGIN_JAVA)
write_if_changed(PKG_DIR + "/NativePlayerActivity.java", ACTIVITY_JAVA)
write_if_changed(RES_DIR + "/layout/activity_native_player.xml", LAYOUT_XML)
patch_settings_gradle()
patch_build_gradle()
patch_manifest()
patch_main_activity()

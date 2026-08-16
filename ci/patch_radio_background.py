#!/usr/bin/env python3
"""Injecte la lecture radio en fond sonore dans android/ (régénéré à chaque
build par `cap add android`, donc ce script tourne à chaque fois).

Pourquoi natif : contrairement à la TV, une radio doit continuer à jouer
quand l'appli passe en arrière-plan (écran verrouillé, autre appli au
premier plan) — comme n'importe quelle appli radio. La WebView est
suspendue dans ce cas (le <video> audio s'arrête avec elle), donc la
lecture est relayée le temps que l'appli n'est pas au premier plan à un
service Android en avant-plan (notification permanente obligatoire, comme
pour l'enregistrement DVR — voir ci/patch_recorder.py, même approche).
player.js (setupRadioBackground) bascule vers ce service à la mise en
arrière-plan (Capacitor App "appStateChange") et revient au <video> de la
WebView au premier plan — pas de double lecture simultanée.

Lecture via ExoPlayer (déjà une dépendance du projet, voir
ci/patch_native_player.py) plutôt qu'un MediaPlayer basique : gère plus de
formats (HLS audio compris), et évite d'ajouter une nouvelle dépendance
Gradle. Notification manuelle (NotificationCompat, actions Lecture/Pause +
Arrêter) plutôt que MediaSessionService/MediaController de Media3 : mêmes
briques que RecordingService (permission de notification à l'exécution
comprise), pas de nouvelle dépendance media3-session ni de connexion
asynchrone au service à gérer côté plugin.
"""
import os
import re

PKG_DIR = "android/app/src/main/java/com/laurent/iptvlecteur"

PLUGIN_JAVA = """package com.laurent.iptvlecteur;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
        name = "RadioPlayer",
        permissions = {
                @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
        }
)
public class RadioPlayerPlugin extends Plugin {

    @PluginMethod
    public void play(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "playAfterPermission");
            return;
        }
        doPlay(call);
    }

    @PermissionCallback
    private void playAfterPermission(PluginCall call) {
        // On joue même si la permission de notification est refusée : le
        // service tourne quand même, seule la notification (obligatoire
        // pour un service en avant-plan) risque de ne pas s'afficher.
        doPlay(call);
    }

    private void doPlay(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "Radio");
        String logo = call.getString("logo", "");
        if (url == null || url.isEmpty()) {
            call.reject("url manquante");
            return;
        }
        Intent intent = new Intent(getContext(), RadioPlaybackService.class);
        intent.setAction(RadioPlaybackService.ACTION_PLAY);
        intent.putExtra("url", url);
        intent.putExtra("title", title);
        intent.putExtra("logo", logo);
        if (Build.VERSION.SDK_INT >= 26) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), RadioPlaybackService.class);
        intent.setAction(RadioPlaybackService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }
}
"""

SERVICE_JAVA = """package com.laurent.iptvlecteur;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;

/** Service en avant-plan : lecture radio (audio seul) qui continue quand
 * l'appli passe en arrière-plan. Notification permanente obligatoire
 * (contrainte Android pour tout service en avant-plan), avec actions
 * Lecture/Pause et Arrêter — voir RadioPlayerPlugin pour le déclenchement
 * depuis player.js et le détail de l'approche (même schéma que
 * RecordingService, voir ci/patch_recorder.py). */
public class RadioPlaybackService extends Service {
    public static final String ACTION_PLAY = "com.laurent.iptvlecteur.action.PLAY_RADIO";
    public static final String ACTION_TOGGLE = "com.laurent.iptvlecteur.action.TOGGLE_RADIO";
    public static final String ACTION_STOP = "com.laurent.iptvlecteur.action.STOP_RADIO";
    private static final String CHANNEL_ID = "radio";
    private static final int NOTIF_ID = 5502;

    private ExoPlayer player;
    private String currentTitle = "Radio";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_TOGGLE.equals(action)) {
            if (player != null) {
                player.setPlayWhenReady(!player.getPlayWhenReady());
                updateNotification();
            }
            return START_STICKY;
        }
        if (ACTION_PLAY.equals(action)) {
            String url = intent.getStringExtra("url");
            String title = intent.getStringExtra("title");
            if (url == null || url.isEmpty()) {
                stopSelf();
                return START_NOT_STICKY;
            }
            currentTitle = (title != null && !title.isEmpty()) ? title : "Radio";
            startPlayback(url);
        }
        return START_STICKY;
    }

    private void startPlayback(String url) {
        createChannelIfNeeded();
        if (player == null) {
            player = new ExoPlayer.Builder(this).build();
            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    updateNotification();
                }

                @Override
                public void onIsPlayingChanged(boolean isPlaying) {
                    updateNotification();
                }

                @Override
                public void onPlayerError(PlaybackException error) {
                    // Flux radio interrompu (réseau, source hors service...) : on
                    // arrête proprement le service plutôt que de laisser une
                    // notification permanente pour un flux mort.
                    stopSelf();
                }
            });
        }
        player.setMediaItem(MediaItem.fromUri(Uri.parse(url)));
        player.prepare();
        player.setPlayWhenReady(true);

        Notification notif = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, notif);
        }
    }

    private void createChannelIfNeeded() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID, "Radio", NotificationManager.IMPORTANCE_LOW);
                nm.createNotificationChannel(channel);
            }
        }
    }

    private static int pendingIntentFlags() {
        return PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
    }

    private Notification buildNotification() {
        boolean playing = player != null && player.getPlayWhenReady();
        Intent toggleIntent = new Intent(this, RadioPlaybackService.class).setAction(ACTION_TOGGLE);
        PendingIntent togglePending = PendingIntent.getService(this, 0, toggleIntent, pendingIntentFlags());
        Intent stopIntent = new Intent(this, RadioPlaybackService.class).setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 1, stopIntent, pendingIntentFlags());
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(currentTitle)
                .setContentText(playing ? "Lecture en cours" : "En pause")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "Pause" : "Lecture", togglePending)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Arrêter", stopPending)
                .build();
    }

    private void updateNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIF_ID, buildNotification());
        }
    }

    @Override
    public void onDestroy() {
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
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

    if "RadioPlaybackService" not in s:
        block = (
            '        <service\n'
            '            android:name=".RadioPlaybackService"\n'
            '            android:foregroundServiceType="mediaPlayback"\n'
            '            android:exported="false" />\n\n'
            '        <provider\n'
        )
        s = re.sub(r"[ \t]*<provider\n", block, s, count=1)
        print("AndroidManifest.xml : RadioPlaybackService déclaré")

    perms = [
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
        "android.permission.POST_NOTIFICATIONS",
    ]
    added = False
    for perm in perms:
        if perm not in s:
            s = s.replace(
                '<uses-permission android:name="android.permission.INTERNET" />',
                '<uses-permission android:name="android.permission.INTERNET" />\n'
                '    <uses-permission android:name="%s" />' % perm,
                1,
            )
            added = True
    if added:
        print("AndroidManifest.xml : permissions radio en fond sonore ajoutées")
    else:
        print("AndroidManifest.xml : permissions radio en fond sonore déjà présentes")

    open(p, "w").write(s)


def patch_main_activity():
    p = "android/app/src/main/java/com/laurent/iptvlecteur/MainActivity.java"
    s = open(p).read()
    if "registerPlugin(RadioPlayerPlugin.class)" in s:
        print("MainActivity.java : RadioPlayerPlugin déjà enregistré")
        return
    # Chaîné après le dernier registerPlugin(...) déjà en place (scripts de
    # patch précédents), sinon crée l'onCreate depuis zéro.
    for marker in ("registerPlugin(RecorderPlugin.class);", "registerPlugin(NativePlayerPlugin.class);"):
        if marker in s:
            s = s.replace(marker, marker + "\n        registerPlugin(RadioPlayerPlugin.class);", 1)
            open(p, "w").write(s)
            print("MainActivity.java : RadioPlayerPlugin enregistré")
            return
    s = s.replace(
        "public class MainActivity extends BridgeActivity {}",
        "public class MainActivity extends BridgeActivity {\n"
        "    @Override\n"
        "    public void onCreate(android.os.Bundle savedInstanceState) {\n"
        "        registerPlugin(RadioPlayerPlugin.class);\n"
        "        super.onCreate(savedInstanceState);\n"
        "    }\n"
        "}\n",
    )
    open(p, "w").write(s)
    print("MainActivity.java : RadioPlayerPlugin enregistré")


write_if_changed(PKG_DIR + "/RadioPlayerPlugin.java", PLUGIN_JAVA)
write_if_changed(PKG_DIR + "/RadioPlaybackService.java", SERVICE_JAVA)
patch_manifest()
patch_main_activity()

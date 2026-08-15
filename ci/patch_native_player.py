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

Diffuse aussi vers une TV (Chromecast) via Media3 CastPlayer + Google Play
Services Cast Framework : un bouton dans l'écran natif bascule la lecture
entre l'ExoPlayer local et la session Cast, sans code de lecture dupliqué
(les deux implémentent la même interface Player).

Tampon (DefaultLoadControl) élargi par rapport aux réglages par défaut
d'ExoPlayer : priorité à la stabilité sur un débit faible/instable plutôt
qu'au démarrage rapide, cohérent avec le réglage équivalent du lecteur web
(hls.js) dans player.js.
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
        boolean live = call.getBoolean("live", false);
        if (url == null || url.isEmpty()) {
            call.reject("url manquante");
            return;
        }
        Intent intent = new Intent(getContext(), NativePlayerActivity.class);
        intent.putExtra("url", url);
        intent.putExtra("title", title);
        intent.putExtra("live", live);
        getActivity().startActivity(intent);
        call.resolve();
    }
}
"""

ACTIVITY_JAVA = """package com.laurent.iptvlecteur;

import android.app.AlertDialog;
import android.app.PictureInPictureParams;
import android.content.DialogInterface;
import android.content.res.Configuration;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Rational;
import android.view.View;
import android.widget.ImageButton;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.mediarouter.app.MediaRouteButton;
import androidx.media3.cast.CastPlayer;
import androidx.media3.cast.SessionAvailabilityListener;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import com.google.android.gms.cast.framework.CastButtonFactory;
import com.google.android.gms.cast.framework.CastContext;
import java.util.ArrayList;
import java.util.List;

public class NativePlayerActivity extends AppCompatActivity {
    private static final long LOAD_TIMEOUT_MS = 20000; // certaines entrées de
    // playlist (séparateurs de catégorie décoratifs, chaînes mortes) ne
    // renvoient jamais d'erreur et resteraient bloquées indéfiniment sans ça.

    private ExoPlayer localPlayer;
    private CastPlayer castPlayer;
    private PlayerView playerView;
    private TextView statusView;
    private View topBar;
    private ImageButton tracksBtn;
    private String mediaUrl;
    private boolean isLive; // Picture-in-Picture : proposé et auto-activé au
    // bouton Accueil uniquement pour le direct (pas d'intérêt pour la VOD,
    // pas de contrôles lecture/pause depuis la mini-fenêtre système).
    private final Handler timeoutHandler = new Handler(Looper.getMainLooper());
    private final Runnable timeoutRunnable = new Runnable() {
        @Override
        public void run() {
            statusView.setText("Le flux ne répond pas (délai dépassé) — probablement hors service ou une entrée de playlist invalide.");
            statusView.setVisibility(View.VISIBLE);
        }
    };

    private final Player.Listener playerListener = new Player.Listener() {
        @Override
        public void onPlayerError(PlaybackException error) {
            timeoutHandler.removeCallbacks(timeoutRunnable);
            statusView.setText("Lecture impossible : " + error.getErrorCodeName());
            statusView.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPlaybackStateChanged(int state) {
            if (state == Player.STATE_READY) {
                timeoutHandler.removeCallbacks(timeoutRunnable);
                statusView.setVisibility(View.GONE);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_native_player);

        mediaUrl = getIntent().getStringExtra("url");
        String title = getIntent().getStringExtra("title");
        isLive = getIntent().getBooleanExtra("live", false);

        TextView titleView = findViewById(R.id.playerTitle);
        titleView.setText(title == null ? "" : title);

        topBar = findViewById(R.id.playerTopBar);

        ImageButton closeBtn = findViewById(R.id.playerCloseBtn);
        closeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        ImageButton pipBtn = findViewById(R.id.playerPipBtn);
        if (isLive && pipAvailable()) {
            pipBtn.setVisibility(View.VISIBLE);
            pipBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    enterPip();
                }
            });
        } else {
            pipBtn.setVisibility(View.GONE);
        }

        tracksBtn = findViewById(R.id.playerTracksBtn);
        tracksBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showTrackPicker();
            }
        });

        statusView = findViewById(R.id.playerStatusText);
        playerView = findViewById(R.id.playerView);

        // PREFER : utilise l'extension FFmpeg (native/decoder-ffmpeg) pour
        // l'audio AC3/E-AC3/DTS/TrueHD quand le décodeur de l'appareil ne
        // sait pas le faire ; sans effet sur les formats qu'elle ne couvre
        // pas (elle ne déclare le support que pour ces codecs précis).
        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(this)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);

        // Tampon plus généreux qu'en réglages par défaut : priorité à la
        // stabilité sur un débit faible/instable plutôt qu'au démarrage
        // rapide. La sélection adaptative de piste (ABR) reste celle
        // d'ExoPlayer par défaut pour les sources HLS/DASH multi-débits.
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(30000, 90000, 2500, 10000)
                .build();
        localPlayer = new ExoPlayer.Builder(this, renderersFactory).setLoadControl(loadControl).build();

        // Diffusion Chromecast : CastPlayer implémente la même interface
        // Player qu'ExoPlayer, donc PlayerView continue de fonctionner à
        // l'identique quel que soit celui des deux qui est actif.
        MediaRouteButton castBtn = findViewById(R.id.playerCastBtn);
        try {
            CastContext castContext = CastContext.getSharedInstance(this);
            CastButtonFactory.setUpMediaRouteButton(getApplicationContext(), castBtn);
            castPlayer = new CastPlayer(castContext);
            castPlayer.setSessionAvailabilityListener(new SessionAvailabilityListener() {
                @Override
                public void onCastSessionAvailable() {
                    switchPlayer(castPlayer);
                }

                @Override
                public void onCastSessionUnavailable() {
                    switchPlayer(localPlayer);
                }
            });
        } catch (Exception e) {
            // Google Play Services / Cast indisponible (appareil non
            // compatible, émulateur sans Play Services...) : lecture locale
            // uniquement, le bouton de diffusion disparaît.
            castBtn.setVisibility(View.GONE);
        }

        switchPlayer(castPlayer != null && castPlayer.isCastSessionAvailable() ? castPlayer : localPlayer);
    }

    private void switchPlayer(Player newPlayer) {
        Player current = playerView.getPlayer();
        if (current == newPlayer) {
            return;
        }
        long position = current != null ? current.getCurrentPosition() : 0;
        boolean playWhenReady = current == null || current.getPlayWhenReady();
        if (current != null) {
            current.pause();
            current.removeListener(playerListener);
        }

        playerView.setPlayer(newPlayer);
        newPlayer.addListener(playerListener);
        // Le choix de langue/sous-titres ne s'applique qu'à la lecture locale
        // (ExoPlayer) : CastPlayer ne partage pas la même API de sélection de
        // pistes, on masque donc le bouton pendant une diffusion Chromecast.
        tracksBtn.setVisibility(newPlayer == localPlayer ? View.VISIBLE : View.GONE);

        timeoutHandler.removeCallbacks(timeoutRunnable);
        if (mediaUrl != null && !mediaUrl.isEmpty()) {
            newPlayer.setMediaItem(MediaItem.fromUri(mediaUrl), position);
            newPlayer.prepare();
            newPlayer.setPlayWhenReady(playWhenReady);
            timeoutHandler.postDelayed(timeoutRunnable, LOAD_TIMEOUT_MS);
        } else {
            statusView.setText("Lecture impossible : URL manquante.");
            statusView.setVisibility(View.VISIBLE);
        }
    }

    private boolean pipAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    private void enterPip() {
        if (!pipAvailable()) {
            return;
        }
        PictureInPictureParams params = new PictureInPictureParams.Builder()
                .setAspectRatio(new Rational(16, 9))
                .build();
        enterPictureInPictureMode(params);
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        // Quitter l'appli (bouton Accueil) pendant une chaîne en direct
        // réduit automatiquement le lecteur en PiP au lieu d'interrompre la
        // diffusion — comportement standard attendu pour du direct.
        if (isLive) {
            enterPip();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        topBar.setVisibility(isInPictureInPictureMode ? View.GONE : View.VISIBLE);
        playerView.setUseController(!isInPictureInPictureMode);
    }

    // Liste à plat (audio puis sous-titres) plutôt qu'un dialogue à onglets :
    // ExoPlayer expose les pistes disponibles pour n'importe quel conteneur
    // (HLS, mp4, mkv...) via la même API, contrairement au web où seul hls.js
    // sait le faire — c'est justement pour ces cas (VOD HEVC/mkv multi-pistes)
    // que ce lecteur natif de secours est utilisé.
    private void showTrackPicker() {
        if (localPlayer == null) {
            return;
        }
        Tracks tracks = localPlayer.getCurrentTracks();
        final List<String> labels = new ArrayList<>();
        final List<Runnable> actions = new ArrayList<>();

        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != C.TRACK_TYPE_AUDIO) {
                continue;
            }
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSupported(i)) {
                    continue;
                }
                Format format = group.getTrackFormat(i);
                String name = format.label != null ? format.label : (format.language != null ? format.language : "Piste " + (i + 1));
                boolean selected = group.isTrackSelected(i);
                labels.add("🔊 Audio : " + name + (selected ? " ✓" : ""));
                final TrackGroup mediaTrackGroup = group.getMediaTrackGroup();
                final int trackIndex = i;
                actions.add(new Runnable() {
                    @Override
                    public void run() {
                        localPlayer.setTrackSelectionParameters(
                                localPlayer.getTrackSelectionParameters().buildUpon()
                                        .setOverrideForType(new TrackSelectionOverride(mediaTrackGroup, trackIndex))
                                        .build());
                    }
                });
            }
        }

        boolean subtitlesDisabled = localPlayer.getTrackSelectionParameters().disabledTrackTypes.contains(C.TRACK_TYPE_TEXT);
        labels.add("💬 Sous-titres : désactivés" + (subtitlesDisabled ? " ✓" : ""));
        actions.add(new Runnable() {
            @Override
            public void run() {
                localPlayer.setTrackSelectionParameters(
                        localPlayer.getTrackSelectionParameters().buildUpon()
                                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                                .build());
            }
        });

        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != C.TRACK_TYPE_TEXT) {
                continue;
            }
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSupported(i)) {
                    continue;
                }
                Format format = group.getTrackFormat(i);
                String name = format.label != null ? format.label : (format.language != null ? format.language : "Piste " + (i + 1));
                boolean selected = !subtitlesDisabled && group.isTrackSelected(i);
                labels.add("💬 Sous-titres : " + name + (selected ? " ✓" : ""));
                final TrackGroup mediaTrackGroup = group.getMediaTrackGroup();
                final int trackIndex = i;
                actions.add(new Runnable() {
                    @Override
                    public void run() {
                        localPlayer.setTrackSelectionParameters(
                                localPlayer.getTrackSelectionParameters().buildUpon()
                                        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                                        .setOverrideForType(new TrackSelectionOverride(mediaTrackGroup, trackIndex))
                                        .build());
                    }
                });
            }
        }

        new AlertDialog.Builder(this)
                .setTitle("Langue et sous-titres")
                .setItems(labels.toArray(new String[0]), new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        actions.get(which).run();
                    }
                })
                .show();
    }

    @Override
    protected void onDestroy() {
        timeoutHandler.removeCallbacks(timeoutRunnable);
        if (castPlayer != null) {
            castPlayer.setSessionAvailabilityListener(null);
            castPlayer.release();
            castPlayer = null;
        }
        if (localPlayer != null) {
            localPlayer.release();
            localPlayer = null;
        }
        super.onDestroy();
    }
}
"""

CAST_OPTIONS_PROVIDER_JAVA = """package com.laurent.iptvlecteur;

import android.content.Context;
import com.google.android.gms.cast.CastMediaControlIntent;
import com.google.android.gms.cast.framework.CastOptions;
import com.google.android.gms.cast.framework.OptionsProvider;
import com.google.android.gms.cast.framework.SessionProvider;
import java.util.List;

/** Récepteur Cast générique (Default Media Receiver de Google) — pas
 * besoin d'enregistrer une application Cast dédiée pour un usage perso. */
public class CastOptionsProvider implements OptionsProvider {
    @Override
    public CastOptions getCastOptions(Context context) {
        return new CastOptions.Builder()
                .setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)
                .build();
    }

    @Override
    public List<SessionProvider> getAdditionalSessionProviders(Context context) {
        return null;
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
        android:id="@+id/playerTopBar"
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

        <androidx.mediarouter.app.MediaRouteButton
            android:id="@+id/playerCastBtn"
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:layout_marginEnd="4dp"
            android:contentDescription="Diffuser sur une TV" />

        <ImageButton
            android:id="@+id/playerPipBtn"
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:layout_marginEnd="4dp"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:src="@drawable/ic_pip"
            android:contentDescription="Picture-in-Picture"
            android:visibility="gone" />

        <ImageButton
            android:id="@+id/playerTracksBtn"
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:layout_marginEnd="4dp"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:src="@drawable/ic_tracks"
            android:contentDescription="Langue et sous-titres" />

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

# Icône « picture_in_picture » — Google Material Icons (Apache License 2.0).
IC_PIP_XML = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="#FFFFFF">
    <path
        android:fillColor="#FF000000"
        android:pathData="M19,7h-8v6h8V7zM23,3H1v18h22V3zM21,19H3V5h18V19z" />
</vector>
"""

# Icône « language » (globe) — Google Material Icons (Apache License 2.0).
IC_TRACKS_XML = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="#FFFFFF">
    <path
        android:fillColor="#FF000000"
        android:pathData="M12,2C6.48,2 2,6.48 2,12s4.48,10 10,10 10,-4.48 10,-10S17.52,2 12,2zM11,19.93c-3.95,-0.49 -7,-3.85 -7,-7.93c0,-0.62 0.08,-1.21 0.21,-1.79L9,15v1c0,1.1 0.9,2 2,2v1.93zM17.9,17.39c-0.26,-0.81 -1,-1.39 -1.9,-1.39h-1v-3c0,-0.55 -0.45,-1 -1,-1H8v-2h2c0.55,0 1,-0.45 1,-1V7h2c1.1,0 2,-0.9 2,-2v-0.41c2.93,1.19 5,4.06 5,7.41c0,2.08 -0.8,3.97 -2.1,5.39z" />
</vector>
"""

MEDIA3_VERSION = "1.4.1"
DEPENDENCY_LINES = (
    '    implementation "androidx.media3:media3-exoplayer:%s"\n'
    '    implementation "androidx.media3:media3-exoplayer-hls:%s"\n'
    '    implementation "androidx.media3:media3-ui:%s"\n'
    '    implementation "androidx.media3:media3-cast:%s"\n'
    '    implementation "com.google.android.gms:play-services-cast-framework:21.4.0"\n'
) % (MEDIA3_VERSION, MEDIA3_VERSION, MEDIA3_VERSION, MEDIA3_VERSION)


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
        '            android:supportsPictureInPicture="true"\n'
        '            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|screenLayout|uiMode"\n'
        '            android:exported="false" />\n\n'
        '        <meta-data\n'
        '            android:name="com.google.android.gms.cast.framework.OPTIONS_PROVIDER_CLASS_NAME"\n'
        '            android:value="com.laurent.iptvlecteur.CastOptionsProvider" />\n\n'
        '        <provider\n'
    )
    s = re.sub(r"[ \t]*<provider\n", activity, s, count=1)
    open(p, "w").write(s)
    print("AndroidManifest.xml : NativePlayerActivity + CastOptionsProvider déclarées")


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
        "\n"
        "    // @capacitor/screen-orientation (verrouillage paysage du plein écran,\n"
        "    // voir player.js) appelle Activity.setRequestedOrientation() en natif :\n"
        "    // sur pas mal d'appareils/thèmes (fenêtre pas strictement opaque —\n"
        "    // barre de statut translucide, mode fenêtré/split-screen...), Android\n"
        "    // lève IllegalStateException(\"Only fullscreen activities can request\n"
        "    // orientation\") — une exception native non rattrapable côté JS (elle\n"
        "    // survient avant toute réponse au pont Capacitor) qui fait planter\n"
        "    // toute l'appli. On l'avale ici : au pire la rotation forcée est\n"
        "    // ignorée sur ces appareils, plutôt qu'un crash.\n"
        "    @Override\n"
        "    public void setRequestedOrientation(int requestedOrientation) {\n"
        "        try {\n"
        "            super.setRequestedOrientation(requestedOrientation);\n"
        "        } catch (IllegalStateException e) {\n"
        "            // ignoré volontairement — voir commentaire ci-dessus\n"
        "        }\n"
        "    }\n"
        "}\n",
    )
    open(p, "w").write(s)
    print("MainActivity.java : NativePlayerPlugin enregistré + garde anti-crash orientation")


write_if_changed(PKG_DIR + "/NativePlayerPlugin.java", PLUGIN_JAVA)
write_if_changed(PKG_DIR + "/NativePlayerActivity.java", ACTIVITY_JAVA)
write_if_changed(PKG_DIR + "/CastOptionsProvider.java", CAST_OPTIONS_PROVIDER_JAVA)
write_if_changed(RES_DIR + "/layout/activity_native_player.xml", LAYOUT_XML)
write_if_changed(RES_DIR + "/drawable/ic_pip.xml", IC_PIP_XML)
write_if_changed(RES_DIR + "/drawable/ic_tracks.xml", IC_TRACKS_XML)
patch_settings_gradle()
patch_build_gradle()
patch_manifest()
patch_main_activity()

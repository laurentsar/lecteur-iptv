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

Commandes de la télécommande : cet écran natif recouvre entièrement la page,
donc tout ce que la télécommande y pilotait disparaîtrait sans ça. Le zapping
(CHAÎNE +/−, page +/−, piste suivante/précédente, flèches haut/bas quand les
contrôles sont masqués), la composition d'un numéro de chaîne au pavé
numérique, la liste des chaînes (touche GUIDE/MENU ou bouton de la barre) et
l'enregistrement sont donc rejoués ici, sur la liste de chaînes que player.js
transmet à l'ouverture. L'habillage (barre, bandeau de zapping, bandeau du
programme en cours, couleurs, boutons arrondis) reprend celui du lecteur web
— voir www/styles.css : basculer sur le lecteur natif ne doit pas donner
l'impression de changer d'application.

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
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONObject;

@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {
    // La liste de zapping transite par un champ statique et non par les
    // extras de l'Intent : un bouquet IPTV compte couramment des milliers de
    // chaînes, bien au-delà de la limite d'une transaction Binder
    // (TransactionTooLargeException). Les deux côtés vivent dans le même
    // processus, il n'y a donc rien à sérialiser.
    static List<NativePlayerActivity.Channel> channels = new ArrayList<>();
    static int channelIndex = -1;
    // Autres versions du même contenu (menu « Sources » du lecteur web) et
    // favoris, pour que la barre native propose exactement les mêmes choix.
    static List<NativePlayerActivity.Channel> versions = new ArrayList<>();
    static Set<String> favorites = new HashSet<>();

    private static NativePlayerPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "");
        boolean live = call.getBoolean("live", false);
        if (url == null || url.isEmpty()) {
            call.reject("url manquante");
            return;
        }
        channels = parseChannels(call.getArray("channels"));
        channelIndex = call.getInt("index", -1);
        versions = parseChannels(call.getArray("versions"));
        favorites = new HashSet<>();
        for (NativePlayerActivity.Channel favori : parseChannels(call.getArray("favorites"))) {
            favorites.add(favori.url);
        }
        Intent intent = new Intent(getContext(), NativePlayerActivity.class);
        intent.putExtra("url", url);
        intent.putExtra("title", title);
        intent.putExtra("live", live);
        getActivity().startActivity(intent);
        call.resolve();
    }

    // Programme en cours : l'EPG vit dans la page (player.js le calcule après
    // chaque zapping et le pousse ici), pour que le bandeau natif affiche la
    // même information que celui du lecteur web.
    @PluginMethod
    public void setInfo(PluginCall call) {
        final String text = call.getString("text", "");
        final NativePlayerActivity activity = NativePlayerActivity.current();
        if (activity != null) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    activity.setProgramInfo(text);
                }
            });
        }
        call.resolve();
    }

    // Zapping fait dans l'écran natif : la page doit suivre (chaîne courante,
    // EPG, reprise à la fermeture), d'où cet évènement.
    static void notifyZap(int index, String url, String title) {
        if (instance == null) {
            return;
        }
        JSObject data = new JSObject();
        data.put("index", index);
        data.put("url", url);
        data.put("title", title);
        instance.notifyListeners("zap", data);
    }

    // Écran natif refermé : la page arrête de pousser l'EPG (rien ne
    // l'affiche plus) et reprend la main.
    static void notifyClosed() {
        if (instance == null) {
            return;
        }
        instance.notifyListeners("closed", new JSObject());
    }

    // Bouton Accueil de la barre : l'écran natif se referme et la page
    // retourne à l'accueil, comme le 🏠 du lecteur web.
    static void notifyHome() {
        if (instance == null) {
            return;
        }
        instance.notifyListeners("home", new JSObject());
    }

    private List<NativePlayerActivity.Channel> parseChannels(JSArray array) {
        List<NativePlayerActivity.Channel> list = new ArrayList<>();
        if (array == null) {
            return list;
        }
        try {
            List<JSONObject> items = array.toList();
            for (JSONObject item : items) {
                String url = item.optString("url", "");
                if (url.isEmpty()) {
                    continue;
                }
                list.add(new NativePlayerActivity.Channel(
                        item.optString("name", ""), url,
                        item.optString("chno", ""), item.optString("epgKey", ""),
                        item.optString("logo", "")));
            }
        } catch (org.json.JSONException e) {
            // Liste illisible : on repart sans zapping plutôt que d'échouer.
            return new ArrayList<>();
        }
        return list;
    }
}
"""

ACTIVITY_JAVA = """package com.laurent.iptvlecteur;

import android.app.AlertDialog;
import android.app.PictureInPictureParams;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.res.Configuration;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.widget.ImageView;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Rational;
import android.view.View;
import android.view.KeyEvent;
import android.widget.ImageButton;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.mediarouter.app.MediaRouteButton;
import androidx.media3.cast.CastPlayer;
import androidx.media3.cast.SessionAvailabilityListener;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.MimeTypes;
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
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class NativePlayerActivity extends AppCompatActivity {
    private static final long LOAD_TIMEOUT_MS = 20000; // certaines entrées de
    // playlist (séparateurs de catégorie décoratifs, chaînes mortes) ne
    // renvoient jamais d'erreur et resteraient bloquées indéfiniment sans ça.

    // Durée d'affichage du bandeau de chaîne après un zapping, alignée sur
    // celle du bandeau équivalent du lecteur web (showZapBanner).
    private static final long BANNER_MS = 3000;
    // Délai après la dernière touche numérique avant de rejoindre la chaîne :
    // il faut laisser le temps de composer un numéro à deux ou trois chiffres.
    private static final long NUMBER_MS = 1500;
    // Inactivité avant effacement de la barre du haut : même valeur que le
    // lecteur web (UI_IDLE_MS dans www/player.js).
    private static final long UI_IDLE_MS = 4000;

    // L'écran natif remplace complètement le lecteur web le temps de la
    // lecture : sans les commandes ci-dessous, basculer en natif ferait
    // perdre tout ce que la télécommande pilotait dans la page (chaîne +/−,
    // numéro de chaîne, liste des chaînes, enregistrement), la page étant
    // cachée derrière cette activité.
    public static class Channel {
        public final String name;
        public final String url;
        public final String chno;
        public final String epgKey;
        public final String logo;

        public Channel(String name, String url, String chno, String epgKey, String logo) {
            this.name = name;
            this.url = url;
            this.chno = chno;
            this.epgKey = epgKey;
            this.logo = logo;
        }
    }

    // Instance visible du plugin : lui sert à pousser le programme en cours
    // (setInfo) dans le bandeau. Une seule activité de lecture à la fois.
    private static NativePlayerActivity currentInstance;

    static NativePlayerActivity current() {
        return currentInstance;
    }

    private ExoPlayer localPlayer;
    private CastPlayer castPlayer;
    private PlayerView playerView;
    private TextView statusView;
    private TextView titleView;
    private View topBar;
    private ImageButton tracksBtn;
    private ImageButton listBtn;
    private ImageButton recordBtn;
    private ImageButton homeBtn;
    private View banner;
    private ImageView bannerLogo;
    private TextView bannerName;
    private TextView bannerProg;
    private TextView progBar;
    private TextView numberView;
    private final StringBuilder numberBuffer = new StringBuilder();
    // Logos des chaînes : téléchargés une fois puis gardés en mémoire. Le
    // cache est borné — un bouquet entier de logos saturerait la mémoire d'un
    // boîtier TV, et seuls les derniers zappés sont réaffichés.
    private static final int LOGO_CACHE_MAX = 60;
    private static final Map<String, Bitmap> LOGO_CACHE = new HashMap<>();
    private ExecutorService logoExecutor;
    private List<Channel> channels = new ArrayList<>();
    private List<Channel> versions = new ArrayList<>();
    private Set<String> favorites = new HashSet<>();
    private int channelIndex = -1;
    // Un menu ouvert épingle la barre : elle ne doit pas s'effacer sous le
    // dialogue qu'on vient d'ouvrir depuis un de ses boutons.
    private int openDialogs = 0;
    // ExoPlayer ne dit pas si la définition en cours vient de son choix
    // automatique ou d'un forçage manuel : on le retient nous-mêmes pour
    // cocher la bonne ligne du menu.
    private boolean qualiteForcee = false;
    private String mediaUrl;
    private String mediaTitle;
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

    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private final Runnable hideBannerRunnable = new Runnable() {
        @Override
        public void run() {
            fadeOut(banner);
        }
    };
    private final Runnable hideChromeRunnable = new Runnable() {
        @Override
        public void run() {
            hideChrome();
        }
    };
    private final Runnable numberRunnable = new Runnable() {
        @Override
        public void run() {
            String composed = numberBuffer.toString();
            numberBuffer.setLength(0);
            fadeOut(numberView);
            jumpToNumber(composed);
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
        mediaTitle = title == null ? "" : title;
        isLive = getIntent().getBooleanExtra("live", false);

        // Liste de zapping déposée par le plugin (même processus).
        channels = NativePlayerPlugin.channels;
        channelIndex = NativePlayerPlugin.channelIndex;
        versions = NativePlayerPlugin.versions;
        favorites = NativePlayerPlugin.favorites;
        currentInstance = this;

        titleView = findViewById(R.id.playerTitle);
        titleView.setText(title == null ? "" : title);

        topBar = findViewById(R.id.playerTopBar);
        banner = findViewById(R.id.playerBanner);
        bannerName = findViewById(R.id.playerBannerName);
        bannerLogo = findViewById(R.id.playerBannerLogo);
        bannerProg = findViewById(R.id.playerBannerProg);
        logoExecutor = Executors.newSingleThreadExecutor();
        progBar = findViewById(R.id.playerProgBar);
        numberView = findViewById(R.id.playerNumber);

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

        // Liste des chaînes : équivalent natif du panneau « télécommande »
        // du lecteur web, inaccessible tant que cette activité est au premier
        // plan. Touche GUIDE/MENU de la télécommande également.
        listBtn = findViewById(R.id.playerListBtn);
        if (isLive && channels.size() >= 2) {
            listBtn.setVisibility(View.VISIBLE);
            listBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showChannelList();
                }
            });
        } else {
            listBtn.setVisibility(View.GONE);
        }

        // Enregistrement : le service natif (RecordingService) est déjà celui
        // qu'utilise le bouton du lecteur web, on le pilote directement.
        recordBtn = findViewById(R.id.playerRecordBtn);
        if (isLive) {
            recordBtn.setVisibility(View.VISIBLE);
            recordBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    toggleRecording();
                }
            });
            updateRecordButton();
        } else {
            recordBtn.setVisibility(View.GONE);
        }

        // Accueil : referme l'écran natif et ramène la page à l'accueil, comme
        // le bouton 🏠 du lecteur web.
        homeBtn = findViewById(R.id.playerHomeBtn);
        homeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                NativePlayerPlugin.notifyHome();
                finish();
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
        ensureNearbyWifiPermission();
        try {
            CastContext castContext = CastContext.getSharedInstance(this);
            CastButtonFactory.setUpMediaRouteButton(getApplicationContext(), castBtn);
            // Sans ça, androidx.mediarouter masque le bouton tant qu'aucun
            // appareil n'a encore été découvert : impossible de distinguer
            // « pas de TV allumée » de « fonction absente », et impossible
            // d'ouvrir la boîte de dialogue qui relance justement la
            // recherche. On le laisse donc visible en permanence.
            castBtn.setAlwaysVisible(true);
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
        applyFocusEffect(homeBtn, listBtn, recordBtn, tracksBtn, pipBtn, closeBtn, castBtn);
        scheduleHideChrome();
    }

    // Sur une télé, le bouton survolé doit sauter aux yeux de loin : en plus
    // du fond d'accent (bg_player_btn), il grossit légèrement.
    private void applyFocusEffect(View... boutons) {
        View.OnFocusChangeListener listener = new View.OnFocusChangeListener() {
            @Override
            public void onFocusChange(View v, boolean hasFocus) {
                v.animate().cancel();
                v.animate().scaleX(hasFocus ? 1.15f : 1f).scaleY(hasFocus ? 1.15f : 1f)
                        .setDuration(140).setInterpolator(new DecelerateInterpolator()).start();
                if (hasFocus) {
                    showChrome();
                }
            }
        };
        for (View bouton : boutons) {
            if (bouton != null) {
                bouton.setOnFocusChangeListener(listener);
            }
        }
    }

    // Apparitions et disparitions en fondu, comme les transitions CSS du
    // lecteur web (.25s sur .player-top et .zap-banner).
    private void fadeIn(View view) {
        if (view.getVisibility() == View.VISIBLE && view.getAlpha() == 1f) {
            return;
        }
        view.animate().cancel();
        view.setAlpha(view.getVisibility() == View.VISIBLE ? view.getAlpha() : 0f);
        view.setVisibility(View.VISIBLE);
        view.animate().alpha(1f).setDuration(220)
                .setInterpolator(new DecelerateInterpolator()).start();
    }

    private void fadeOut(final View view) {
        if (view.getVisibility() != View.VISIBLE) {
            return;
        }
        view.animate().cancel();
        view.animate().alpha(0f).setDuration(220)
                .setInterpolator(new AccelerateInterpolator())
                .withEndAction(new Runnable() {
                    @Override
                    public void run() {
                        view.setVisibility(View.GONE);
                    }
                }).start();
    }

    // ---------- Masquage auto de la barre du haut ----------
    // Identique au lecteur web : la barre mange le haut de l'image, on
    // l'efface après quelques secondes sans action et on la ramène au moindre
    // geste. Elle reste en place tant qu'un menu est ouvert ou que la
    // télécommande a le focus sur un de ses boutons — sur une télé, le focus
    // doit toujours désigner quelque chose de visible.
    private boolean chromePinned() {
        return openDialogs > 0 || (topBar != null && topBar.findFocus() != null);
    }

    private void hideChrome() {
        if (chromePinned()) {
            scheduleHideChrome();
            return;
        }
        fadeOut(topBar);
    }

    private void scheduleHideChrome() {
        uiHandler.removeCallbacks(hideChromeRunnable);
        uiHandler.postDelayed(hideChromeRunnable, UI_IDLE_MS);
    }

    private void showChrome() {
        if (topBar == null || isInPip()) {
            return;
        }
        fadeIn(topBar);
        scheduleHideChrome();
    }

    private boolean isInPip() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode();
    }

    // Appelée par le système à chaque geste ou touche envoyés à l'activité :
    // un seul point d'entrée pour réveiller la barre.
    @Override
    public void onUserInteraction() {
        super.onUserInteraction();
        showChrome();
    }

    // Les dialogues (pistes, liste des chaînes) épinglent la barre le temps
    // qu'ils sont affichés, puis relancent le compte à rebours.
    private void trackDialog(AlertDialog dialog) {
        openDialogs++;
        uiHandler.removeCallbacks(hideChromeRunnable);
        dialog.setOnDismissListener(new DialogInterface.OnDismissListener() {
            @Override
            public void onDismiss(DialogInterface d) {
                openDialogs--;
                showChrome();
            }
        });
    }

    // Android 13+ : la découverte des Chromecast se fait par mDNS sur le
    // réseau Wi-Fi local, ce que le système considère depuis comme une
    // permission à part entière (NEARBY_WIFI_DEVICES). Sans elle, le Cast SDK
    // ne trouve jamais aucun appareil — et l'utilisateur ne voit qu'un bouton
    // de diffusion qui n'ouvre rien d'utile. Demandée à l'ouverture de
    // l'écran de lecture, pas au démarrage de l'appli : c'est le seul endroit
    // où elle sert, et la demande y est compréhensible.
    private void ensureNearbyWifiPermission() {
        if (android.os.Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(android.Manifest.permission.NEARBY_WIFI_DEVICES)
                == android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[]{ android.Manifest.permission.NEARBY_WIFI_DEVICES }, 4201);
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
            newPlayer.setMediaItem(buildMediaItem(newPlayer == castPlayer), position);
            newPlayer.prepare();
            newPlayer.setPlayWhenReady(playWhenReady);
            timeoutHandler.postDelayed(timeoutRunnable, LOAD_TIMEOUT_MS);
        } else {
            statusView.setText("Lecture impossible : URL manquante.");
            statusView.setVisibility(View.VISIBLE);
        }
    }

    // ExoPlayer devine le format d'après l'URL et le contenu ; CastPlayer, non :
    // Media3 exige un mimeType explicite sur le MediaItem, sinon la diffusion
    // échoue sans rien afficher sur la télé. Et le Chromecast ne sait pas lire
    // du MPEG-TS brut (le format habituel des liens IPTV en direct) : on lui
    // demande donc la variante HLS de la même chaîne, celle que le lecteur web
    // utilise déjà comme repli.
    private MediaItem buildMediaItem(boolean forCast) {
        if (!forCast) {
            return MediaItem.fromUri(mediaUrl);
        }
        String url = castUrl(mediaUrl);
        String mime = castMimeType(url);
        MediaItem.Builder b = new MediaItem.Builder()
                .setUri(url)
                .setMediaMetadata(new MediaMetadata.Builder().setTitle(mediaTitle).build());
        if (mime != null) {
            b.setMimeType(mime);
        }
        return b.build();
    }

    private String castUrl(String url) {
        String sansQuery = url;
        int coupe = sansQuery.indexOf('?');
        String query = "";
        if (coupe >= 0) {
            query = sansQuery.substring(coupe);
            sansQuery = sansQuery.substring(0, coupe);
        }
        String bas = sansQuery.toLowerCase();
        if (bas.endsWith(".m3u8") || bas.endsWith(".mpd") || bas.endsWith(".mp4") || bas.endsWith(".webm")) {
            return url;
        }
        // .ts, .mkv ou pas d'extension du tout (Xtream sert souvent le direct
        // sans suffixe) : le même flux existe presque toujours en .m3u8.
        int point = sansQuery.lastIndexOf('.');
        int slash = sansQuery.lastIndexOf('/');
        String base = (point > slash) ? sansQuery.substring(0, point) : sansQuery;
        return base + ".m3u8" + query;
    }

    private String castMimeType(String url) {
        String bas = url.toLowerCase();
        if (bas.contains(".m3u8")) return MimeTypes.APPLICATION_M3U8;
        if (bas.contains(".mpd")) return MimeTypes.APPLICATION_MPD;
        if (bas.contains(".webm")) return MimeTypes.VIDEO_WEBM;
        return MimeTypes.VIDEO_MP4;
    }

    // ---------- Commandes de la télécommande ----------
    // Les touches CHAÎNE +/− ne parviennent jamais à une WebView (le système
    // les réserve au tuner de la télé, cf. ci/patch_tv_keys.py) mais une
    // activité les reçoit dans dispatchKeyEvent avant tout le monde : le
    // zapping est donc traité ici, directement sur la liste transmise par la
    // page. Les flèches haut/bas ne servent au zapping que si les contrôles
    // de lecture sont masqués, sinon elles doivent rester à la navigation
    // entre les boutons de l'écran.
    private static boolean isZapUp(int code) {
        return code == KeyEvent.KEYCODE_CHANNEL_UP || code == KeyEvent.KEYCODE_PAGE_UP
                || code == KeyEvent.KEYCODE_MEDIA_NEXT;
    }

    private static boolean isZapDown(int code) {
        return code == KeyEvent.KEYCODE_CHANNEL_DOWN || code == KeyEvent.KEYCODE_PAGE_DOWN
                || code == KeyEvent.KEYCODE_MEDIA_PREVIOUS;
    }

    private static boolean isDigit(int code) {
        return code >= KeyEvent.KEYCODE_0 && code <= KeyEvent.KEYCODE_9;
    }

    private static boolean isMenuKey(int code) {
        return code == KeyEvent.KEYCODE_GUIDE || code == KeyEvent.KEYCODE_MENU
                || code == KeyEvent.KEYCODE_TV_CONTENTS_MENU;
    }

    private boolean canZap() {
        return isLive && channels.size() >= 2;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        // onUserInteraction() n'est pas appelée pour les touches qu'on
        // consomme ici : on réveille donc la barre explicitement.
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            showChrome();
        }
        boolean mine;
        if (canZap() && (isZapUp(code) || isZapDown(code))) {
            mine = true;
        } else if (canZap() && (code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN)
                && playerView != null && !playerView.isControllerFullyVisible()) {
            mine = true;
        } else if (isDigit(code) && canZap()) {
            mine = true;
        } else {
            mine = isMenuKey(code) && channels.size() >= 2 && isLive;
        }
        if (!mine) {
            return super.dispatchKeyEvent(event);
        }
        // Le relâchement est consommé lui aussi : sinon le système rendrait la
        // touche au tuner du téléviseur, ou provoquerait un second saut.
        if (event.getAction() != KeyEvent.ACTION_DOWN) {
            return true;
        }
        if (isDigit(code)) {
            pushDigit(code - KeyEvent.KEYCODE_0);
        } else if (isMenuKey(code)) {
            showChannelList();
        } else {
            zap(isZapUp(code) || code == KeyEvent.KEYCODE_DPAD_UP ? 1 : -1);
        }
        return true;
    }

    private void zap(int delta) {
        int size = channels.size();
        if (size < 2) {
            return;
        }
        // Chaîne ouverte hors bouquet (favoris, guide, recherche) : la page
        // envoie index = −1, on entre alors dans la liste par un bout, comme
        // le fait zapStep() côté web.
        int next = channelIndex < 0
                ? (delta > 0 ? 0 : size - 1)
                : ((channelIndex + delta) % size + size) % size;
        playChannel(next);
    }

    private void playUrl(String url, String title) {
        qualiteForcee = false;
        mediaUrl = url;
        mediaTitle = title == null ? "" : title;
        titleView.setText(mediaTitle);
        statusView.setVisibility(View.GONE);

        Player player = playerView.getPlayer();
        if (player != null) {
            player.setMediaItem(buildMediaItem(player == castPlayer));
            player.prepare();
            player.setPlayWhenReady(true);
            timeoutHandler.removeCallbacks(timeoutRunnable);
            timeoutHandler.postDelayed(timeoutRunnable, LOAD_TIMEOUT_MS);
        }
        updateRecordButton();
    }

    private void playChannel(int index) {
        if (index < 0 || index >= channels.size()) {
            return;
        }
        Channel channel = channels.get(index);
        channelIndex = index;
        NativePlayerPlugin.channelIndex = index;
        playUrl(channel.url, channel.name);
        showBanner(channel);
        NativePlayerPlugin.notifyZap(index, channel.url, mediaTitle);
    }

    private String channelLabel(Channel channel) {
        String name = channel.name == null ? "" : channel.name;
        return (channel.chno == null || channel.chno.isEmpty()) ? name : channel.chno + "  " + name;
    }

    private void showBanner(Channel channel) {
        bannerName.setText(channelLabel(channel));
        // Le programme en cours arrive juste après, poussé par la page
        // (NativePlayerPlugin.setInfo) : l'EPG n'existe que côté web.
        bannerProg.setText("");
        bannerProg.setVisibility(View.GONE);
        showLogo(channel.logo);
        fadeIn(banner);
        uiHandler.removeCallbacks(hideBannerRunnable);
        uiHandler.postDelayed(hideBannerRunnable, BANNER_MS);
    }

    // Logo de la chaîne, comme dans le bandeau du lecteur web. Téléchargé une
    // seule fois par chaîne (cache mémoire), sur un fil à part : le bandeau
    // s'affiche immédiatement, le logo se pose ensuite s'il arrive.
    private void showLogo(final String url) {
        bannerLogo.setVisibility(View.GONE);
        bannerLogo.setImageDrawable(null);
        if (url == null || url.isEmpty() || logoExecutor == null) {
            return;
        }
        bannerLogo.setTag(url);
        Bitmap cached;
        synchronized (LOGO_CACHE) {
            cached = LOGO_CACHE.get(url);
        }
        if (cached != null) {
            bannerLogo.setImageBitmap(cached);
            bannerLogo.setVisibility(View.VISIBLE);
            return;
        }
        logoExecutor.execute(new Runnable() {
            @Override
            public void run() {
                final Bitmap bitmap = downloadLogo(url);
                if (bitmap == null) {
                    return;
                }
                synchronized (LOGO_CACHE) {
                    if (LOGO_CACHE.size() >= LOGO_CACHE_MAX) {
                        LOGO_CACHE.clear();
                    }
                    LOGO_CACHE.put(url, bitmap);
                }
                uiHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        // La chaîne a pu changer entre-temps (zapping rapide).
                        if (url.equals(bannerLogo.getTag())) {
                            bannerLogo.setImageBitmap(bitmap);
                            fadeIn(bannerLogo);
                        }
                    }
                });
            }
        });
    }

    private Bitmap downloadLogo(String url) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            connection.setInstanceFollowRedirects(true);
            InputStream stream = connection.getInputStream();
            // inSampleSize : un logo de chaîne fait 28dp à l'écran, inutile de
            // garder une image de 500 px en mémoire.
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = 2;
            Bitmap bitmap = BitmapFactory.decodeStream(stream, null, options);
            stream.close();
            return bitmap;
        } catch (Exception e) {
            // Logo absent ou serveur muet : le bandeau se passe d'image.
            return null;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    // Deux affichages, comme côté web : le bandeau de zapping (temporaire) et
    // le bandeau du bas (permanent tant que la chaîne joue, rafraîchi par la
    // page puisque le programme change tout seul au fil du temps).
    void setProgramInfo(String text) {
        if (bannerProg == null) {
            return;
        }
        boolean vide = text == null || text.isEmpty();
        progBar.setText(vide ? "" : text);
        if (vide) {
            fadeOut(progBar);
            bannerProg.setVisibility(View.GONE);
            return;
        }
        fadeIn(progBar);
        bannerProg.setText(text);
        bannerProg.setVisibility(View.VISIBLE);
        fadeIn(banner);
        uiHandler.removeCallbacks(hideBannerRunnable);
        uiHandler.postDelayed(hideBannerRunnable, BANNER_MS);
    }

    // Numéro de chaîne composé au pavé numérique de la télécommande, comme
    // sur un décodeur : les chiffres s'accumulent, le saut a lieu après une
    // courte pause.
    private void pushDigit(int digit) {
        if (numberBuffer.length() >= 4) {
            numberBuffer.setLength(0);
        }
        numberBuffer.append(digit);
        numberView.setText(numberBuffer.toString());
        fadeIn(numberView);
        uiHandler.removeCallbacks(numberRunnable);
        uiHandler.postDelayed(numberRunnable, NUMBER_MS);
    }

    private static String normalizeNumber(String value) {
        int i = 0;
        while (i < value.length() - 1 && value.charAt(i) == '0') {
            i++;
        }
        return value.substring(i);
    }

    private void jumpToNumber(String composed) {
        if (composed.isEmpty()) {
            return;
        }
        String wanted = normalizeNumber(composed);
        for (int i = 0; i < channels.size(); i++) {
            String chno = channels.get(i).chno;
            if (chno != null && !chno.isEmpty() && normalizeNumber(chno).equals(wanted)) {
                playChannel(i);
                return;
            }
        }
        Toast.makeText(this, "Aucune chaîne n° " + wanted, Toast.LENGTH_SHORT).show();
    }

    private void showChannelList() {
        if (channels.isEmpty()) {
            return;
        }
        String[] labels = new String[channels.size()];
        for (int i = 0; i < channels.size(); i++) {
            Channel channel = channels.get(i);
            // Favoris repérés d'une étoile, comme dans le panneau
            // « télécommande » du lecteur web.
            labels[i] = (favorites.contains(channel.url) ? "⭐ " : "") + channelLabel(channel);
        }
        // setSingleChoiceItems plutôt que setItems : la liste s'ouvre
        // directement sur la chaîne en cours (et le D-pad démarre dessus),
        // indispensable dans un bouquet de plusieurs centaines d'entrées.
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Chaînes")
                .setSingleChoiceItems(labels, channelIndex, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        d.dismiss();
                        playChannel(which);
                    }
                })
                .create();
        trackDialog(dialog);
        dialog.show();
    }

    // ---------- Enregistrement ----------
    // Même service que le bouton du lecteur web (voir ci/patch_recorder.py) :
    // il tourne en avant-plan et survit à la fermeture de cet écran.
    private void toggleRecording() {
        if (RecordingService.isRunning()) {
            Intent stop = new Intent(this, RecordingService.class);
            stop.setAction(RecordingService.ACTION_STOP);
            startService(stop);
            Toast.makeText(this, "Enregistrement arrêté", Toast.LENGTH_SHORT).show();
        } else if (mediaUrl != null && !mediaUrl.isEmpty()) {
            Intent start = new Intent(this, RecordingService.class);
            start.setAction(RecordingService.ACTION_START);
            start.putExtra("id", UUID.randomUUID().toString());
            start.putExtra("url", mediaUrl);
            start.putExtra("title", mediaTitle.isEmpty() ? "Enregistrement" : mediaTitle);
            start.putExtra("channelKey", "");
            // Même garde-fou que côté web : 4 h maximum pour un enregistrement
            // lancé à la volée, sinon un oubli remplit le stockage.
            start.putExtra("endAtMs", System.currentTimeMillis() + 4L * 60L * 60L * 1000L);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(start);
            } else {
                startService(start);
            }
            Toast.makeText(this, "Enregistrement démarré", Toast.LENGTH_SHORT).show();
        }
        updateRecordButton();
    }

    private void updateRecordButton() {
        if (recordBtn == null || recordBtn.getVisibility() != View.VISIBLE) {
            return;
        }
        // Pas de second jeu d'icônes : l'enregistrement en cours se voit à la
        // pastille pleinement opaque, à l'arrêt elle est estompée.
        recordBtn.setAlpha(RecordingService.isRunning() ? 1f : 0.55f);
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
        playerView.setUseController(!isInPictureInPictureMode);
        if (isInPictureInPictureMode) {
            // Quelques centimètres carrés : tout l'habillage masquerait l'image.
            uiHandler.removeCallbacks(hideChromeRunnable);
            topBar.setVisibility(View.GONE);
            banner.setVisibility(View.GONE);
            numberView.setVisibility(View.GONE);
            progBar.setVisibility(View.GONE);
        } else {
            showChrome();
        }
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

        // Sources : autres versions du même contenu (menu « Sources » du
        // lecteur web) — changer de source se fait sur place, sans repasser
        // par la page.
        for (int i = 0; i < versions.size(); i++) {
            final Channel version = versions.get(i);
            boolean courante = version.url.equals(mediaUrl);
            labels.add("🎬 Source : " + version.name + (courante ? " ✓" : ""));
            actions.add(new Runnable() {
                @Override
                public void run() {
                    playUrl(version.url, version.name);
                }
            });
        }

        // Qualité : forçage manuel d'une définition, en plus de la sélection
        // automatique d'ExoPlayer — même usage que le menu « Qualité » du web
        // (image figée sur une connexion limitée, ou définition trop basse
        // alors que le débit suit).
        labels.add("🎚 Qualité : automatique" + (qualiteForcee ? "" : " ✓"));
        actions.add(new Runnable() {
            @Override
            public void run() {
                qualiteForcee = false;
                localPlayer.setTrackSelectionParameters(
                        localPlayer.getTrackSelectionParameters().buildUpon()
                                .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
                                .build());
            }
        });

        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != C.TRACK_TYPE_VIDEO) {
                continue;
            }
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSupported(i)) {
                    continue;
                }
                Format format = group.getTrackFormat(i);
                String name = format.height > 0
                        ? format.height + "p"
                        : (format.bitrate > 0 ? (format.bitrate / 1000) + " kb/s" : "Piste " + (i + 1));
                boolean selected = qualiteForcee && group.isTrackSelected(i);
                labels.add("🎚 Qualité : " + name + (selected ? " ✓" : ""));
                final TrackGroup mediaTrackGroup = group.getMediaTrackGroup();
                final int trackIndex = i;
                actions.add(new Runnable() {
                    @Override
                    public void run() {
                        qualiteForcee = true;
                        localPlayer.setTrackSelectionParameters(
                                localPlayer.getTrackSelectionParameters().buildUpon()
                                        .setOverrideForType(new TrackSelectionOverride(mediaTrackGroup, trackIndex))
                                        .build());
                    }
                });
            }
        }

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

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Source, qualité, langue et sous-titres")
                .setItems(labels.toArray(new String[0]), new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        actions.get(which).run();
                    }
                })
                .create();
        trackDialog(dialog);
        dialog.show();
    }

    @Override
    protected void onDestroy() {
        if (currentInstance == this) {
            currentInstance = null;
            NativePlayerPlugin.notifyClosed();
        }
        if (logoExecutor != null) {
            logoExecutor.shutdownNow();
            logoExecutor = null;
        }
        uiHandler.removeCallbacks(hideChromeRunnable);
        uiHandler.removeCallbacks(hideBannerRunnable);
        uiHandler.removeCallbacks(numberRunnable);
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
<!-- Habillage repris à l'identique du lecteur web (.player-top, .zap-banner,
     .prog-bar, .player-status dans www/styles.css) : passer sur le lecteur
     natif ne doit pas donner l'impression de changer d'application. Mêmes
     couleurs (#0A1018 à 85 %, trait #223447, accent #3FC7C7), mêmes tailles
     et mêmes emplacements. -->
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
        android:background="@drawable/bg_player_scrim_top"
        android:paddingStart="16dp"
        android:paddingEnd="16dp"
        android:paddingTop="10dp"
        android:paddingBottom="18dp">

        <TextView
            android:id="@+id/playerTitle"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:textColor="#FFFFFF"
            android:textSize="14sp"
            android:textStyle="bold"
            android:maxLines="1"
            android:ellipsize="end" />

        <androidx.mediarouter.app.MediaRouteButton
            android:id="@+id/playerCastBtn"
            android:layout_width="34dp"
            android:layout_height="34dp"
            android:layout_marginStart="10dp"
            android:background="@drawable/bg_player_btn"
            android:contentDescription="Diffuser sur une TV" />

        <ImageButton
            android:id="@+id/playerListBtn"
            android:layout_width="34dp"
            android:layout_height="34dp"
            android:layout_marginStart="10dp"
            android:padding="6dp"
            android:scaleType="fitCenter"
            android:background="@drawable/bg_player_btn"
            android:src="@drawable/ic_channels"
            android:contentDescription="Liste des chaînes"
            android:visibility="gone" />

        <ImageButton
            android:id="@+id/playerRecordBtn"
            android:layout_width="34dp"
            android:layout_height="34dp"
            android:layout_marginStart="10dp"
            android:padding="6dp"
            android:scaleType="fitCenter"
            android:background="@drawable/bg_player_btn"
            android:src="@drawable/ic_record"
            android:contentDescription="Enregistrer"
            android:visibility="gone" />

        <ImageButton
            android:id="@+id/playerPipBtn"
            android:layout_width="34dp"
            android:layout_height="34dp"
            android:layout_marginStart="10dp"
            android:padding="6dp"
            android:scaleType="fitCenter"
            android:background="@drawable/bg_player_btn"
            android:src="@drawable/ic_pip"
            android:contentDescription="Picture-in-Picture"
            android:visibility="gone" />

        <ImageButton
            android:id="@+id/playerTracksBtn"
            android:layout_width="34dp"
            android:layout_height="34dp"
            android:layout_marginStart="10dp"
            android:padding="6dp"
            android:scaleType="fitCenter"
            android:background="@drawable/bg_player_btn"
            android:src="@drawable/ic_tracks"
            android:contentDescription="Langue et sous-titres" />

        <ImageButton
            android:id="@+id/playerHomeBtn"
            android:layout_width="34dp"
            android:layout_height="34dp"
            android:layout_marginStart="10dp"
            android:padding="6dp"
            android:scaleType="fitCenter"
            android:background="@drawable/bg_player_btn"
            android:src="@drawable/ic_home"
            android:contentDescription="Accueil" />

        <ImageButton
            android:id="@+id/playerCloseBtn"
            android:layout_width="34dp"
            android:layout_height="34dp"
            android:layout_marginStart="10dp"
            android:padding="7dp"
            android:scaleType="fitCenter"
            android:background="@drawable/bg_player_btn"
            android:src="@drawable/ic_close"
            android:contentDescription="Fermer" />
    </LinearLayout>

    <!-- Bandeau de zapping : même position que celui du web (sous la barre,
         à gauche), affiché quelques secondes à chaque prise d'antenne. -->
    <LinearLayout
        android:id="@+id/playerBanner"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_below="@id/playerTopBar"
        android:layout_alignParentStart="true"
        android:layout_marginStart="16dp"
        android:layout_marginEnd="16dp"
        android:orientation="horizontal"
        android:gravity="center_vertical"
        android:background="@drawable/bg_player_card"
        android:elevation="8dp"
        android:paddingStart="12dp"
        android:paddingEnd="16dp"
        android:paddingTop="10dp"
        android:paddingBottom="10dp"
        android:visibility="gone">

        <ImageView
            android:id="@+id/playerBannerLogo"
            android:layout_width="34dp"
            android:layout_height="34dp"
            android:layout_marginEnd="12dp"
            android:scaleType="fitCenter"
            android:contentDescription="@null"
            android:visibility="gone" />

        <LinearLayout
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:orientation="vertical">

            <TextView
                android:id="@+id/playerBannerName"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:textColor="#FFFFFF"
                android:textSize="15sp"
                android:textStyle="bold"
                android:maxLines="1"
                android:ellipsize="end" />

            <TextView
                android:id="@+id/playerBannerProg"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="2dp"
                android:textColor="#92A5BA"
                android:textSize="12sp"
                android:maxLines="1"
                android:ellipsize="end"
                android:visibility="gone" />
        </LinearLayout>
    </LinearLayout>

    <!-- Numéro de chaîne en cours de composition (pavé numérique de la
         télécommande) : même carte que le bandeau. -->
    <TextView
        android:id="@+id/playerNumber"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_below="@id/playerTopBar"
        android:layout_alignParentEnd="true"
        android:layout_marginEnd="16dp"
        android:background="@drawable/bg_player_card"
        android:elevation="8dp"
        android:paddingStart="20dp"
        android:paddingEnd="20dp"
        android:paddingTop="10dp"
        android:paddingBottom="10dp"
        android:textColor="#FFFFFF"
        android:textSize="30sp"
        android:textStyle="bold"
        android:fontFamily="monospace"
        android:letterSpacing="0.08"
        android:visibility="gone" />

    <!-- Bandeau permanent du programme en cours, comme .prog-bar côté web. -->
    <TextView
        android:id="@+id/playerProgBar"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_alignParentBottom="true"
        android:background="@drawable/bg_player_scrim_bottom"
        android:paddingStart="16dp"
        android:paddingEnd="16dp"
        android:paddingTop="18dp"
        android:paddingBottom="10dp"
        android:textColor="#FFFFFF"
        android:textSize="12sp"
        android:textAlignment="center"
        android:maxLines="1"
        android:ellipsize="end"
        android:visibility="gone" />

    <TextView
        android:id="@+id/playerStatusText"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_centerInParent="true"
        android:layout_marginStart="24dp"
        android:layout_marginEnd="24dp"
        android:background="@drawable/bg_player_card"
        android:elevation="8dp"
        android:textColor="#FFB454"
        android:textSize="13sp"
        android:textAlignment="center"
        android:paddingStart="20dp"
        android:paddingEnd="20dp"
        android:paddingTop="14dp"
        android:paddingBottom="14dp"
        android:visibility="gone" />

</RelativeLayout>
"""

# Voiles dégradés derrière la barre du haut et le bandeau du bas : le texte
# reste lisible sur une image claire sans poser un bandeau opaque en travers
# de la vidéo, comme le font les lecteurs vidéo courants.
SCRIM_TOP_XML = """<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <gradient
        android:startColor="#E60A1018"
        android:centerColor="#800A1018"
        android:endColor="#000A1018"
        android:angle="270" />
</shape>
"""

SCRIM_BOTTOM_XML = """<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <gradient
        android:startColor="#E60A1018"
        android:centerColor="#800A1018"
        android:endColor="#000A1018"
        android:angle="90" />
</shape>
"""

# Fond des boutons de la barre : pastille arrondie translucide comme
# .player-cast côté web, et teinte d'accent quand la télécommande s'y pose
# (état « focus » — sans lui, impossible de voir où on est sur une télé).
BTN_BG_XML = """<?xml version="1.0" encoding="utf-8"?>
<selector xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:state_focused="true">
        <shape android:shape="rectangle">
            <corners android:radius="8dp" />
            <solid android:color="#3FC7C7" />
        </shape>
    </item>
    <item android:state_pressed="true">
        <shape android:shape="rectangle">
            <corners android:radius="8dp" />
            <solid android:color="#3FC7C7" />
        </shape>
    </item>
    <item>
        <shape android:shape="rectangle">
            <corners android:radius="8dp" />
            <solid android:color="#1FFFFFFF" />
        </shape>
    </item>
</selector>
"""

# Carte du bandeau / du numéro composé : mêmes fond, trait et rayon que
# .zap-banner côté web.
CARD_BG_XML = """<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <corners android:radius="12dp" />
    <solid android:color="#E00A1018" />
    <stroke android:width="1dp" android:color="#223447" />
</shape>
"""

# Icône « home » — Google Material Icons (Apache License 2.0).
IC_HOME_XML = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="#FFFFFF">
    <path
        android:fillColor="#FF000000"
        android:pathData="M10,20v-6h4v6h5v-8h3L12,3 2,12h3v8z" />
</vector>
"""

# Icône « close » — Google Material Icons (Apache License 2.0). Remplace
# l'icône système, dont le style (contour gris) jure avec le reste.
IC_CLOSE_XML = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="#FFFFFF">
    <path
        android:fillColor="#FF000000"
        android:pathData="M19,6.41L17.59,5 12,10.59 6.41,5 5,6.41 10.59,12 5,17.59 6.41,19 12,13.41 17.59,19 19,17.59 13.41,12z" />
</vector>
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

# Icône « format_list_bulleted » — Google Material Icons (Apache License 2.0).
IC_CHANNELS_XML = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="#FFFFFF">
    <path
        android:fillColor="#FF000000"
        android:pathData="M4,10.5c-0.83,0 -1.5,0.67 -1.5,1.5s0.67,1.5 1.5,1.5 1.5,-0.67 1.5,-1.5 -0.67,-1.5 -1.5,-1.5zM4,4.5c-0.83,0 -1.5,0.67 -1.5,1.5S3.17,7.5 4,7.5 5.5,6.83 5.5,6 4.83,4.5 4,4.5zM4,16.5c-0.83,0 -1.5,0.68 -1.5,1.5s0.68,1.5 1.5,1.5 1.5,-0.68 1.5,-1.5 -0.67,-1.5 -1.5,-1.5zM7,19h14v-2L7,17v2zM7,13h14v-2L7,11v2zM7,5v2h14L21,5L7,5z" />
</vector>
"""

# Icône « fiber_manual_record » (pastille d'enregistrement) — Google Material
# Icons (Apache License 2.0). Rouge plutôt que blanche : même code couleur que
# le bouton ⏺ du lecteur web.
IC_RECORD_XML = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="#FF5C5C">
    <path
        android:fillColor="#FF000000"
        android:pathData="M12,2C6.48,2 2,6.48 2,12s4.48,10 10,10 10,-4.48 10,-10S17.52,2 12,2z" />
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


def patch_manifest_permissions():
    """Permissions nécessaires à la découverte des Chromecast (mDNS local)."""
    p = "android/app/src/main/AndroidManifest.xml"
    s = open(p).read()
    perms = [
        ('android.permission.ACCESS_WIFI_STATE', ''),
        ('android.permission.CHANGE_WIFI_MULTICAST_STATE', ''),
        # neverForLocation : on cherche des télés, pas la position de
        # l'utilisateur — sans ce drapeau, Android exige en plus la
        # localisation précise.
        ('android.permission.NEARBY_WIFI_DEVICES', ' android:usesPermissionFlags="neverForLocation"'),
    ]
    added = False
    for perm, extra in perms:
        if perm in s:
            continue
        s = s.replace(
            '<uses-permission android:name="android.permission.INTERNET" />',
            '<uses-permission android:name="android.permission.INTERNET" />\n'
            '    <uses-permission android:name="%s"%s />' % (perm, extra),
            1,
        )
        added = True
    if added:
        open(p, "w").write(s)
        print("AndroidManifest.xml : permissions de découverte Cast ajoutées")
    else:
        print("AndroidManifest.xml : permissions de découverte Cast déjà présentes")


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
        "        applyImmersiveForOrientation(getResources().getConfiguration().orientation);\n"
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
        "\n"
        "    @Override\n"
        "    public void onConfigurationChanged(android.content.res.Configuration newConfig) {\n"
        "        super.onConfigurationChanged(newConfig);\n"
        "        applyImmersiveForOrientation(newConfig.orientation);\n"
        "    }\n"
        "\n"
        "    // Plein écran vidéo (verrouillage paysage ci-dessus) : masque aussi la\n"
        "    // barre de statut et la barre de navigation Android en paysage — sans\n"
        "    // ça, seule l'orientation change : la vidéo ne prend pas tout l'écran\n"
        "    // et les boutons système restent visibles par-dessus (bandeau noir\n"
        "    // avec les icônes retour/accueil/récents à côté de la vidéo). Ré-\n"
        "    // appliqué à chaque changement d'orientation plutôt que déclenché\n"
        "    // depuis le JS : suit directement l'état réel de l'activité, sans\n"
        "    // aller-retour supplémentaire par le pont Capacitor. Un balayage\n"
        "    // depuis le bord fait réapparaître les barres temporairement\n"
        "    // (BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE), pour ne pas coincer\n"
        "    // l'utilisateur sans accès aux boutons système.\n"
        "    private void applyImmersiveForOrientation(int orientation) {\n"
        "        android.view.Window window = getWindow();\n"
        "        androidx.core.view.WindowInsetsControllerCompat controller =\n"
        "                androidx.core.view.WindowCompat.getInsetsController(window, window.getDecorView());\n"
        "        if (orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE) {\n"
        "            androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false);\n"
        "            controller.setSystemBarsBehavior(androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);\n"
        "            controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars());\n"
        "        } else {\n"
        "            androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, true);\n"
        "            controller.show(androidx.core.view.WindowInsetsCompat.Type.systemBars());\n"
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
write_if_changed(RES_DIR + "/drawable/ic_channels.xml", IC_CHANNELS_XML)
write_if_changed(RES_DIR + "/drawable/ic_record.xml", IC_RECORD_XML)
write_if_changed(RES_DIR + "/drawable/ic_close.xml", IC_CLOSE_XML)
write_if_changed(RES_DIR + "/drawable/ic_home.xml", IC_HOME_XML)
write_if_changed(RES_DIR + "/drawable/bg_player_btn.xml", BTN_BG_XML)
write_if_changed(RES_DIR + "/drawable/bg_player_card.xml", CARD_BG_XML)
write_if_changed(RES_DIR + "/drawable/bg_player_scrim_top.xml", SCRIM_TOP_XML)
write_if_changed(RES_DIR + "/drawable/bg_player_scrim_bottom.xml", SCRIM_BOTTOM_XML)
patch_settings_gradle()
patch_build_gradle()
patch_manifest()
patch_manifest_permissions()
patch_main_activity()

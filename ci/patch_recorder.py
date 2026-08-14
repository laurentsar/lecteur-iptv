#!/usr/bin/env python3
"""Injecte un enregistreur (DVR) natif dans android/ (régénéré à chaque
build par `cap add android`, donc ce script tourne à chaque fois).

Pourquoi natif : enregistrer un flux IPTV — capturer les octets d'un flux
réseau vers un fichier pendant potentiellement des heures — doit continuer à
tourner même appli fermée. Rien de fiable n'existe pour ça côté WebView/PWA
(un Service Worker n'a aucune garantie d'exécution prolongée en arrière-plan
et se fait tuer par le système), donc ceci est exclusivement APK Android, via
un Service Android en avant-plan (notification permanente obligatoire —
c'est la seule façon légitime pour Android d'autoriser une appli à tourner
longtemps en arrière-plan).

Deux façons de démarrer un enregistrement :
- immédiat : bouton dans le lecteur, RecorderPlugin.startRecording() lance
  directement RecordingService ;
- programmé : choix d'une émission à venir dans le Guide,
  RecorderPlugin.scheduleRecording() arme une alarme (AlarmManager) qui,
  via RecordingScheduleReceiver, démarre RecordingService à l'heure prévue —
  y compris appli fermée. RecordingBootReceiver réarme les alarmes après un
  redémarrage du téléphone (AlarmManager les perd au reboot).

Capture : pas de remuxage/transcodage (trop lourd à faire soi-même en Java).
Pour un flux HLS (.m3u8), le service récupère répétitivement la playlist
(liste de segments .ts, qui glisse en direct), télécharge chaque nouveau
segment et l'ajoute tel quel au fichier de sortie — des segments mpeg-ts
concaténés dans l'ordre restent un flux mpeg-ts valide, pas besoin de
remuxer. Pour un flux brut (pas de .m3u8, cas fréquent chez Xtream Codes),
le service copie directement les octets reçus. Le fichier obtenu (.ts) est
ensuite lu comme n'importe quel item par player.js (moteur mpeg-ts déjà
vendorisé, ou repli automatique vers le lecteur natif ExoPlayer, qui décode
le mpeg-ts nativement).

Limite assumée et documentée (Infos, README) : Android peut malgré tout
arrêter le service sur certains téléphones (gestion de batterie agressive
de certains constructeurs — Xiaomi/Huawei/Samsung...) sauf si l'app est
mise en exception manuellement dans les réglages ; ni ce script ni aucun
code ne peut le garantir à 100 %.
"""
import os
import re

PKG_DIR = "android/app/src/main/java/com/laurent/iptvlecteur"

PLUGIN_JAVA = """package com.laurent.iptvlecteur;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(
        name = "Recorder",
        permissions = {
                @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
        }
)
public class RecorderPlugin extends Plugin {

    @PluginMethod
    public void startRecording(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "startAfterPermission");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void startAfterPermission(PluginCall call) {
        // On enregistre même si la permission de notification est refusée :
        // le service tourne quand même, seule la notification (obligatoire
        // pour un service en avant-plan) risque de ne pas s'afficher.
        doStart(call);
    }

    private void doStart(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "Enregistrement");
        String channelKey = call.getString("channelKey", "");
        Double maxDurationMs = call.getDouble("maxDurationMs");
        if (url == null || url.isEmpty()) {
            call.reject("url manquante");
            return;
        }
        String id = UUID.randomUUID().toString();
        long endAtMs = (maxDurationMs != null && maxDurationMs > 0)
                ? System.currentTimeMillis() + maxDurationMs.longValue() : -1;
        Intent intent = new Intent(getContext(), RecordingService.class);
        intent.setAction(RecordingService.ACTION_START);
        intent.putExtra("id", id);
        intent.putExtra("url", url);
        intent.putExtra("title", title);
        intent.putExtra("channelKey", channelKey);
        intent.putExtra("endAtMs", endAtMs);
        startForegroundServiceCompat(intent);
        JSObject ret = new JSObject();
        ret.put("id", id);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        Intent intent = new Intent(getContext(), RecordingService.class);
        intent.setAction(RecordingService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void isRecording(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("recording", RecordingService.isRunning());
        ret.put("title", RecordingService.currentTitle());
        call.resolve(ret);
    }

    @PluginMethod
    public void scheduleRecording(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "Enregistrement");
        String channelKey = call.getString("channelKey", "");
        Double startAtMs = call.getDouble("startAtMs");
        Double endAtMs = call.getDouble("endAtMs");
        if (url == null || startAtMs == null || endAtMs == null) {
            call.reject("paramètres manquants (url, startAtMs, endAtMs)");
            return;
        }
        String id = UUID.randomUUID().toString();
        try {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("url", url);
            o.put("title", title);
            o.put("channelKey", channelKey);
            o.put("startAtMs", startAtMs.longValue());
            o.put("endAtMs", endAtMs.longValue());
            Recordings.addScheduled(getContext(), o);
            armAlarm(getContext(), id, startAtMs.longValue());
            JSObject ret = new JSObject();
            ret.put("id", id);
            call.resolve(ret);
        } catch (JSONException e) {
            call.reject("Échec de la programmation : " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancelScheduled(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("id manquant");
            return;
        }
        Recordings.removeScheduled(getContext(), id);
        disarmAlarm(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void listScheduled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("items", toJSArray(Recordings.getScheduled(getContext())));
        call.resolve(ret);
    }

    @PluginMethod
    public void listRecordings(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("items", toJSArray(Recordings.getRecordings(getContext())));
        call.resolve(ret);
    }

    @PluginMethod
    public void deleteRecording(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("id manquant");
            return;
        }
        JSONArray arr = Recordings.getRecordings(getContext());
        for (int i = 0; i < arr.length(); i++) {
            try {
                JSONObject o = arr.getJSONObject(i);
                if (id.equals(o.optString("id")) && o.has("filePath")) {
                    new File(o.getString("filePath")).delete();
                }
            } catch (JSONException ignored) {
                // entrée corrompue : on l'ignore, elle sera de toute façon retirée ci-dessous
            }
        }
        Recordings.removeRecording(getContext(), id);
        call.resolve();
    }

    private static JSArray toJSArray(JSONArray src) {
        JSArray out = new JSArray();
        for (int i = 0; i < src.length(); i++) {
            try {
                out.put(src.get(i));
            } catch (JSONException ignored) {
                // entrée corrompue : on la saute plutôt que de faire échouer tout l'appel
            }
        }
        return out;
    }

    static void armAlarm(Context ctx, String id, long startAtMs) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) {
            return;
        }
        Intent intent = new Intent(ctx, RecordingScheduleReceiver.class);
        intent.putExtra("id", id);
        PendingIntent pending = PendingIntent.getBroadcast(ctx, id.hashCode(), intent, pendingIntentFlags());
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, startAtMs, pending);
    }

    static void disarmAlarm(Context ctx, String id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) {
            return;
        }
        Intent intent = new Intent(ctx, RecordingScheduleReceiver.class);
        PendingIntent pending = PendingIntent.getBroadcast(ctx, id.hashCode(), intent, pendingIntentFlags());
        am.cancel(pending);
    }

    static int pendingIntentFlags() {
        return PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
    }

    private void startForegroundServiceCompat(Intent intent) {
        if (Build.VERSION.SDK_INT >= 26) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
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
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/** Service en avant-plan : capture un flux réseau vers un fichier local,
 * pendant potentiellement des heures, y compris appli fermée. Notification
 * permanente obligatoire (contrainte Android pour tout service en
 * avant-plan) — voir RecorderPlugin pour le détail de l'approche. */
public class RecordingService extends Service {
    public static final String ACTION_START = "com.laurent.iptvlecteur.action.START_RECORDING";
    public static final String ACTION_STOP = "com.laurent.iptvlecteur.action.STOP_RECORDING";
    private static final String CHANNEL_ID = "recording";
    private static final int NOTIF_ID = 5501;
    private static final int MAX_EMPTY_POLLS = 20; // arrêt de sécurité si le flux HLS ne renvoie plus rien de neuf
    private static final int MAX_CONSECUTIVE_FAILURES = 10; // arrêt de sécurité pour un flux brut mort

    private static volatile boolean running = false;
    private static volatile String runningTitle = null;

    private final AtomicBoolean stopFlag = new AtomicBoolean(false);
    private Thread worker;
    private PowerManager.WakeLock wakeLock;

    public static boolean isRunning() {
        return running;
    }

    public static String currentTitle() {
        return runningTitle;
    }

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
        if (ACTION_STOP.equals(intent.getAction())) {
            stopFlag.set(true);
            return START_NOT_STICKY;
        }
        if (worker != null && worker.isAlive()) {
            // Un seul enregistrement à la fois : celui-ci est ignoré (une
            // programmation qui tombe pendant un enregistrement manuel, par
            // exemple). Limitation assumée pour garder le service simple.
            return START_NOT_STICKY;
        }

        final String id = intent.getStringExtra("id");
        final String url = intent.getStringExtra("url");
        final String title = intent.getStringExtra("title") != null ? intent.getStringExtra("title") : "Enregistrement";
        final String channelKey = intent.getStringExtra("channelKey");
        final long endAtMs = intent.getLongExtra("endAtMs", -1);
        if (id == null || url == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        stopFlag.set(false);
        running = true;
        runningTitle = title;

        createChannelIfNeeded();
        Notification notif = buildNotification(title, "Démarrage…");
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, notif);
        }

        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "iptvlecteur:recording");
            wakeLock.acquire(12 * 60 * 60 * 1000L); // 12h max, filet de sécurité si stop jamais reçu
        }

        Recordings.markRecordingStarted(this, id, title, channelKey, url);

        worker = new Thread(new Runnable() {
            @Override
            public void run() {
                doRecord(id, url, title, endAtMs);
            }
        });
        worker.start();
        return START_NOT_STICKY;
    }

    private void doRecord(String id, String url, String title, long endAtMs) {
        File dir = new File(getExternalFilesDir(null), "recordings");
        if (!dir.exists()) {
            dir.mkdirs();
        }
        String safeName = title.replaceAll("[^a-zA-Z0-9._-]+", "_");
        File outFile = new File(dir, safeName + "_" + id.substring(0, 8) + ".ts");
        long startedAt = System.currentTimeMillis();
        String status;
        String error = null;
        try (FileOutputStream out = new FileOutputStream(outFile)) {
            if (url.toLowerCase(Locale.ROOT).contains(".m3u8")) {
                recordHls(url, out, endAtMs);
            } else {
                recordRaw(url, out, endAtMs);
            }
            status = stopFlag.get() ? "stopped" : "done";
        } catch (Exception e) {
            status = "error";
            error = e.getMessage();
        }
        long size = outFile.exists() ? outFile.length() : 0;
        Recordings.markRecordingFinished(this, id, outFile.getAbsolutePath(), status, error, size, startedAt);

        running = false;
        runningTitle = null;
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        stopForeground(true);
        stopSelf();
    }

    // ---------- capture HLS (.m3u8) : playlist glissante en direct, un
    // segment .ts à la fois, concaténés tels quels dans le fichier de sortie
    // (un flux mpeg-ts reste valide une fois ses segments mis bout à bout,
    // pas besoin de remuxer). ----------
    private void recordHls(String initialUrl, FileOutputStream out, long endAtMs) {
        String mediaPlaylistUrl = resolveMediaPlaylistUrl(initialUrl);
        Set<String> seen = new LinkedHashSet<>();
        int emptyPolls = 0;
        long lastNotify = 0;
        while (!stopFlag.get() && (endAtMs <= 0 || System.currentTimeMillis() < endAtMs) && emptyPolls < MAX_EMPTY_POLLS) {
            URL playlistUrl = null;
            String text;
            try {
                playlistUrl = new URL(mediaPlaylistUrl);
                text = httpGetText(playlistUrl);
            } catch (IOException e) {
                text = null;
            }
            if (text == null) {
                emptyPolls++;
                sleepQuiet(4000);
                continue;
            }
            double targetDuration = 6.0;
            boolean ended = false;
            java.util.List<String> segments = new java.util.ArrayList<>();
            for (String rawLine : text.split("\\r?\\n")) {
                String line = rawLine.trim();
                if (line.startsWith("#EXT-X-TARGETDURATION:")) {
                    try {
                        targetDuration = Double.parseDouble(line.substring(line.indexOf(':') + 1));
                    } catch (NumberFormatException ignored) {
                        // ligne mal formée : on garde la valeur par défaut
                    }
                } else if (line.equals("#EXT-X-ENDLIST")) {
                    ended = true;
                } else if (!line.isEmpty() && !line.startsWith("#")) {
                    segments.add(line);
                }
            }
            boolean gotNew = false;
            for (String seg : segments) {
                if (stopFlag.get()) {
                    break;
                }
                URL segUrl;
                try {
                    segUrl = new URL(playlistUrl, seg);
                } catch (IOException e) {
                    continue;
                }
                String key = segUrl.toString();
                if (seen.contains(key)) {
                    continue;
                }
                seen.add(key);
                if (seen.size() > 500) {
                    seen.remove(seen.iterator().next());
                }
                if (downloadTo(segUrl, out)) {
                    gotNew = true;
                }
            }
            if (System.currentTimeMillis() - lastNotify > 30000) {
                updateNotification(runningTitle, elapsedLabel());
                lastNotify = System.currentTimeMillis();
            }
            if (ended) {
                break;
            }
            emptyPolls = gotNew ? 0 : emptyPolls + 1;
            sleepQuiet((long) (targetDuration * 1000));
        }
    }

    // Distingue playlist maîtresse (liste de variantes, #EXT-X-STREAM-INF)
    // et playlist média (liste de segments) — ne garde que le premier flux
    // variante si c'est une maîtresse.
    private String resolveMediaPlaylistUrl(String urlStr) {
        try {
            URL url = new URL(urlStr);
            String text = httpGetText(url);
            if (text == null || !text.contains("#EXT-X-STREAM-INF")) {
                return urlStr;
            }
            String[] lines = text.split("\\r?\\n");
            for (int i = 0; i < lines.length; i++) {
                if (lines[i].trim().startsWith("#EXT-X-STREAM-INF")) {
                    for (int j = i + 1; j < lines.length; j++) {
                        String candidate = lines[j].trim();
                        if (!candidate.isEmpty() && !candidate.startsWith("#")) {
                            return new URL(url, candidate).toString();
                        }
                    }
                }
            }
        } catch (IOException ignored) {
            // reste sur l'URL d'origine si la résolution échoue
        }
        return urlStr;
    }

    // ---------- capture d'un flux brut (pas de .m3u8, cas fréquent chez
    // Xtream Codes pour le direct) : copie continue des octets reçus,
    // reconnexion automatique si le flux se coupe. ----------
    private void recordRaw(String urlStr, FileOutputStream out, long endAtMs) {
        int consecutiveFailures = 0;
        long lastNotify = 0;
        while (!stopFlag.get() && (endAtMs <= 0 || System.currentTimeMillis() < endAtMs) && consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
            try {
                HttpURLConnection conn = openConnection(new URL(urlStr));
                InputStream in = conn.getInputStream();
                byte[] buf = new byte[64 * 1024];
                int n;
                boolean gotData = false;
                while (!stopFlag.get() && (endAtMs <= 0 || System.currentTimeMillis() < endAtMs) && (n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    gotData = true;
                    consecutiveFailures = 0;
                    if (System.currentTimeMillis() - lastNotify > 30000) {
                        updateNotification(runningTitle, elapsedLabel());
                        lastNotify = System.currentTimeMillis();
                    }
                }
                in.close();
                conn.disconnect();
                if (stopFlag.get() || (endAtMs > 0 && System.currentTimeMillis() >= endAtMs)) {
                    return;
                }
                if (!gotData) {
                    consecutiveFailures++;
                }
            } catch (IOException e) {
                consecutiveFailures++;
            }
            sleepQuiet(3000);
        }
    }

    private String elapsedLabel() {
        return "Enregistrement en cours…";
    }

    private HttpURLConnection openConnection(URL url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);
        conn.setInstanceFollowRedirects(true);
        return conn;
    }

    private String httpGetText(URL url) throws IOException {
        HttpURLConnection conn = openConnection(url);
        InputStream in = conn.getInputStream();
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) {
            bos.write(buf, 0, n);
        }
        in.close();
        conn.disconnect();
        return bos.toString("UTF-8");
    }

    private boolean downloadTo(URL url, FileOutputStream out) {
        try {
            HttpURLConnection conn = openConnection(url);
            InputStream in = conn.getInputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            boolean any = false;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                any = true;
            }
            in.close();
            conn.disconnect();
            return any;
        } catch (IOException e) {
            // segment manqué : on continue avec les suivants plutôt que
            // d'interrompre tout l'enregistrement pour un seul segment raté
            return false;
        }
    }

    private void sleepQuiet(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    private void createChannelIfNeeded() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID, "Enregistrements", NotificationManager.IMPORTANCE_LOW);
                nm.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String title, String text) {
        Intent stopIntent = new Intent(this, RecordingService.class).setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 0, stopIntent, RecorderPlugin.pendingIntentFlags());
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Enregistrement : " + title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Arrêter", stopPending)
                .build();
    }

    private void updateNotification(String title, String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIF_ID, buildNotification(title != null ? title : "Enregistrement", text));
        }
    }

    @Override
    public void onDestroy() {
        stopFlag.set(true);
        running = false;
        runningTitle = null;
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        super.onDestroy();
    }
}
"""

RECEIVER_JAVA = """package com.laurent.iptvlecteur;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Déclenché par AlarmManager à l'heure programmée : démarre
 * RecordingService, y compris si l'appli n'a pas été ouverte depuis. */
public class RecordingScheduleReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String id = intent.getStringExtra("id");
        if (id == null) {
            return;
        }
        JSONArray scheduled = Recordings.getScheduled(context);
        JSONObject match = null;
        for (int i = 0; i < scheduled.length(); i++) {
            try {
                JSONObject o = scheduled.getJSONObject(i);
                if (id.equals(o.optString("id"))) {
                    match = o;
                    break;
                }
            } catch (JSONException ignored) {
                // entrée corrompue : ignorée
            }
        }
        if (match == null) {
            return;
        }
        Recordings.removeScheduled(context, id);
        try {
            Intent svc = new Intent(context, RecordingService.class);
            svc.setAction(RecordingService.ACTION_START);
            svc.putExtra("id", id);
            svc.putExtra("url", match.getString("url"));
            svc.putExtra("title", match.optString("title", "Enregistrement"));
            svc.putExtra("channelKey", match.optString("channelKey", ""));
            svc.putExtra("endAtMs", match.optLong("endAtMs", -1));
            if (Build.VERSION.SDK_INT >= 26) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        } catch (JSONException ignored) {
            // entrée incomplète (url manquante) : on ne démarre pas
        }
    }
}
"""

BOOT_RECEIVER_JAVA = """package com.laurent.iptvlecteur;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** AlarmManager perd ses alarmes au redémarrage du téléphone : on réarme
 * ici celles des enregistrements encore à venir. */
public class RecordingBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            return;
        }
        JSONArray scheduled = Recordings.getScheduled(context);
        long now = System.currentTimeMillis();
        for (int i = 0; i < scheduled.length(); i++) {
            try {
                JSONObject o = scheduled.getJSONObject(i);
                long startAtMs = o.optLong("startAtMs", 0);
                if (startAtMs > now) {
                    RecorderPlugin.armAlarm(context, o.getString("id"), startAtMs);
                }
            } catch (JSONException ignored) {
                // entrée corrompue : ignorée
            }
        }
    }
}
"""

RECORDINGS_JAVA = """package com.laurent.iptvlecteur;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Persistance simple (SharedPreferences + JSON, pas de base de données)
 * des enregistrements programmés et terminés — partagée entre le plugin,
 * le service et les deux BroadcastReceiver. */
final class Recordings {
    private static final String PREFS = "iptv_recorder";
    private static final String KEY_SCHEDULED = "scheduled";
    private static final String KEY_RECORDINGS = "recordings";

    private Recordings() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONArray getScheduled(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY_SCHEDULED, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static void setScheduled(Context ctx, JSONArray arr) {
        prefs(ctx).edit().putString(KEY_SCHEDULED, arr.toString()).apply();
    }

    static JSONArray getRecordings(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY_RECORDINGS, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static void setRecordings(Context ctx, JSONArray arr) {
        prefs(ctx).edit().putString(KEY_RECORDINGS, arr.toString()).apply();
    }

    static void addScheduled(Context ctx, JSONObject item) {
        JSONArray arr = getScheduled(ctx);
        arr.put(item);
        setScheduled(ctx, arr);
    }

    static void removeScheduled(Context ctx, String id) {
        JSONArray arr = getScheduled(ctx);
        JSONArray out = new JSONArray();
        for (int i = 0; i < arr.length(); i++) {
            try {
                JSONObject o = arr.getJSONObject(i);
                if (!id.equals(o.optString("id"))) {
                    out.put(o);
                }
            } catch (JSONException ignored) {
                // entrée corrompue : abandonnée au passage
            }
        }
        setScheduled(ctx, out);
    }

    static void markRecordingStarted(Context ctx, String id, String title, String channelKey, String url) {
        try {
            JSONArray arr = getRecordings(ctx);
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("title", title);
            o.put("channelKey", channelKey);
            o.put("url", url);
            o.put("status", "recording");
            o.put("startedAtMs", System.currentTimeMillis());
            arr.put(o);
            setRecordings(ctx, arr);
        } catch (JSONException ignored) {
            // ne bloque pas l'enregistrement lui-même si l'index échoue à s'écrire
        }
    }

    static void markRecordingFinished(Context ctx, String id, String filePath, String status,
                                       String error, long sizeBytes, long startedAtMs) {
        try {
            JSONArray arr = getRecordings(ctx);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                if (id.equals(o.optString("id"))) {
                    o.put("filePath", filePath);
                    o.put("status", status);
                    if (error != null) {
                        o.put("error", error);
                    }
                    o.put("sizeBytes", sizeBytes);
                    o.put("finishedAtMs", System.currentTimeMillis());
                    o.put("durationMs", System.currentTimeMillis() - startedAtMs);
                    break;
                }
            }
            setRecordings(ctx, arr);
        } catch (JSONException ignored) {
            // idem : ne fait pas échouer l'enregistrement pour un souci d'index
        }
    }

    static void removeRecording(Context ctx, String id) {
        JSONArray arr = getRecordings(ctx);
        JSONArray out = new JSONArray();
        for (int i = 0; i < arr.length(); i++) {
            try {
                JSONObject o = arr.getJSONObject(i);
                if (!id.equals(o.optString("id"))) {
                    out.put(o);
                }
            } catch (JSONException ignored) {
                // entrée corrompue : abandonnée au passage
            }
        }
        setRecordings(ctx, out);
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

    if "RecordingService" not in s:
        block = (
            '        <service\n'
            '            android:name=".RecordingService"\n'
            '            android:foregroundServiceType="dataSync"\n'
            '            android:exported="false" />\n\n'
            '        <receiver\n'
            '            android:name=".RecordingScheduleReceiver"\n'
            '            android:exported="false" />\n\n'
            '        <receiver\n'
            '            android:name=".RecordingBootReceiver"\n'
            '            android:exported="false">\n'
            '            <intent-filter>\n'
            '                <action android:name="android.intent.action.BOOT_COMPLETED" />\n'
            '            </intent-filter>\n'
            '        </receiver>\n\n'
            '        <provider\n'
        )
        s = re.sub(r"[ \t]*<provider\n", block, s, count=1)
        print("AndroidManifest.xml : RecordingService + receivers déclarés")

    perms = [
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.WAKE_LOCK",
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
        print("AndroidManifest.xml : permissions d'enregistrement ajoutées")
    else:
        print("AndroidManifest.xml : permissions d'enregistrement déjà présentes")

    open(p, "w").write(s)


def patch_main_activity():
    p = "android/app/src/main/java/com/laurent/iptvlecteur/MainActivity.java"
    s = open(p).read()
    if "registerPlugin(RecorderPlugin.class)" in s:
        print("MainActivity.java : RecorderPlugin déjà enregistré")
        return
    if "registerPlugin(" in s:
        # patch_native_player.py est passé avant et a déjà créé le onCreate.
        s = s.replace(
            "registerPlugin(NativePlayerPlugin.class);",
            "registerPlugin(NativePlayerPlugin.class);\n        registerPlugin(RecorderPlugin.class);",
            1,
        )
    else:
        s = s.replace(
            "public class MainActivity extends BridgeActivity {}",
            "public class MainActivity extends BridgeActivity {\n"
            "    @Override\n"
            "    public void onCreate(android.os.Bundle savedInstanceState) {\n"
            "        registerPlugin(RecorderPlugin.class);\n"
            "        super.onCreate(savedInstanceState);\n"
            "    }\n"
            "}\n",
        )
    open(p, "w").write(s)
    print("MainActivity.java : RecorderPlugin enregistré")


write_if_changed(PKG_DIR + "/RecorderPlugin.java", PLUGIN_JAVA)
write_if_changed(PKG_DIR + "/RecordingService.java", SERVICE_JAVA)
write_if_changed(PKG_DIR + "/RecordingScheduleReceiver.java", RECEIVER_JAVA)
write_if_changed(PKG_DIR + "/RecordingBootReceiver.java", BOOT_RECEIVER_JAVA)
write_if_changed(PKG_DIR + "/Recordings.java", RECORDINGS_JAVA)
patch_manifest()
patch_main_activity()

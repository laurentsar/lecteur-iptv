#!/usr/bin/env python3
"""« Envoyer sur la Fire TV » : le téléphone envoie la chaîne en cours à
l'appli installée sur la TV, par le wifi de la maison (android/ est
régénéré à chaque build par `cap add android`, donc ce script tourne à
chaque fois — APRÈS patch_native_player.py, dont il complète l'écran).

Pourquoi pas Chromecast : Amazon n'a pas mis Google Cast dans les Fire TV,
elles n'apparaissent donc jamais dans le sélecteur Cast. Le protocole
d'Amazon (Fling/DIAL) demanderait une appli réceptrice dédiée et un SDK
propriétaire. Or l'APK tourne déjà sur la Fire TV (Fire OS est un Android) :
il suffit qu'elle écoute, et que le téléphone sache la trouver.

- Côté TV (appareil en mode télé : Fire TV, Android TV, boîtier) : un petit
  serveur HTTP local (port 47800, ou un port libre) reçoit POST /play avec
  { url, title, live, logo, epgKey } et le transmet à la page (évènement
  « play » du plugin TvLink, voir www/tvlink.js), qui ouvre la chaîne comme
  si on l'avait choisie à la télécommande. Il s'annonce sur le réseau en
  mDNS/DNS-SD (NsdManager, type _lecteuriptv._tcp) sous le nom de l'appareil
  (« Fire TV de … »).
- Côté téléphone : recherche des TV annoncées (NsdManager), liste, envoi.
  Bouton dans l'écran de lecture natif (celui qu'on voit par défaut sur
  l'APK) et dans le lecteur web (www/player.js). Repli « Adresse IP… » pour
  les box qui filtrent le multicast : l'adresse s'affiche sur la TV dans
  Réglages → Infos.

Une fois l'envoi accepté, le téléphone arrête sa propre lecture : beaucoup
d'abonnements IPTV n'autorisent qu'une connexion à la fois, la TV se ferait
refuser le flux sinon.

Sécurité : le serveur n'écoute que tant que l'appli est ouverte sur la TV,
n'accepte que des liens http(s)/rtsp/rtmp/rtp/udp, et exige un en-tête
personnalisé (X-Lecteur-IPTV) — une page web ouverte ailleurs sur le réseau
ne peut pas en poser sans requête préalable (CORS), à laquelle le serveur ne
répond pas. Aucune permission Android supplémentaire (INTERNET suffit à
NsdManager et aux sockets).

Idempotent.
"""
import os

PKG_DIR = "android/app/src/main/java/com/laurent/iptvlecteur"
RES_DIR = "android/app/src/main/res"

TV_LINK_JAVA = """package com.laurent.iptvlecteur;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.provider.Settings;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import org.json.JSONObject;

/** Liaison téléphone → TV sur le réseau local, voir ci/patch_tv_link.py. */
final class TvLink {
    static final String SERVICE_TYPE = "_lecteuriptv._tcp.";
    static final int PORT = 47800;
    static final String HEADER = "X-Lecteur-IPTV";
    private static final int MAX_BODY = 64 * 1024;

    interface Receiver {
        void onPlay(JSONObject media);
    }

    interface Discovery {
        void onFound(Device device);

        void onLost(String name);
    }

    interface Result {
        void onDone(boolean ok, String message);
    }

    static final class Device {
        final String name;
        final String host;
        final int port;

        Device(String name, String host, int port) {
            this.name = name;
            this.host = host;
            this.port = port;
        }
    }

    private TvLink() {
    }

    static boolean isTv(Context ctx) {
        UiModeManager ui = (UiModeManager) ctx.getSystemService(Context.UI_MODE_SERVICE);
        if (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
            return true;
        }
        PackageManager pm = ctx.getPackageManager();
        return pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
                || pm.hasSystemFeature("amazon.hardware.fire_tv");
    }

    // Nom choisi dans les réglages de la TV (« Fire TV de Laurent »), plutôt
    // que le code modèle (AFTMM) que personne ne reconnaît.
    static String deviceName(Context ctx) {
        String name = null;
        try {
            name = Settings.Global.getString(ctx.getContentResolver(), "device_name");
        } catch (Exception e) {
            name = null;
        }
        if (name == null || name.trim().isEmpty()) {
            name = Build.MODEL;
        }
        return name.trim();
    }

    static String localIp() {
        try {
            for (NetworkInterface itf : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!itf.isUp() || itf.isLoopback()) {
                    continue;
                }
                for (InetAddress addr : Collections.list(itf.getInetAddresses())) {
                    if (addr instanceof Inet4Address && addr.isSiteLocalAddress()) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception e) {
            return "";
        }
        return "";
    }

    // ---------- côté TV : serveur + annonce ----------

    private static ServerSocket server;
    private static NsdManager.RegistrationListener registration;
    private static volatile String registeredName = "";

    static synchronized int port() {
        return server == null ? -1 : server.getLocalPort();
    }

    static synchronized int startReceiver(final Context ctx, final Receiver receiver) {
        if (server != null) {
            return server.getLocalPort();
        }
        ServerSocket s;
        try {
            s = new ServerSocket(PORT);
        } catch (IOException e) {
            try {
                s = new ServerSocket(0);
            } catch (IOException e2) {
                return -1;
            }
        }
        server = s;
        final ServerSocket srv = s;
        Thread accept = new Thread(new Runnable() {
            @Override
            public void run() {
                while (!srv.isClosed()) {
                    try {
                        final Socket client = srv.accept();
                        Thread t = new Thread(new Runnable() {
                            @Override
                            public void run() {
                                handle(ctx, client, receiver);
                            }
                        }, "TvLink-client");
                        t.setDaemon(true);
                        t.start();
                    } catch (IOException e) {
                        if (srv.isClosed()) {
                            return;
                        }
                    }
                }
            }
        }, "TvLink-server");
        accept.setDaemon(true);
        accept.start();
        announce(ctx, srv.getLocalPort());
        return srv.getLocalPort();
    }

    static synchronized void stopReceiver(Context ctx) {
        if (registration != null) {
            try {
                NsdManager nsd = (NsdManager) ctx.getSystemService(Context.NSD_SERVICE);
                if (nsd != null) {
                    nsd.unregisterService(registration);
                }
            } catch (Exception e) {
                // déjà désinscrit
            }
            registration = null;
        }
        if (server != null) {
            try {
                server.close();
            } catch (IOException e) {
                // rien à faire
            }
            server = null;
        }
    }

    private static void announce(Context ctx, int port) {
        NsdManager nsd = (NsdManager) ctx.getSystemService(Context.NSD_SERVICE);
        if (nsd == null) {
            return;
        }
        NsdServiceInfo info = new NsdServiceInfo();
        info.setServiceName(deviceName(ctx));
        info.setServiceType(SERVICE_TYPE);
        info.setPort(port);
        registration = new NsdManager.RegistrationListener() {
            @Override
            public void onServiceRegistered(NsdServiceInfo registered) {
                // Renommé par le système en cas de doublon (« … (2) »).
                registeredName = registered.getServiceName();
            }

            @Override
            public void onRegistrationFailed(NsdServiceInfo info, int errorCode) {
            }

            @Override
            public void onServiceUnregistered(NsdServiceInfo info) {
            }

            @Override
            public void onUnregistrationFailed(NsdServiceInfo info, int errorCode) {
            }
        };
        try {
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, registration);
        } catch (Exception e) {
            // Pas d'annonce : l'envoi par adresse IP reste possible.
            registration = null;
        }
    }

    private static void handle(Context ctx, Socket client, Receiver receiver) {
        try {
            client.setSoTimeout(5000);
            InputStream in = new BufferedInputStream(client.getInputStream());
            String requestLine = readLine(in);
            if (requestLine == null) {
                return;
            }
            String[] parts = requestLine.split(" ");
            String method = parts.length > 0 ? parts[0] : "";
            String path = parts.length > 1 ? parts[1] : "";
            int length = 0;
            boolean marked = false;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon <= 0) {
                    continue;
                }
                String key = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
                String value = line.substring(colon + 1).trim();
                if (key.equals("content-length")) {
                    try {
                        length = Integer.parseInt(value);
                    } catch (NumberFormatException e) {
                        length = -1;
                    }
                } else if (key.equals(HEADER.toLowerCase(Locale.ROOT))) {
                    marked = true;
                }
            }
            OutputStream out = client.getOutputStream();
            if (method.equals("GET") && path.equals("/info")) {
                JSONObject info = new JSONObject();
                info.put("app", "lecteur-iptv");
                info.put("name", registeredName.isEmpty() ? deviceName(ctx) : registeredName);
                respond(out, 200, info.toString());
                return;
            }
            if (!method.equals("POST") || !path.equals("/play")) {
                respond(out, 404, "{\\"error\\":\\"introuvable\\"}");
                return;
            }
            if (!marked) {
                respond(out, 403, "{\\"error\\":\\"en-tete manquant\\"}");
                return;
            }
            if (length <= 0 || length > MAX_BODY) {
                respond(out, 413, "{\\"error\\":\\"taille\\"}");
                return;
            }
            byte[] body = new byte[length];
            int read = 0;
            while (read < length) {
                int n = in.read(body, read, length - read);
                if (n < 0) {
                    break;
                }
                read += n;
            }
            JSONObject media = new JSONObject(new String(body, 0, read, StandardCharsets.UTF_8));
            if (!acceptable(media.optString("url", ""))) {
                respond(out, 400, "{\\"error\\":\\"lien refuse\\"}");
                return;
            }
            respond(out, 200, "{\\"ok\\":true}");
            receiver.onPlay(media);
        } catch (Exception e) {
            // requête illisible : on ferme simplement
        } finally {
            try {
                client.close();
            } catch (IOException e) {
                // rien à faire
            }
        }
    }

    private static final Set<String> SCHEMES = new HashSet<>(
            java.util.Arrays.asList("http", "https", "rtsp", "rtmp", "rtp", "udp"));

    static boolean acceptable(String url) {
        int colon = url.indexOf("://");
        return colon > 0 && SCHEMES.contains(url.substring(0, colon).toLowerCase(Locale.ROOT));
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\\n') {
                break;
            }
            if (c != '\\r') {
                buf.write(c);
            }
            if (buf.size() > 8192) {
                throw new IOException("ligne trop longue");
            }
        }
        if (c == -1 && buf.size() == 0) {
            return null;
        }
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }

    private static void respond(OutputStream out, int code, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + code + (code == 200 ? " OK" : " Error") + "\\r\\n"
                + "Content-Type: application/json; charset=utf-8\\r\\n"
                + "Content-Length: " + body.length + "\\r\\n"
                + "Connection: close\\r\\n\\r\\n";
        out.write(head.getBytes(StandardCharsets.US_ASCII));
        out.write(body);
        out.flush();
    }

    // ---------- côté téléphone : recherche + envoi ----------

    static final class Search {
        private final NsdManager nsd;
        private final Discovery callback;
        private final ArrayDeque<NsdServiceInfo> pending = new ArrayDeque<>();
        private boolean resolving;
        private boolean stopped;
        private NsdManager.DiscoveryListener listener;

        Search(NsdManager nsd, Discovery callback) {
            this.nsd = nsd;
            this.callback = callback;
        }

        void start() {
            listener = new NsdManager.DiscoveryListener() {
                @Override
                public void onDiscoveryStarted(String serviceType) {
                }

                @Override
                public void onServiceFound(NsdServiceInfo info) {
                    String type = info.getServiceType();
                    if (type == null || !type.contains("_lecteuriptv")) {
                        return;
                    }
                    enqueue(info);
                }

                @Override
                public void onServiceLost(NsdServiceInfo info) {
                    if (!isStopped()) {
                        callback.onLost(info.getServiceName());
                    }
                }

                @Override
                public void onDiscoveryStopped(String serviceType) {
                }

                @Override
                public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                }

                @Override
                public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                }
            };
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener);
        }

        synchronized boolean isStopped() {
            return stopped;
        }

        synchronized void stop() {
            if (stopped) {
                return;
            }
            stopped = true;
            pending.clear();
            try {
                nsd.stopServiceDiscovery(listener);
            } catch (Exception e) {
                // déjà arrêtée
            }
        }

        // Avant Android 14, NsdManager ne résout qu'un service à la fois
        // (FAILURE_ALREADY_ACTIVE sinon) : file d'attente.
        private synchronized void enqueue(NsdServiceInfo info) {
            if (stopped) {
                return;
            }
            pending.add(info);
            next();
        }

        private synchronized void next() {
            if (resolving || stopped || pending.isEmpty()) {
                return;
            }
            resolving = true;
            NsdServiceInfo info = pending.poll();
            try {
                nsd.resolveService(info, new NsdManager.ResolveListener() {
                    @Override
                    public void onResolveFailed(NsdServiceInfo failed, int errorCode) {
                        done();
                    }

                    @Override
                    public void onServiceResolved(NsdServiceInfo resolved) {
                        InetAddress host = resolved.getHost();
                        if (host != null && !isStopped()) {
                            callback.onFound(new Device(resolved.getServiceName(),
                                    host.getHostAddress(), resolved.getPort()));
                        }
                        done();
                    }
                });
            } catch (Exception e) {
                resolving = false;
                next();
            }
        }

        private synchronized void done() {
            resolving = false;
            next();
        }
    }

    static Search discover(Context ctx, Discovery callback) {
        NsdManager nsd = (NsdManager) ctx.getSystemService(Context.NSD_SERVICE);
        if (nsd == null) {
            return null;
        }
        Search search = new Search(nsd, callback);
        try {
            search.start();
        } catch (Exception e) {
            return null;
        }
        return search;
    }

    static JSONObject media(String url, String title, boolean live, String logo, String epgKey) {
        JSONObject media = new JSONObject();
        try {
            media.put("url", url);
            media.put("title", title == null ? "" : title);
            media.put("live", live);
            media.put("logo", logo == null ? "" : logo);
            media.put("epgKey", epgKey == null ? "" : epgKey);
        } catch (org.json.JSONException e) {
            // clés fixes, ne peut pas arriver
        }
        return media;
    }

    static void send(final String host, final int port, final JSONObject media, final Result result) {
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    String h = host.contains(":") && !host.startsWith("[") ? "[" + host + "]" : host;
                    URL url = new URL("http", h, port, "/play");
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(4000);
                    conn.setReadTimeout(6000);
                    conn.setRequestMethod("POST");
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    conn.setRequestProperty(HEADER, "1");
                    byte[] body = media.toString().getBytes(StandardCharsets.UTF_8);
                    conn.setFixedLengthStreamingMode(body.length);
                    OutputStream out = conn.getOutputStream();
                    out.write(body);
                    out.close();
                    int code = conn.getResponseCode();
                    if (code == 200) {
                        result.onDone(true, "");
                    } else if (code == 400) {
                        result.onDone(false, "la TV refuse ce type de lien");
                    } else {
                        result.onDone(false, "réponse inattendue de la TV (" + code + ")");
                    }
                } catch (Exception e) {
                    result.onDone(false, "TV injoignable — l'appli est-elle ouverte dessus, sur le même wifi ?");
                } finally {
                    if (conn != null) {
                        conn.disconnect();
                    }
                }
            }
        }, "TvLink-send");
        t.setDaemon(true);
        t.start();
    }
}
"""

PLUGIN_JAVA = """package com.laurent.iptvlecteur;

import android.content.Context;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/** Pont JS de TvLink (voir ci/patch_tv_link.py et www/tvlink.js). */
@CapacitorPlugin(name = "TvLink")
public class TvLinkPlugin extends Plugin {
    private TvLink.Search search;

    @Override
    public void load() {
        if (TvLink.isTv(getContext())) {
            TvLink.startReceiver(getContext().getApplicationContext(), new TvLink.Receiver() {
                @Override
                public void onPlay(JSONObject media) {
                    received(media);
                }
            });
        }
    }

    private void received(JSONObject media) {
        final Context ctx = getContext();
        // L'écran natif en cours laisse la place : la page va rouvrir le
        // lecteur (natif par défaut) sur la chaîne reçue.
        final NativePlayerActivity current = NativePlayerActivity.current();
        if (current != null) {
            current.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    current.finish();
                }
            });
        }
        // Appli passée en arrière-plan : on la ramène devant (Fire OS 7 le
        // permet ; sur les versions récentes d'Android le système peut le
        // refuser, la chaîne s'ouvrira alors au retour dans l'appli).
        try {
            Intent front = new Intent(ctx, MainActivity.class);
            front.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            ctx.startActivity(front);
        } catch (Exception e) {
            // tant pis, la page recevra l'évènement quand même
        }
        JSObject data = new JSObject();
        data.put("url", media.optString("url", ""));
        data.put("title", media.optString("title", ""));
        data.put("live", media.optBoolean("live", true));
        data.put("logo", media.optString("logo", ""));
        data.put("epgKey", media.optString("epgKey", ""));
        // Conservé si la page n'écoute pas encore (appli en train de démarrer).
        notifyListeners("play", data, true);
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        r.put("tv", TvLink.isTv(getContext()));
        r.put("receiving", TvLink.port() > 0);
        r.put("port", TvLink.port());
        r.put("name", TvLink.deviceName(getContext()));
        r.put("ip", TvLink.localIp());
        call.resolve(r);
    }

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        stopSearch();
        search = TvLink.discover(getContext(), new TvLink.Discovery() {
            @Override
            public void onFound(TvLink.Device device) {
                JSObject d = new JSObject();
                d.put("name", device.name);
                d.put("host", device.host);
                d.put("port", device.port);
                notifyListeners("device", d);
            }

            @Override
            public void onLost(String name) {
                JSObject d = new JSObject();
                d.put("name", name);
                notifyListeners("deviceLost", d);
            }
        });
        if (search == null) {
            call.reject("recherche indisponible sur cet appareil");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        stopSearch();
        call.resolve();
    }

    @PluginMethod
    public void send(final PluginCall call) {
        String host = call.getString("host", "");
        String url = call.getString("url", "");
        if (host.isEmpty() || !TvLink.acceptable(url)) {
            call.reject("adresse ou lien invalide");
            return;
        }
        JSONObject media = TvLink.media(url, call.getString("title", ""), call.getBoolean("live", true),
                call.getString("logo", ""), call.getString("epgKey", ""));
        TvLink.send(host, call.getInt("port", TvLink.PORT), media, new TvLink.Result() {
            @Override
            public void onDone(boolean ok, String message) {
                if (ok) {
                    call.resolve();
                } else {
                    call.reject(message);
                }
            }
        });
    }

    private void stopSearch() {
        if (search != null) {
            search.stop();
            search = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopSearch();
        TvLink.stopReceiver(getContext().getApplicationContext());
    }
}
"""

# ---------- bouton dans l'écran de lecture natif ----------

LAYOUT_ANCHOR = """        <ImageButton
            android:id="@+id/playerListBtn\""""

LAYOUT_BUTTON = """        <ImageButton
            android:id="@+id/playerSendBtn"
            android:layout_width="34dp"
            android:layout_height="34dp"
            android:layout_marginStart="10dp"
            android:padding="6dp"
            android:scaleType="fitCenter"
            android:background="@drawable/bg_player_btn"
            android:src="@drawable/ic_send_tv"
            android:contentDescription="Envoyer sur la Fire TV"
            android:visibility="gone" />

"""

# Téléviseur avec une flèche : « envoyer vers l'écran ».
IC_SEND_TV_XML = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="#FFFFFF">
    <path
        android:fillColor="#FF000000"
        android:pathData="M21,3H3C1.9,3 1,3.9 1,5v12c0,1.1 0.9,2 2,2h5v2h8v-2h5c1.1,0 1.99,-0.9 1.99,-2L23,5C23,3.9 22.1,3 21,3zM21,17H3V5h18V17zM12,7l-4,4h3v4h2v-4h3L12,7z" />
</vector>
"""

FOCUS_OLD = "applyFocusEffect(homeBtn, listBtn, recordBtn, tracksBtn, pipBtn, closeBtn, castBtn);"
FOCUS_NEW = ("setupSendToTv();\n"
             "        applyFocusEffect(homeBtn, listBtn, recordBtn, tracksBtn, pipBtn, closeBtn, castBtn,\n"
             "                findViewById(R.id.playerSendBtn));")

DESTROY_OLD = """        uiHandler.removeCallbacks(progressRunnable);
        if (currentInstance == this) {"""
DESTROY_NEW = """        uiHandler.removeCallbacks(progressRunnable);
        stopTvSearch();
        if (currentInstance == this) {"""

METHODS_ANCHOR = "    // ---------- Enregistrement ----------"

ACTIVITY_METHODS = """    // ---------- Envoyer sur la Fire TV (voir ci/patch_tv_link.py) ----------
    private TvLink.Search tvSearch;

    private void setupSendToTv() {
        View btn = findViewById(R.id.playerSendBtn);
        if (btn == null) {
            return;
        }
        // Sur la TV elle-même, c'est elle qui reçoit : pas de bouton.
        if (TvLink.isTv(this)) {
            btn.setVisibility(View.GONE);
            return;
        }
        btn.setVisibility(View.VISIBLE);
        btn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showSendToTv();
            }
        });
    }

    private void stopTvSearch() {
        if (tvSearch != null) {
            tvSearch.stop();
            tvSearch = null;
        }
    }

    private void showSendToTv() {
        final List<TvLink.Device> found = new ArrayList<>();
        final android.widget.ArrayAdapter<String> adapter =
                new android.widget.ArrayAdapter<>(this, android.R.layout.simple_list_item_1);
        int pad = Math.round(20 * getResources().getDisplayMetrics().density);
        android.widget.LinearLayout box = new android.widget.LinearLayout(this);
        box.setOrientation(android.widget.LinearLayout.VERTICAL);
        box.setPadding(pad, pad / 2, pad, 0);
        final TextView status = new TextView(this);
        status.setText("Recherche des TV sur le wifi…");
        box.addView(status);
        final android.widget.ListView list = new android.widget.ListView(this);
        list.setAdapter(adapter);
        box.addView(list);

        final AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Envoyer sur la Fire TV")
                .setView(box)
                .setNeutralButton("Adresse IP…", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        stopTvSearch();
                        askTvAddress();
                    }
                })
                .setNegativeButton("Annuler", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        stopTvSearch();
                    }
                })
                .create();
        dialog.setOnCancelListener(new DialogInterface.OnCancelListener() {
            @Override
            public void onCancel(DialogInterface d) {
                stopTvSearch();
            }
        });
        list.setOnItemClickListener(new android.widget.AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(android.widget.AdapterView<?> parent, View view, int position, long id) {
                stopTvSearch();
                dialog.dismiss();
                TvLink.Device device = found.get(position);
                sendToTv(device.host, device.port, device.name);
            }
        });

        stopTvSearch();
        tvSearch = TvLink.discover(this, new TvLink.Discovery() {
            @Override
            public void onFound(final TvLink.Device device) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        for (int i = 0; i < found.size(); i++) {
                            if (found.get(i).name.equals(device.name)) {
                                found.remove(i);
                                adapter.remove(adapter.getItem(i));
                                break;
                            }
                        }
                        found.add(device);
                        adapter.add("📺  " + device.name);
                        status.setText("Choisis la TV :");
                    }
                });
            }

            @Override
            public void onLost(final String name) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        for (int i = 0; i < found.size(); i++) {
                            if (found.get(i).name.equals(name)) {
                                found.remove(i);
                                adapter.remove(adapter.getItem(i));
                                break;
                            }
                        }
                    }
                });
            }
        });
        if (tvSearch == null) {
            status.setText("Recherche impossible sur cet appareil. Utilise « Adresse IP… ».");
        }
        uiHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (dialog.isShowing() && found.isEmpty()) {
                    status.setText("Aucune TV trouvée. Ouvre Lecteur IPTV sur la Fire TV (même wifi), "
                            + "ou utilise « Adresse IP… » — elle s'affiche sur la TV dans Réglages → Infos.");
                }
            }
        }, 8000);
        trackDialog(dialog);
        dialog.show();
    }

    private void askTvAddress() {
        final android.content.SharedPreferences prefs = getSharedPreferences("tvlink", MODE_PRIVATE);
        final android.widget.EditText input = new android.widget.EditText(this);
        input.setSingleLine(true);
        input.setHint("ex. 192.168.1.20");
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(prefs.getString("ip", ""));
        int pad = Math.round(20 * getResources().getDisplayMetrics().density);
        android.widget.FrameLayout box = new android.widget.FrameLayout(this);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(input);
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Adresse IP de la Fire TV")
                .setView(box)
                .setPositiveButton("Envoyer", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        String text = input.getText().toString().trim();
                        if (text.isEmpty()) {
                            return;
                        }
                        prefs.edit().putString("ip", text).apply();
                        String host = text;
                        int port = TvLink.PORT;
                        int colon = text.lastIndexOf(':');
                        if (colon > 0 && text.indexOf(':') == colon) {
                            host = text.substring(0, colon);
                            try {
                                port = Integer.parseInt(text.substring(colon + 1));
                            } catch (NumberFormatException e) {
                                port = TvLink.PORT;
                            }
                        }
                        sendToTv(host, port, host);
                    }
                })
                .setNegativeButton("Annuler", null)
                .create();
        trackDialog(dialog);
        dialog.show();
    }

    private void sendToTv(String host, int port, final String name) {
        String logo = "";
        String epgKey = "";
        if (channelIndex >= 0 && channelIndex < channels.size()
                && channels.get(channelIndex).url.equals(mediaUrl)) {
            logo = channels.get(channelIndex).logo;
            epgKey = channels.get(channelIndex).epgKey;
        }
        Toast.makeText(this, "Envoi vers " + name + "…", Toast.LENGTH_SHORT).show();
        TvLink.send(host, port, TvLink.media(mediaUrl, mediaTitle, isLive, logo, epgKey), new TvLink.Result() {
            @Override
            public void onDone(final boolean ok, final String message) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (ok) {
                            Toast.makeText(getApplicationContext(), "▶ Lecture lancée sur " + name,
                                    Toast.LENGTH_LONG).show();
                            // Une seule connexion par abonnement chez beaucoup
                            // de fournisseurs : on libère le flux pour la TV.
                            finish();
                        } else {
                            Toast.makeText(getApplicationContext(), "Envoi impossible : " + message,
                                    Toast.LENGTH_LONG).show();
                        }
                    }
                });
            }
        });
    }

"""


def write_if_changed(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path) and open(path).read() == content:
        print(os.path.basename(path), ": inchangé")
        return
    open(path, "w").write(content)
    print(os.path.basename(path), ": écrit")


def replace_once(s, old, new, what):
    if new in s:
        return s
    if old not in s:
        raise SystemExit(what + " : point d'insertion introuvable")
    return s.replace(old, new, 1)


def patch_layout():
    p = RES_DIR + "/layout/activity_native_player.xml"
    s = open(p).read()
    if "@+id/playerSendBtn" in s:
        print("layout : bouton d'envoi déjà présent")
        return
    s = replace_once(s, LAYOUT_ANCHOR, LAYOUT_BUTTON + LAYOUT_ANCHOR, "layout")
    open(p, "w").write(s)
    print("layout : bouton d'envoi ajouté")


def patch_activity():
    p = PKG_DIR + "/NativePlayerActivity.java"
    s = open(p).read()
    if "private void showSendToTv()" in s:
        print("NativePlayerActivity : envoi TV déjà présent")
        return
    s = replace_once(s, FOCUS_OLD, FOCUS_NEW, "NativePlayerActivity (applyFocusEffect)")
    s = replace_once(s, DESTROY_OLD, DESTROY_NEW, "NativePlayerActivity (onDestroy)")
    s = replace_once(s, METHODS_ANCHOR, ACTIVITY_METHODS + METHODS_ANCHOR, "NativePlayerActivity (méthodes)")
    open(p, "w").write(s)
    print("NativePlayerActivity : envoi TV ajouté")


def patch_main_activity():
    p = PKG_DIR + "/MainActivity.java"
    s = open(p).read()
    if "registerPlugin(TvLinkPlugin.class)" in s:
        print("MainActivity.java : TvLinkPlugin déjà enregistré")
        return
    marker = "registerPlugin(NativePlayerPlugin.class);"
    if marker not in s:
        raise SystemExit("MainActivity.java : NativePlayerPlugin absent — patch_native_player.py doit passer avant")
    s = s.replace(marker, marker + "\n        registerPlugin(TvLinkPlugin.class);", 1)
    open(p, "w").write(s)
    print("MainActivity.java : TvLinkPlugin enregistré")


write_if_changed(PKG_DIR + "/TvLink.java", TV_LINK_JAVA)
write_if_changed(PKG_DIR + "/TvLinkPlugin.java", PLUGIN_JAVA)
write_if_changed(RES_DIR + "/drawable/ic_send_tv.xml", IC_SEND_TV_XML)
patch_layout()
patch_activity()
patch_main_activity()

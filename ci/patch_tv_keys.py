#!/usr/bin/env python3
"""Relaie les touches CHAÎNE +/− de la télécommande à la page (android/ est
régénéré à chaque build, donc ce script tourne à chaque fois).

Sur une télé Android, KEYCODE_CHANNEL_UP/CHANNEL_DOWN sont consommées par le
système (elles servent au tuner du téléviseur) : la WebView ne reçoit aucun
évènement clavier, et le zapping branché côté web (setupZapKeys dans
player.js) ne peut donc pas les voir. L'activité, elle, les reçoit dans
dispatchKeyEvent avant tout le monde : on les convertit en évènement DOM
`tvchannel` (detail = +1 / −1), que player.js écoute.

Idempotent : ne fait rien si la surcharge est déjà là. À exécuter APRÈS
ci/patch_native_player.py, qui crée le corps de MainActivity.
"""
import re

P = "android/app/src/main/java/com/laurent/iptvlecteur/MainActivity.java"

METHOD = """
    // Touches CHAÎNE +/− de la télécommande : le système ne les transmet pas
    // à la WebView, on les relaie donc à la page sous forme d'évènement DOM
    // `tvchannel` (detail = +1 pour la suivante, −1 pour la précédente).
    // Voir setupZapKeys() dans www/player.js.
    @Override
    public boolean dispatchKeyEvent(android.view.KeyEvent event) {
        int code = event.getKeyCode();
        if (code == android.view.KeyEvent.KEYCODE_CHANNEL_UP || code == android.view.KeyEvent.KEYCODE_CHANNEL_DOWN) {
            // Seulement l'enfoncement : ACTION_UP ferait un double saut, et on
            // consomme la touche dans les deux cas pour que le système ne la
            // rende pas au tuner de la télé.
            if (event.getAction() == android.view.KeyEvent.ACTION_DOWN) {
                sendChannelStep(code == android.view.KeyEvent.KEYCODE_CHANNEL_UP ? 1 : -1);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void sendChannelStep(final int delta) {
        final com.getcapacitor.Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;
        // evaluateJavascript exige le thread de l'interface.
        bridge.getWebView().post(new Runnable() {
            @Override
            public void run() {
                if (bridge.getWebView() == null) return;
                bridge.getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('tvchannel',{detail:" + delta + "}))", null);
            }
        });
    }
"""

s = open(P).read()
if "KEYCODE_CHANNEL_UP" in s:
    print("MainActivity.java : relais CHAÎNE +/− déjà présent")
elif "public class MainActivity extends BridgeActivity {}" in s:
    s = s.replace(
        "public class MainActivity extends BridgeActivity {}",
        "public class MainActivity extends BridgeActivity {\n" + METHOD + "}\n",
        1,
    )
    open(P, "w").write(s)
    print("MainActivity.java : relais CHAÎNE +/− ajouté (classe vide)")
else:
    # Corps déjà rempli par les patches précédents : on se greffe juste avant
    # l'accolade fermante de la classe.
    i = s.rstrip().rfind("}")
    if i == -1:
        raise SystemExit("MainActivity.java : accolade fermante introuvable")
    s = s[:i] + METHOD + s[i:]
    open(P, "w").write(s)
    print("MainActivity.java : relais CHAÎNE +/− ajouté")

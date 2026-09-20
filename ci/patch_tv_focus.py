#!/usr/bin/env python3
"""Donne le focus clavier/D-pad à la WebView dès le démarrage (android/ est
régénéré à chaque build, donc ce script tourne à chaque fois).

IMPORTANT : android.webkit.WebSettings n'a PAS de méthode
setSpatialNavigationEnabled — cette API n'existe pas dans le SDK Android
public (une première version de ce script l'appelait, ce qui fait échouer
la compilation avec « cannot find symbol »). Il n'y a d'ailleurs aucune API
native permettant d'activer un déplacement du focus aux flèches à
l'intérieur du contenu d'une WebView : la navigation D-pad entre les
cartes/boutons de la page est entièrement implémentée côté web, voir
www/dpad-nav.js. Ce script ne fait que la partie native indispensable pour
que les touches de la télécommande atteignent seulement la WebView : lui
donner le focus Android au démarrage (setNeedInitialFocus + requestFocus),
sans quoi aucune touche ne lui parvient tant que rien n'a été touché à
l'écran.

Doit tourner APRÈS ci/patch_native_player.py, qui écrit le onCreate de
MainActivity (avec le repère super.onCreate(savedInstanceState); suivi de
applyImmersiveForOrientation(...)) : ce script s'y greffe juste après.
"""

P = "android/app/src/main/java/com/laurent/iptvlecteur/MainActivity.java"

MARKER = "super.onCreate(savedInstanceState);\n        applyImmersiveForOrientation(getResources().getConfiguration().orientation);"

INSERT = """super.onCreate(savedInstanceState);
        // Focus clavier/D-pad initial de la WebView (télécommande TV) : sans
        // ça, aucune touche ne lui parvient tant que l'écran n'a pas été
        // touché. La navigation entre éléments de la page (flèches) est gérée
        // côté web par www/dpad-nav.js — il n'existe pas d'équivalent natif
        // (WebSettings n'a pas de setSpatialNavigationEnabled).
        {
            android.webkit.WebView tvWebView = getBridge() == null ? null : getBridge().getWebView();
            if (tvWebView != null) {
                tvWebView.getSettings().setNeedInitialFocus(true);
                tvWebView.setFocusable(true);
                tvWebView.setFocusableInTouchMode(true);
                tvWebView.requestFocus(android.view.View.FOCUS_DOWN);
            }
        }
        applyImmersiveForOrientation(getResources().getConfiguration().orientation);"""

s = open(P).read()
if "setNeedInitialFocus" in s:
    print("MainActivity.java : focus D-pad initial déjà activé")
elif MARKER in s:
    s = s.replace(MARKER, INSERT, 1)
    open(P, "w").write(s)
    print("MainActivity.java : focus D-pad initial activé")
else:
    raise SystemExit(
        "MainActivity.java : repère super.onCreate(...) introuvable — "
        "ci/patch_native_player.py a-t-il bien tourné avant ce script ?"
    )

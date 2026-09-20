#!/usr/bin/env python3
"""Active la navigation D-pad (flèches de la télécommande) dans la WebView
(android/ est régénéré à chaque build, donc ce script tourne à chaque fois).

Sur Android, WebView.getSettings().setSpatialNavigationEnabled(...) vaut
false par défaut : sans ça, les flèches de la télécommande ne déplacent le
focus sur AUCUN élément de la page (bouton, lien, carte de chaîne...) — ce
n'est pas un bug d'un bouton en particulier (ex. « ⬇ Installer » de la
bannière de mise à jour, injectée par update-check.js) mais l'absence totale
de navigation clavier/D-pad dans la WebView, qui rend tout élément cliquable
inatteignable à la télécommande alors que le CSS prévoit déjà des styles
:focus pour plusieurs d'entre eux (.carte, .now-ligne, .rech-clear...) sans
jamais avoir pu les déclencher.

Doit tourner APRÈS ci/patch_native_player.py, qui écrit le onCreate de
MainActivity (avec le repère super.onCreate(savedInstanceState); suivi de
applyImmersiveForOrientation(...)) : ce script s'y greffe juste après.
"""

P = "android/app/src/main/java/com/laurent/iptvlecteur/MainActivity.java"

MARKER = "super.onCreate(savedInstanceState);\n        applyImmersiveForOrientation(getResources().getConfiguration().orientation);"

INSERT = """super.onCreate(savedInstanceState);
        // Navigation D-pad (télécommande TV) : désactivée par défaut dans la
        // WebView Android — sans ceci, aucune flèche ne déplace le focus, quel
        // que soit l'élément (bouton, lien, carte...). setNeedInitialFocus +
        // requestFocus donnent la main à la page dès l'ouverture, sans qu'il
        // faille d'abord toucher l'écran ou cliquer pour amorcer le focus.
        {
            android.webkit.WebView tvWebView = getBridge() == null ? null : getBridge().getWebView();
            if (tvWebView != null) {
                tvWebView.getSettings().setSpatialNavigationEnabled(true);
                tvWebView.getSettings().setNeedInitialFocus(true);
                tvWebView.setFocusable(true);
                tvWebView.setFocusableInTouchMode(true);
                tvWebView.requestFocus(android.view.View.FOCUS_DOWN);
            }
        }
        applyImmersiveForOrientation(getResources().getConfiguration().orientation);"""

s = open(P).read()
if "setSpatialNavigationEnabled" in s:
    print("MainActivity.java : navigation D-pad déjà activée")
elif MARKER in s:
    s = s.replace(MARKER, INSERT, 1)
    open(P, "w").write(s)
    print("MainActivity.java : navigation D-pad (spatial navigation) activée")
else:
    raise SystemExit(
        "MainActivity.java : repère super.onCreate(...) introuvable — "
        "ci/patch_native_player.py a-t-il bien tourné avant ce script ?"
    )

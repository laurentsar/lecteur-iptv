#!/usr/bin/env python3
"""Écran de lecture natif vraiment plein écran, et zoom de l'image
(android/ est régénéré à chaque build par `cap add android`, donc ce script
tourne à chaque fois — APRÈS patch_native_player.py, dont il complète
l'écran).

- Barres système masquées (barre d'état, barre de navigation) : elles
  restaient affichées dans l'écran natif, qui volait ainsi une bande en haut
  et une sur le côté à la vidéo — et elles partaient aussi à la TV pendant un
  partage d'écran. Un balayage depuis le bord les fait réapparaître un
  instant ; elles se remasquent au retour du focus (après un menu, un
  dialogue, le panneau « Diffuser »).
- Zoom : un téléphone récent est bien plus allongé (20:9) qu'une image TV
  (16:9), d'où deux bandes noires latérales. Double-tap sur la vidéo, ou
  pincer pour écarter/resserrer : bascule entre « image entière » et
  « remplir l'écran » (bords haut/bas rognés). Choix mémorisé.

Idempotent.
"""
PKG_DIR = "android/app/src/main/java/com/laurent/iptvlecteur"

CALL_ANCHOR = "        applyTvOverscanSafeMargin();\n"
CALL_NEW = CALL_ANCHOR + "        setupDisplay();\n"

METHODS_ANCHOR = "    // ---------- Enregistrement ----------"

METHODS = """    // ---------- Plein écran et zoom (voir ci/patch_player_display.py) ----------
    private boolean zoomImage;

    private void setupDisplay() {
        hideSystemBars();
        zoomImage = getSharedPreferences("player", MODE_PRIVATE).getBoolean("zoom", false);
        applyResizeMode();
        final android.view.GestureDetector taps = new android.view.GestureDetector(this,
                new android.view.GestureDetector.SimpleOnGestureListener() {
                    @Override
                    public boolean onDoubleTap(android.view.MotionEvent e) {
                        setZoom(!zoomImage);
                        return true;
                    }
                });
        final android.view.ScaleGestureDetector pinch = new android.view.ScaleGestureDetector(this,
                new android.view.ScaleGestureDetector.SimpleOnScaleGestureListener() {
                    private float total = 1f;

                    @Override
                    public boolean onScaleBegin(android.view.ScaleGestureDetector d) {
                        total = 1f;
                        return true;
                    }

                    @Override
                    public boolean onScale(android.view.ScaleGestureDetector d) {
                        total *= d.getScaleFactor();
                        return true;
                    }

                    @Override
                    public void onScaleEnd(android.view.ScaleGestureDetector d) {
                        if (total > 1.15f) {
                            setZoom(true);
                        } else if (total < 0.87f) {
                            setZoom(false);
                        }
                    }
                });
        // false : le tap simple continue d'afficher/masquer la barre de
        // commandes de PlayerView comme avant.
        playerView.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, android.view.MotionEvent event) {
                pinch.onTouchEvent(event);
                taps.onTouchEvent(event);
                return pinch.isInProgress();
            }
        });
    }

    private void applyResizeMode() {
        playerView.setResizeMode(zoomImage
                ? androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                : androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT);
    }

    private void setZoom(boolean zoom) {
        if (zoom == zoomImage) {
            return;
        }
        zoomImage = zoom;
        getSharedPreferences("player", MODE_PRIVATE).edit().putBoolean("zoom", zoom).apply();
        applyResizeMode();
        Toast.makeText(this, zoom ? "Plein écran (bords rognés) — double-tap pour revenir"
                : "Image entière", Toast.LENGTH_SHORT).show();
    }

    private void hideSystemBars() {
        if (isInPip()) {
            return;
        }
        android.view.Window window = getWindow();
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false);
        androidx.core.view.WindowInsetsControllerCompat controller =
                androidx.core.view.WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setSystemBarsBehavior(
                androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars());
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

"""


def main():
    p = PKG_DIR + "/NativePlayerActivity.java"
    s = open(p).read()
    if "private void setupDisplay()" in s:
        print("NativePlayerActivity : plein écran/zoom déjà présents")
        return
    for anchor, what in ((CALL_ANCHOR, "appel"), (METHODS_ANCHOR, "méthodes")):
        if anchor not in s:
            raise SystemExit("NativePlayerActivity (" + what + ") : point d'insertion introuvable")
    s = s.replace(CALL_ANCHOR, CALL_NEW, 1)
    s = s.replace(METHODS_ANCHOR, METHODS + METHODS_ANCHOR, 1)
    open(p, "w").write(s)
    print("NativePlayerActivity : plein écran et zoom ajoutés")


main()

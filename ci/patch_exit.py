#!/usr/bin/env python3
"""Quitter l'appli = la fermer pour de bon (android/ est régénéré à chaque
build, donc ce script tourne à chaque fois — APRÈS patch_native_player.py,
qui crée le corps de MainActivity, et après patch_radio_background.py /
patch_recorder.py, dont il arrête les services).

Retour depuis l'accueil appelle App.exitApp() (www/app.js), qui ne fait
qu'un finish() de l'activité : Android garde alors le processus en vie, la
carte dans les applis récentes, et le service de radio en arrière-plan
(START_STICKY) peut même relancer l'appli. Sur la Fire TV, Lecteur IPTV
restait ainsi « ouvert » derrière les autres applis.

Ici, la dernière activité qui se termine retire aussi sa tâche des récents
(finishAndRemoveTask), arrête la radio, puis termine le processus. Seule
exception : un enregistrement en cours continue jusqu'au bout (le processus
reste alors en vie pour lui seul). Les enregistrements PROGRAMMÉS ne sont
pas touchés non plus : leur alarme (AlarmManager) relance l'appli à l'heure
dite.

Idempotent.
"""

P = "android/app/src/main/java/com/laurent/iptvlecteur/MainActivity.java"

METHOD = """
    // Quitter = fermer pour de bon (voir ci/patch_exit.py) : pas de carte
    // dans les récents, pas de processus ni de service qui reste derrière.
    private boolean quitteDefinitivement = false;

    @Override
    public void finish() {
        if (isTaskRoot()) {
            quitteDefinitivement = true;
            super.finishAndRemoveTask();
        } else {
            super.finish();
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (!quitteDefinitivement || isChangingConfigurations()) {
            return;
        }
        try {
            stopService(new android.content.Intent(this, RadioPlaybackService.class));
        } catch (Exception e) {
            // pas lancé
        }
        // Enregistrement en cours : il continue jusqu'au bout (service au
        // premier plan, avec sa notification). Le processus reste donc en
        // vie pour lui ; le service s'arrête de lui-même à la fin.
        if (RecordingService.isRunning()) {
            return;
        }
        // Court délai : laisse le système enregistrer l'arrêt des services,
        // sinon un service START_STICKY serait relancé après la fin forcée.
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                android.os.Process.killProcess(android.os.Process.myPid());
                System.exit(0);
            }
        }, 400);
    }
"""

s = open(P).read()
if "quitteDefinitivement" in s:
    print("MainActivity.java : fermeture complète déjà présente")
else:
    i = s.rstrip().rfind("}")
    if i == -1:
        raise SystemExit("MainActivity.java : accolade fermante introuvable")
    s = s[:i] + METHOD + s[i:]
    open(P, "w").write(s)
    print("MainActivity.java : fermeture complète en quittant")

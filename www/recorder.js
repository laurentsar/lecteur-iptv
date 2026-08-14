/* recorder.js — enregistrement DVR : uniquement sur l'APK Android (service
 * natif en avant-plan, RecorderPlugin/RecordingService, continue même appli
 * fermée). Sur PWA/iPhone, aucune fonctionnalité fiable équivalente
 * n'existe (pas d'exécution en arrière-plan garantie) — ce module se
 * contente de signaler l'indisponibilité via isAvailable(). */
(function (global) {
  'use strict';

  function plugin() {
    return global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform() &&
      global.Capacitor.Plugins && global.Capacitor.Plugins.Recorder;
  }

  function isAvailable() { return !!plugin(); }

  function startNow(item, maxDurationMs) {
    var p = plugin();
    if (!p) return Promise.reject(new Error('Enregistrement disponible uniquement sur l’APK Android.'));
    return p.startRecording({ url: item.url, title: item.name, channelKey: item.key || '', maxDurationMs: maxDurationMs || 0 });
  }

  function stop() {
    var p = plugin();
    return p ? p.stopRecording() : Promise.resolve();
  }

  function isRecording() {
    var p = plugin();
    return p ? p.isRecording() : Promise.resolve({ recording: false });
  }

  function schedule(item, startAtMs, endAtMs) {
    var p = plugin();
    if (!p) return Promise.reject(new Error('Programmation disponible uniquement sur l’APK Android.'));
    return p.scheduleRecording({ url: item.url, title: item.name, channelKey: item.key || '', startAtMs: startAtMs, endAtMs: endAtMs });
  }

  function cancelScheduled(id) {
    var p = plugin();
    return p ? p.cancelScheduled({ id: id }) : Promise.resolve();
  }

  function listScheduled() {
    var p = plugin();
    if (!p) return Promise.resolve([]);
    return p.listScheduled().then(function (r) { return (r && r.items) || []; });
  }

  function listRecordings() {
    var p = plugin();
    if (!p) return Promise.resolve([]);
    return p.listRecordings().then(function (r) { return (r && r.items) || []; });
  }

  function deleteRecording(id) {
    var p = plugin();
    return p ? p.deleteRecording({ id: id }) : Promise.resolve();
  }

  // Un fichier local (chemin natif) n'est pas directement chargeable dans la
  // WebView : Capacitor l'expose via un schéma dédié (capacitor://...).
  function playableUrl(filePath) {
    return (global.Capacitor && global.Capacitor.convertFileSrc) ? global.Capacitor.convertFileSrc(filePath) : filePath;
  }

  global.Recorder = {
    isAvailable: isAvailable, startNow: startNow, stop: stop, isRecording: isRecording,
    schedule: schedule, cancelScheduled: cancelScheduled, listScheduled: listScheduled,
    listRecordings: listRecordings, deleteRecording: deleteRecording, playableUrl: playableUrl
  };
})(window);

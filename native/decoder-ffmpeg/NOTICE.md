# Extension FFmpeg (décodage audio AC3/E-AC3/DTS/TrueHD)

Ce dossier vendorise le module `decoder_ffmpeg` d'[AndroidX Media3][media3]
(Apache-2.0), adapté pour être compilé de façon autonome dans ce dépôt (le
module original dépend de projets Gradle internes au monorepo media3 ; ici il
dépend à la place des artefacts Maven publiés `media3-common`,
`media3-decoder` et `media3-exoplayer`).

## Ce qui est inclus

- `src/main/java/androidx/media3/decoder/ffmpeg/` : les classes Java du
  module (`FfmpegAudioRenderer`, `FfmpegAudioDecoder`, `FfmpegLibrary`,
  `FfmpegDecoderException`), copiées sans modification depuis media3 1.4.1.
  `ExperimentalFfmpegVideoRenderer` n'est **pas** inclus (décodage vidéo par
  logiciel non nécessaire ici — seul l'audio pose problème).
- `src/main/jni/ffmpeg_jni.cc` et `CMakeLists.txt` : le pont JNI, copié sans
  modification.
- `src/main/jni/ffmpeg/android-libs/<abi>/*.a` : **FFmpeg précompilé**
  (`libavcodec`, `libavutil`, `libswresample`), voir ci-dessous.

## Build FFmpeg

- Source : [FFmpeg][ffmpeg] branche `release/6.0`, commit
  `3f92512fd1fd6f5e6d6eb45a156c352835314d69`.
- NDK : r26b (recommandation du module media3), `ANDROID_ABI=22` (aligné sur
  le `minSdkVersion` de l'app).
- Décodeurs activés (`ENABLED_DECODERS`) : `ac3 eac3 dca mlp truehd` — les
  formats audio courants sur des rips IPTV que le décodeur matériel Android
  (MediaCodec) ne prend généralement pas en charge. Tout le reste est
  désactivé (`--disable-everything`), y compris démuxeurs, filtres,
  encodeurs : seuls ces cinq décodeurs et le nécessaire pour les faire
  tourner sont compilés.
- Licence : build **LGPL 2.1+** (ni `--enable-gpl` ni `--enable-nonfree`
  passés à `configure`). Le AC3/DTS/TrueHD sont des formats propriétaires
  (Dolby/DTS) ; FFmpeg réimplémente ses propres décodeurs (pas de lien vers
  un SDK propriétaire), ce qui est la pratique courante de l'écosystème
  open-source (VLC, Kodi, etc.) — à usage personnel, sans redistribution
  commerciale.
- Architectures : `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`.

Reproduire ce build (Linux) :

```bash
git clone --depth 1 --branch release/6.0 https://github.com/FFmpeg/FFmpeg.git
git clone --depth 1 --branch 1.4.1 --filter=blob:none --sparse https://github.com/androidx/media.git media3-src
cd media3-src && git sparse-checkout set libraries/decoder_ffmpeg
ln -s "$(pwd)/../FFmpeg" libraries/decoder_ffmpeg/src/main/jni/ffmpeg
cd libraries/decoder_ffmpeg/src/main/jni
./build_ffmpeg.sh "$(pwd)/.." "<chemin NDK r26b>" linux-x86_64 22 ac3 eac3 dca mlp truehd
```

Les `.a` obtenus dans `ffmpeg/android-libs/<abi>/` sont ceux copiés ici.

## Mise à jour

Pour changer les décodeurs activés ou la version de FFmpeg/media3, relancer
le build ci-dessus et remplacer les fichiers `.a` de ce dossier — pas besoin
de toucher au reste du module.

[media3]: https://github.com/androidx/media
[ffmpeg]: https://ffmpeg.org/

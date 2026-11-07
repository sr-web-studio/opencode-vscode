# On-device voice

A free, offline speech engine that runs on the user's own computer. `opencode.voice.engine` = `"local"` (default) or `"soniox"` (the cloud engine with the user's own key, unchanged).

The default is **one multilingual model**: [NVIDIA Nemotron 3.5 ASR Streaming 0.6B](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b) (sherpa-onnx int8 export, 560 ms chunks). It serves English and about 28 other languages, writes cased and punctuated text while you speak, and needs no second "refine" model. **Bangla** is an optional extra pack (Vosk streaming + SayedShaun offline model) for people who need it. What the user picks is a **language** (`src/core/voice-catalog.ts`: `LANGUAGES`); what is downloaded is the **pack** that serves it (`LANGUAGE_PACKS`). Several languages share one pack, so they cost nothing extra.

Attribution: NVIDIA Nemotron 3.5 ASR Streaming 0.6B, OpenMDW-1.1; sherpa-onnx int8 export by csukuangfj. Licence: [OpenMDW-1.1](https://openmdw.ai/license/1-1/); the full text is in `companion/NOTICE`.

> Status: test build. Whether the native addon loads inside VS Code's Electron on Windows was **not** verified when this was written; see [Diagnostics](#diagnostics).

## Active languages and quick switching

- `opencode.voice.localLanguages` is the list of **active** languages (default `["en"]`), at most `opencode.voice.maxLanguages` (default 2, 1 to 5). **The first entry is the current language and the only one that records.** Only one model is loaded at a time; nothing runs in parallel.
- **OpenCode: Choose Voice Language** is a multi-select QuickPick grouped by download ("Multilingual model ≈682 MB, shared by all these languages" and "Bangla, separate download ≈168 MB"). Downloaded packs are marked, broad-coverage languages say "lower accuracy", Mandarin says "weak". Ticking more than the limit asks to keep the first N or choose again. Nothing is downloaded by the picker: the first recording in a language downloads its pack.
- **OpenCode: Switch Voice Language** (and a click on the language label next to the mic, for example `EN`) makes the next active language current (the list rotates). With three or more languages the palette command asks which one; the label always cycles. With one active language the command offers to choose more. Switching is refused while recording.
- The label shows only for the on-device engine. It is a real button: Tab reaches it, Enter or Space switch, the mouse press does not move focus out of the prompt box. The tooltip names the language and, with two or more, says "Click to switch to …".
- **Migration of the old setting.** Earlier versions had one setting, `opencode.voice.localLanguage` (`en` or `bn`). While `localLanguages` is not set, that value is the list (so `bn` stays Bangla, `en` stays English; nothing to do by hand). The first time the user chooses or switches languages, `localLanguages` is written and the old setting is no longer read. The old setting is marked deprecated in `package.json`.
- Packs outside the active list are never deleted automatically. **OpenCode Voice: Remove Downloaded Languages** lists the downloaded packs and deletes the ones the user ticks.
- Cost of `maxLanguages` (also in the setting's description): languages that share the multilingual model cost nothing extra; each extra separate pack (Bangla) costs its download on disk (≈168 MB); only one model is loaded while recording, so RAM and CPU do not grow; switching to a language of another pack reloads the model, measured about 1.6 to 1.7 s for the multilingual model.

## Measurements

Ryzen 5 5600 (6 cores, 12 threads, the machine was busy: load average about 12), sherpa-onnx 2.0.1, Node, int8 export, 100 ms frames fed as fast as the model takes them. RTF is computing time divided by audio time (below 1 keeps up with speech). Test clips: English 6.6 s, 16.7 s and 7.2 s.

| Model | Threads | RTF |
| --- | --- | --- |
| Nemotron 560 ms (shipped) | 1 | 0.45 |
| Nemotron 560 ms (shipped) | **2 (default)** | **0.32 to 0.34** |
| Nemotron 560 ms (shipped) | 4 | 0.78 to 0.88 |
| Nemotron 1120 ms | 1 | 0.28 to 0.30 |
| Nemotron 1120 ms | 2 | 0.24 to 0.30 |
| Nemotron 1120 ms | 4 | 0.40 to 0.49 |

- Model load: 1.6 to 1.7 s (both variants). Memory: about 1020 MB after loading, peak 1060 to 1180 MB.
- First live text appears about 1.3 s into the speech (560 ms model); the 1120 ms model is faster but its text arrives later and it drops the last words more easily. **The 560 ms export is the one shipped** because live text keeps up with RTF 0.32 and arrives sooner. The 1120 ms variant is not needed.
- **2 threads is the default and stays**: 4 threads is slower (the threads compete for memory bandwidth), 1 thread is slower than 2.
- This computer is probably faster than a typical laptop. RTF 0.32 leaves margin, but it has not been tried on slower hardware.

### Language behaviour we measured (560 ms)

- Correct text with casing and punctuation: English, French, German, Spanish, Ukrainian, Vietnamese, Mandarin (explicit language and auto-detect).
- Arabic came out with mistakes; Korean was written without spaces; Japanese was right with an explicit language, but auto-detect gave a Korean first word.
- Hindi: Devanagari text comes out when `hi` is chosen. Bangla speech is not understood by the multilingual model (it writes romanised guesses), which is why Bangla has its own pack.
- **Automatic detection is not the default.** It was wrong for English after long leading silence (the text came out in Devanagari) and for Japanese's first word, so the default language is English. `auto` stays in the list for people who want it.
- Locale per language: the model takes a locale (`en-US`, `es-US`, `fr-FR`, `pt-BR`, `de-DE`, `ja-JP`, `zh-CN`, …; its `tokens.txt` lists them, and sherpa-onnx also accepts the bare code). Where the model has two, we use the widely used one: en-US (not en-GB), es-US (Latin American; es-ES is understood too), fr-FR (not fr-CA), pt-BR (not pt-PT). The language is set once per stream with `onlineStreamSetOption(stream, "language", locale)` (sherpa-onnx v2.0.1 `nodejs-addon-examples/test_asr_streaming_nemotron.js`; `featureDim` is 128) and survives `reset()`.
- A pause without words does **not** reset the stream for the multilingual model (resetting made the next words come out wrong), and recording stop feeds 0.8 s of silence (0.5 s lost last words in Vietnamese).

## How it works

```
mic (pvrecorder, 16 kHz Int16, 100 ms frames)
  → Float32
  → streaming recognizer (Nemotron: a transducer told the spoken language; Bangla: a streaming Zipformer)  → live partial text in the prompt box
  → on a pause (endpoint) or at stop: Bangla only: the segment's audio is decoded again by the pack's offline model
  → appended to the final text; if the offline model fails or is empty the streaming text is kept
```

- Everything runs in the companion's recorder process (`companion/dist/recorder.js`, forked with `ELECTRON_RUN_AS_NODE=1`), never in the extension host, so a native crash cannot take VS Code down. The companion runs on the computer with the microphone, also under Remote SSH.
- The main extension only reads the settings and sends `VoiceStartArgs { engine: "local", localLanguage }` (the current language id, normalized: unknown → `en`; the old values `en` and `bn` are valid ids); no key and no model name are sent. An older caller without `localLanguage` gets English. `AppState.voice = { engine, ready, capture, recording, languages }` (`languages`: the active list, first = current). For `local`, `ready` is true unless the companion reports that this platform has no engine (`CompanionInfo.local === false`). For `soniox`, `ready` means "a key is saved" (today's behaviour).
- Loading the model takes about 1.7 s at recording start (Nemotron; Bangla loads two smaller models). The microphone starts first and its frames are kept and fed once loaded, so the first words are not lost; `listening` is reported after loading.
- After stop: silence is fed (0.8 s for Nemotron, 0.5 s by default; `ModelSpec.tailSeconds`), the stream is finished, the last segment is re-decoded if the pack has an offline model, then exactly one `done`.
- Idle (60 s without new words) and maximum (10 min) caps, silent-microphone detection and abort are the same as for Soniox (shared in `src/companion/shared.ts`).

## What is downloaded, where

Nothing heavy is in the vsix (the companion vsix is 1.7 MB, almost all of it the microphone library for five platforms). When the pack of the current language is not on this computer the companion asks once, e.g. "On-device voice needs a one-time download of about 693 MB (speech engine + multilingual model). Download now?" `[Download] [Choose Language] [Use Soniox instead]` (Escape = cancel), with the models' authors, licences and sources in the message detail, then shows a cancellable progress notification. The size is what is still missing: the speech engine counts only if it is not installed yet (then the text says "multilingual model" only), and a model another pack already downloaded is not counted. Only the `.onnx` and `tokens.txt` files are downloaded; the model repo's `test_wavs/` are not.

Location: the companion's `context.globalStorageUri` on the local computer (for example `%APPDATA%\Code\User\globalStorage\sr-web-studio.opencode-voice\` on Windows), under `local-voice/v1/`:

```
native/sherpa-onnx-<platform>-<arch>-2.0.1/   sherpa-onnx.node + onnxruntime + sherpa libraries   (~8–14 MB download, 23–40 MB on disk)
models/<model id>/                            one folder per model, shared by every pack that uses it
  streaming-nemotron-3.5-0.6b-560ms-ab43d89/  multilingual live model: int8 encoder/decoder/joiner, tokens   (682 MB)
  streaming-bn-vosk-501097a/                  Bangla live model                                              (94 MB)
  offline-bn-sayed-16bec01/                   Bangla final model (int8)                                      (74 MB)
```

The Bangla ids and paths are unchanged from the Bangla-only version, so an existing Bangla download is reused without downloading it again. Each folder has a `ready.json` (file names and sizes). A folder is used only when it exists and every file has the recorded size. To reset, delete `local-voice/` (it is downloaded again), or run **OpenCode Voice: Remove Downloaded Languages** (multi-select; one entry per downloaded pack; deletes the pack's model folders unless another downloaded pack uses the same model; the speech engine stays). **OpenCode: Choose Voice Language** marks the downloaded packs; the companion reports them in its `ping` answer (`CompanionInfo.installedLanguages`, pack ids; an older companion omits it and nothing is marked).

**Cleanup of earlier models.** The English Zipformer and Moonshine models of earlier versions (about 200 MB, folders `streaming-en-zipformer-672fbf1` and `offline-en-moonshine-tiny-bf2b762`) are no longer in the catalog. Once per window, after a recording's engine is ready, the companion deletes model folders the catalog does not list (`removeUnknownModels` in `src/companion/local-install.ts`). It only looks at direct children of `local-voice/v1/models/` and removes a folder only when it is a real directory (not a symlink), its name looks like one we create (`[a-z0-9._-]`), it holds our `ready.json` marker (or is a `<model id>.tmp-<8 hex>` leftover of an interrupted download). Anything else is left alone, nothing outside `models/` is touched, and a failure only goes to the log.

## The language catalog (`src/core/voice-catalog.ts`)

Two lists. **Packs** (`LANGUAGE_PACKS`): `id`, name, a required streaming `ModelSpec`, an optional offline `ModelSpec`, and per model: `kind` (how sherpa-onnx is configured: `transducer` today), `featureDim` (80, Nemotron 128), optional `tailSeconds`, title, author, license + license URL, source URL, Hugging Face repo, pinned commit and files (`path`, on-disk `name`, `role`, size, sha256). Models carry their own id, so two packs that reference the same id download it once. **Languages** (`LANGUAGES`): `id` (ISO 639-1 code, or `auto`), name + native name, the `pack` that serves it, the model `locale` (multilingual packs) and a tier (`ready`, `broad` = lower accuracy, `weak`).

**Add a language of an existing pack**: one line in `LANGUAGES`, plus its id, label and description in `opencode.voice.localLanguages` in `package.json`. **Add a pack** (data only): append a `LanguagePack` to `LANGUAGE_PACKS` and its languages to `LANGUAGES`; list the models in `companion/NOTICE`, `companion/README.md` and this file. `test/unit/voice-catalog.test.ts` checks the catalog (unique ids, every language maps to a pack, `featureDim` per model, pinned 40-hex commits, sha256 and sizes, required roles per kind, licences present in the notices, `package.json` in step). Get size and sha256 from `https://huggingface.co/api/models/<repo>/tree/<rev>?recursive=1` (`lfs.oid` is the sha256; files that are not LFS need hashing after download). **A new model family** (paraformer, Whisper, …) also needs its `ModelKind` and required roles in the catalog and one `case` in `modelConfig` (`src/companion/sherpa.ts`) that maps roles to the addon's fields; a streaming pack needs a kind in `STREAMING_KINDS` (only the transducer streams today).

## Models shipped in the catalog

| Pack | Role | Model | Size | Licence |
| --- | --- | --- | --- | --- |
| Multilingual (default) | live text, cased and punctuated | [NVIDIA Nemotron 3.5 ASR Streaming 0.6B](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b), sherpa-onnx int8 export with 560 ms chunks by csukuangfj (`csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11`, revision `ab43d895f5985b1bbab8b6eac8607fcdc05343f3`) | 682 MB | OpenMDW-1.1 |
| Bangla (optional) | live text | [Vosk small streaming Bengali](https://huggingface.co/alphacep/vosk-model-small-streaming-bn) | 94 MB | Apache-2.0 |
| Bangla (optional) | final text | [bangla-zipformer-onnx](https://huggingface.co/SayedShaun/bangla-zipformer-onnx), int8 | 74 MB | CC BY-SA 4.0 |

Languages of the multilingual pack, by the model card's tiers: transcription-ready: English, Spanish, French, German, Italian, Portuguese, Dutch, Turkish, Russian, Ukrainian, Arabic, Hindi, Japanese, Korean, Vietnamese; broad coverage (lower accuracy, about 23% average word error rate at 560 ms on the model card): Polish, Swedish, Czech, Norwegian Bokmål, Danish, Bulgarian, Finnish, Croatian, Slovak, Hungarian, Romanian, Estonian; Mandarin Chinese (about 19.5% on the card, weak in our test); and automatic detection. The model's adaptation-ready languages (Greek, Lithuanian, Latvian, Maltese, Slovenian, Hebrew, Thai, Nynorsk) do not transcribe out of the box and are not offered.

The old English pair (a streaming Zipformer for live text and Moonshine for final text) was replaced by Nemotron: one model, better text with casing and punctuation while speaking, many languages. The price is size (682 MB instead of about 200 MB) and memory (about 1 GB while recording instead of about 450 MB).

Download rules (`src/companion/local-install.ts`):

- Native engine: the npm tarball `https://registry.npmjs.org/sherpa-onnx-<plat>-<arch>/-/…-2.0.1.tgz` (`win-x64`, `win-arm64`, `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`), verified against the registry's `dist.integrity` (SHA-512, hardcoded in `src/core/local-voice.ts`), then unpacked with a small pure-JS tar reader (`src/core/tar.ts`; refuses `..`, absolute paths, drive letters, links and anything unusual).
- Models: `https://huggingface.co/<repo>/resolve/<revision>/<path>`, pinned to a commit, verified by size and SHA-256 (hardcoded).
- Everything is downloaded to a `.part`/temp name, verified, and only then renamed into place; nothing partial is ever used; a stalled connection (30 s without data) aborts; a failed or cancelled install leaves no half-installed folder, and the next try fetches only what is missing.

## How the native addon is loaded

`sherpa-onnx-node` only searches `node_modules`. We do not ship or bundle it. `src/companion/sherpa.ts` is a small loader that `require()`s `<native dir>/sherpa-onnx.node` by absolute path and wraps the addon calls the two recognizers need (the same calls `sherpa-onnx-node` makes, plus `onlineStreamSetOption` for the spoken language); `modelConfig` turns a model's kind and files into the addon's configuration and `featConfig` gives its feature size. The recorder is forked with the native folder first in `PATH` (Windows), `LD_LIBRARY_PATH` (Linux) or `DYLD_LIBRARY_PATH` (macOS), so the addon finds `onnxruntime` and the sherpa C library even when the OS would not look next to it. On Linux the addon has `RUNPATH=$ORIGIN` (verified). On Windows the DLLs sit next to `sherpa-onnx.node`, which Node's addon loading is expected to find (not verified here; the `PATH` prefix is the fallback).

## Licences and attribution

| Part | Licence |
| --- | --- |
| sherpa-onnx 2.0.1 (native addon, onnxruntime) | Apache-2.0 (onnxruntime: MIT) |
| **NVIDIA Nemotron 3.5 ASR Streaming 0.6B** (`nvidia/nemotron-3.5-asr-streaming-0.6b`; int8 export by csukuangfj) | **OpenMDW-1.1** (model card `license_name: openmdw-1.1`, `license_link` https://openmdw.ai/license/1-1/) |
| Vosk small streaming Bengali model (`alphacep/vosk-model-small-streaming-bn`) | Apache-2.0 |
| **bangla-zipformer-onnx by Sayed Shaun** (`SayedShaun/bangla-zipformer-onnx`, int8 files) | **CC BY-SA 4.0**: attribution required |

Models are downloaded unchanged by the user's own computer from Hugging Face and are never redistributed in the vsix. The download prompt names each model's author, licence and source.

Nemotron: attribution "NVIDIA Nemotron 3.5 ASR Streaming 0.6B, OpenMDW-1.1; sherpa-onnx int8 export by csukuangfj." is shown in the download prompt, `companion/NOTICE`, both READMEs and here. OpenMDW-1.1 asks anyone who *distributes* Model Materials to keep a copy of the agreement and the notices of origin. The vsix does not contain the model, but `companion/NOTICE` (which ships in the companion vsix) carries the **full licence text**, so a copy travels with the extension anyway. The licence puts no restriction on the output text.

The Sayed model is CC BY-SA 4.0. Attribution is shown in the download prompt, `companion/NOTICE`, `companion/README.md` and here: model by Sayed Shaun, <https://huggingface.co/SayedShaun/bangla-zipformer-onnx>, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Output text produced with the model is not a derivative of the model files.

## Diagnostics

Everything goes to the **OpenCode Voice** output channel (also: command **OpenCode Voice: Show Log**). Per recording:

- `Voice engine: local (win32/x64; Electron …, Node …, v8 …, modules …)`
- `Native addon loaded from <path> in N ms (sherpa-onnx 2.0.1, onnxruntime …)`
- `Language en (pack multilingual): streaming model (transducer, 128 features) loaded in N ms (2 threads)`, `Spoken language: en → model locale en-US`, and for Bangla `Offline model loaded in N ms`
- per segment: audio seconds, the streaming text, the offline text, offline decode ms
- `Recording ended: … s audio, N segments; streaming N ms + offline N ms; RTF …; peak RSS … MB`
- download: each file with size, time and "verified"

If the addon fails to load, the log has the full stack, the path that was tried and the library search variable (`PATH` / `LD_LIBRARY_PATH` / `DYLD_LIBRARY_PATH`) of the recorder process; the user sees a short message with a **Show Log** button. If the recorder process dies outright (native crash), the last stderr line is in the message and the full stderr is in the log.

What could go wrong on Windows (untested): a missing Visual C++ runtime (`MSVCP140.dll`/`VCRUNTIME140.dll` not found: the error says "The specified module could not be found"), antivirus quarantining the downloaded `.dll`/`.node`, a Node-API/ABI mismatch with VS Code's Electron Node (the error mentions a module version or `napi`), or a long storage path.

## Known limits

- One language at a time (`opencode.voice.localLanguage`), no mixing. Bangla: English words are written in Bangla script and are sometimes wrong (`রেফাক্টর`, `ইউনিট`); for mixed Bangla/English use the Soniox engine.
- `opencode.voice.languages` (Soniox hints) is only for the Soniox engine. The old one-time "Bangla only" note is gone: it made no sense once the on-device language is chosen by its own setting, and comparing the two settings would warn people who deliberately keep several Soniox hints.
- The streaming models give no punctuation (English: no casing either, shown in lower case); the offline re-decode adds punctuation (and casing for English), but only after a pause or at stop. Live text can differ from the final text (the final one replaces it). English technical words and names are the weak spot of the small English models (the training data is audiobooks).
- The offline model works best on utterances of a few seconds up to ~20 s; very long monologues without a pause are decoded as one segment.
- Built-in laptop microphone arrays: on one Windows laptop ("Microphone Array (AMD Audio Device)", input volume 80) the on-device engine heard no words (peak level ~1000/32767) while a headset worked at once and Soniox had worked on the same microphone. If nothing is heard on a built-in microphone, use a headset (**OpenCode Voice: Choose Microphone**) or the Soniox engine.
- About 3 s to start (model load) and ~450 MB of memory in the recorder process while recording.
- Platforms: the engine exists for Windows x64/arm64, macOS x64/arm64 and Linux x64/arm64; microphone capture exists for all of those except Linux arm64.
- Not verified yet: Windows and macOS (see above). macOS may strip `DYLD_LIBRARY_PATH` for hardened apps; the addon is expected to find its libraries next to itself.
- Settings: `opencode.voice.engine`, `opencode.voice.localLanguage` (default `en`), `opencode.voice.localThreads` (default 2 per model). Commands: **OpenCode: Choose Voice Language**, **OpenCode Voice: Remove Downloaded Languages**.

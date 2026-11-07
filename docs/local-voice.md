# On-device voice

A free, offline speech engine that runs on the user's own computer. `opencode.voice.engine` = `"local"` (default) or `"soniox"` (the cloud engine with the user's own key, unchanged). The language is a **language pack** from a catalog (`src/core/voice-catalog.ts`): English by default, Bangla, and more to be appended as data. The user picks it with **OpenCode: Choose Voice Language** or `opencode.voice.localLanguage`; only that pack is downloaded.

> Status: test build. Whether the native addon loads inside VS Code's Electron on Windows was **not** verified when this was written; see [Diagnostics](#diagnostics).

## How it works

```
mic (pvrecorder, 16 kHz Int16, 100 ms frames)
  → Float32
  → streaming recognizer of the language pack (a streaming Zipformer transducer)  → live partial text in the prompt box
  → on a pause (endpoint) or at stop: the segment's audio is decoded again by the pack's offline model (if it has one)
  → appended to the final text (the offline text has punctuation, and for English casing); if the offline model fails or is empty the streaming text is kept
```

- Everything runs in the companion's recorder process (`companion/dist/recorder.js`, forked with `ELECTRON_RUN_AS_NODE=1`), never in the extension host, so a native crash cannot take VS Code down. The companion runs on the computer with the microphone, also under Remote SSH.
- The main extension only reads the settings and sends `VoiceStartArgs { engine: "local", localLanguage }` (the pack id, normalized: unknown → `en`); no key and no model name are sent. An older caller without `localLanguage` gets English. `AppState.voice = { engine, ready, capture, recording }`. For `local`, `ready` is true unless the companion reports that this platform has no engine (`CompanionInfo.local === false`). For `soniox`, `ready` means "a key is saved" (today's behaviour).
- Loading both models takes about 3 s at recording start. The microphone starts first and its frames are kept and fed once loaded, so the first words are not lost; `listening` is reported after loading.
- After stop: 0.5 s of silence is fed, the stream is finished, the last segment is re-decoded, then exactly one `done`.
- Idle (60 s without new words) and maximum (10 min) caps, silent-microphone detection and abort are the same as for Soniox (shared in `src/companion/shared.ts`).

## What is downloaded, where

Nothing heavy is in the vsix (the companion vsix is 1.7 MB, almost all of it the microphone library for five platforms). When the chosen language is not on this computer the companion asks once, e.g. "On-device voice needs a one-time download of about 205 MB (speech engine + English models). Download now?" `[Download] [Choose Language] [Use Soniox instead]` (Escape = cancel), with the models' authors, licences and sources in the message detail, then shows a cancellable progress notification. The size is what is still missing: the speech engine counts only if it is not installed yet (then the text says "English models" only), and a model another language already downloaded is not counted.

Location: the companion's `context.globalStorageUri` on the local computer (for example `%APPDATA%\Code\User\globalStorage\sr-web-studio.opencode-voice\` on Windows), under `local-voice/v1/`:

```
native/sherpa-onnx-<platform>-<arch>-2.0.1/   sherpa-onnx.node + onnxruntime + sherpa libraries   (~8–14 MB download, 23–40 MB on disk)
models/<model id>/                            one folder per model, shared by every pack that uses it
  streaming-en-zipformer-672fbf1/             English live model: int8 encoder/decoder/joiner, tokens       (73 MB)
  offline-en-moonshine-tiny-bf2b762/          English final model (Moonshine tiny, int8)                    (124 MB)
  streaming-bn-vosk-501097a/                  Bangla live model                                              (94 MB)
  offline-bn-sayed-16bec01/                   Bangla final model (int8)                                      (74 MB)
```

The Bangla ids and paths are unchanged from the Bangla-only version, so an existing Bangla download is reused without downloading it again. Each folder has a `ready.json` (file names and sizes). A folder is used only when it exists and every file has the recorded size. To reset, delete `local-voice/` (it is downloaded again), or run **OpenCode Voice: Remove Downloaded Languages** (multi-select; deletes a language's model folders unless another downloaded language uses the same model; the speech engine stays). **OpenCode: Choose Voice Language** lists the catalog with each language's size and "downloaded" for the ones on this computer; the companion reports them in its `ping` answer (`CompanionInfo.installedLanguages`; an older companion omits it and nothing is marked).

## The language catalog (`src/core/voice-catalog.ts`)

Each pack: `id`, English name + native name, a required streaming `ModelSpec`, an optional offline `ModelSpec`, and per model: `kind` (how sherpa-onnx is configured: `transducer`, `moonshine` today), title, author, license + license URL, source URL, Hugging Face repo, pinned commit and files (`path`, on-disk `name`, `role`, size, sha256). Models carry their own id, so two packs that reference the same id download it once.

**Add a language** (data only): append a `LanguagePack` to `LANGUAGE_PACKS`; add its id, label and description to `opencode.voice.localLanguage` in `package.json`; list the models in `companion/NOTICE`, `companion/README.md` and this file. `test/unit/voice-catalog.test.ts` checks the catalog (unique ids, pinned 40-hex commits, sha256 and sizes, required roles per kind, licences present in the notices, `package.json` in step). Get size and sha256 from `https://huggingface.co/api/models/<repo>/tree/<rev>?recursive=1` (`lfs.oid` is the sha256; files that are not LFS need hashing after download). **A new model family** (paraformer, NeMo, Whisper, …) also needs its `ModelKind` and required roles in the catalog and one `case` in `modelConfig` (`src/companion/sherpa.ts`) that maps roles to the addon's fields; a streaming pack needs a kind in `STREAMING_KINDS` (only the transducer streams today).

## Models shipped in the catalog

| Language | Role | Model | Size | Licence |
| --- | --- | --- | --- | --- |
| English (default) | live text | [Streaming Zipformer English](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26), icefall LibriSpeech, int8, chunk 16, left 64 | 73 MB | Apache-2.0 |
| English | final text | [Moonshine Tiny English](https://github.com/moonshine-ai/moonshine) (`csukuangfj/sherpa-onnx-moonshine-tiny-en-int8`), int8 | 124 MB | MIT |
| Bangla | live text | [Vosk small streaming Bengali](https://huggingface.co/alphacep/vosk-model-small-streaming-bn) | 94 MB | Apache-2.0 |
| Bangla | final text | [bangla-zipformer-onnx](https://huggingface.co/SayedShaun/bangla-zipformer-onnx), int8 | 74 MB | CC BY-SA 4.0 |

English: the streaming model writes ALL CAPS without punctuation (LibriSpeech), so the live text is shown in lower case; at each pause Moonshine re-decodes the segment and gives cased, punctuated text ("After early nightfall, the yellow lamps would light up here and there…"). Considered and not chosen: Whisper tiny.en / base.en int8 (103 / 160 MB, similar text, but 3–6× slower than Moonshine tiny on the same 6.6 s clip in our test), the 20M streaming Zipformer (43 MB, noticeably worse in our test: it missed the first words and misheard "brothels"), the NeMo parakeet 110M (458 MB fp32, int8 repo empty).

Download rules (`src/companion/local-install.ts`):

- Native engine: the npm tarball `https://registry.npmjs.org/sherpa-onnx-<plat>-<arch>/-/…-2.0.1.tgz` (`win-x64`, `win-arm64`, `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`), verified against the registry's `dist.integrity` (SHA-512, hardcoded in `src/core/local-voice.ts`), then unpacked with a small pure-JS tar reader (`src/core/tar.ts`; refuses `..`, absolute paths, drive letters, links and anything unusual).
- Models: `https://huggingface.co/<repo>/resolve/<revision>/<path>`, pinned to a commit, verified by size and SHA-256 (hardcoded).
- Everything is downloaded to a `.part`/temp name, verified, and only then renamed into place; nothing partial is ever used; a stalled connection (30 s without data) aborts; a failed or cancelled install leaves no half-installed folder, and the next try fetches only what is missing.

## How the native addon is loaded

`sherpa-onnx-node` only searches `node_modules`. We do not ship or bundle it. `src/companion/sherpa.ts` is a small loader that `require()`s `<native dir>/sherpa-onnx.node` by absolute path and wraps the 14 addon calls the two recognizers need (the same calls `sherpa-onnx-node` makes); `modelConfig` turns a model's kind and files into the addon's configuration. The recorder is forked with the native folder first in `PATH` (Windows), `LD_LIBRARY_PATH` (Linux) or `DYLD_LIBRARY_PATH` (macOS), so the addon finds `onnxruntime` and the sherpa C library even when the OS would not look next to it. On Linux the addon has `RUNPATH=$ORIGIN` (verified). On Windows the DLLs sit next to `sherpa-onnx.node`, which Node's addon loading is expected to find (not verified here; the `PATH` prefix is the fallback).

## Licences and attribution

| Part | Licence |
| --- | --- |
| sherpa-onnx 2.0.1 (native addon, onnxruntime) | Apache-2.0 (onnxruntime: MIT) |
| Streaming Zipformer English (`csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26`, from icefall) | Apache-2.0 (model card `license: apache-2.0`) |
| Moonshine Tiny English (`csukuangfj/sherpa-onnx-moonshine-tiny-en-int8`, from https://github.com/moonshine-ai/moonshine) | MIT, Copyright (c) Useful Sensors, Inc. (Moonshine AI): the licence file ships in the model repo; the Moonshine licence says English Tiny and Base are MIT |
| Vosk small streaming Bengali model (`alphacep/vosk-model-small-streaming-bn`) | Apache-2.0 |
| **bangla-zipformer-onnx by Sayed Shaun** (`SayedShaun/bangla-zipformer-onnx`, int8 files) | **CC BY-SA 4.0**: attribution required |

Models are downloaded unchanged by the user's own computer from Hugging Face and are never redistributed in the vsix. The download prompt names each model's author, licence and source.

The Sayed model is CC BY-SA 4.0. Attribution is shown in the download prompt, `companion/NOTICE`, `companion/README.md` and here: model by Sayed Shaun, <https://huggingface.co/SayedShaun/bangla-zipformer-onnx>, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Output text produced with the model is not a derivative of the model files.

## Diagnostics

Everything goes to the **OpenCode Voice** output channel (also: command **OpenCode Voice: Show Log**). Per recording:

- `Voice engine: local (win32/x64; Electron …, Node …, v8 …, modules …)`
- `Native addon loaded from <path> in N ms (sherpa-onnx 2.0.1, onnxruntime …)`
- `Streaming model loaded in N ms (2 threads)`, `Offline model loaded in N ms`
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

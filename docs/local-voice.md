# On-device voice (Bangla)

A free, offline speech engine that runs on the user's own computer. `opencode.voice.engine` = `"local"` (default) or `"soniox"` (the cloud engine with the user's own key, unchanged).

> Status: test build. Whether the native addon loads inside VS Code's Electron on Windows was **not** verified when this was written; see [Diagnostics](#diagnostics).

## How it works

```
mic (pvrecorder, 16 kHz Int16, 100 ms frames)
  → Float32
  → streaming recognizer (Vosk small streaming Bangla, Zipformer)  → live partial text in the prompt box
  → on a pause (endpoint) or at stop: the segment's audio is decoded again by the offline model (bangla-zipformer, int8)
  → appended to the final text (with `।` / `?`); if the offline model fails the streaming text is kept
```

- Everything runs in the companion's recorder process (`companion/dist/recorder.js`, forked with `ELECTRON_RUN_AS_NODE=1`), never in the extension host, so a native crash cannot take VS Code down. The companion runs on the computer with the microphone, also under Remote SSH.
- The main extension only reads the setting and sends `VoiceStartArgs { engine: "local" }`; no key and no model name are sent. `AppState.voice = { engine, ready, capture, recording }`. For `local`, `ready` is true unless the companion reports that this platform has no engine (`CompanionInfo.local === false`). For `soniox`, `ready` means "a key is saved" (today's behaviour).
- Loading both models takes about 3 s at recording start. The microphone starts first and its frames are kept and fed once loaded, so the first words are not lost; `listening` is reported after loading.
- After stop: 0.5 s of silence is fed, the stream is finished, the last segment is re-decoded, then exactly one `done`.
- Idle (60 s without new words) and maximum (10 min) caps, silent-microphone detection and abort are the same as for Soniox (shared in `src/companion/shared.ts`).

## What is downloaded, where

Nothing heavy is in the vsix (the companion vsix is 1.7 MB, almost all of it the microphone library for five platforms). On the first local recording the companion asks once: "On-device voice needs a one-time download of about 190 MB (speech engine + Bangla models). Download now?" `[Download] [Use Soniox instead] [Cancel]`, then shows a cancellable progress notification.

Location: the companion's `context.globalStorageUri` on the local computer (for example `%APPDATA%\Code\User\globalStorage\sr-web-studio.opencode-voice\` on Windows), under `local-voice/v1/`:

```
native/sherpa-onnx-<platform>-<arch>-2.0.1/   sherpa-onnx.node + onnxruntime + sherpa libraries   (~8–14 MB download, 23–40 MB on disk)
models/streaming-bn-vosk-501097a/             encoder/decoder/joiner.onnx, tokens.txt             (94 MB)
models/offline-bn-sayed-16bec01/              int8 encoder/decoder/joiner.onnx, tokens.txt        (74 MB)
```

Each folder has a `ready.json` (file names and sizes). A folder is used only when it exists and every file has the recorded size. To reset, delete `local-voice/` (it is downloaded again).

Download rules (`src/companion/local-install.ts`):

- Native engine: the npm tarball `https://registry.npmjs.org/sherpa-onnx-<plat>-<arch>/-/…-2.0.1.tgz` (`win-x64`, `win-arm64`, `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`), verified against the registry's `dist.integrity` (SHA-512, hardcoded in `src/core/local-voice.ts`), then unpacked with a small pure-JS tar reader (`src/core/tar.ts`; refuses `..`, absolute paths, drive letters, links and anything unusual).
- Models: `https://huggingface.co/<repo>/resolve/<revision>/<path>`, pinned to a commit, verified by size and SHA-256 (hardcoded).
- Everything is downloaded to a `.part`/temp name, verified, and only then renamed into place; nothing partial is ever used; a stalled connection (30 s without data) aborts; a failed or cancelled install leaves no half-installed folder, and the next try fetches only what is missing.

## How the native addon is loaded

`sherpa-onnx-node` only searches `node_modules`. We do not ship or bundle it. `src/companion/sherpa.ts` is a small loader that `require()`s `<native dir>/sherpa-onnx.node` by absolute path and wraps the 14 addon calls the two recognizers need (the same calls `sherpa-onnx-node` makes). The recorder is forked with the native folder first in `PATH` (Windows), `LD_LIBRARY_PATH` (Linux) or `DYLD_LIBRARY_PATH` (macOS), so the addon finds `onnxruntime` and the sherpa C library even when the OS would not look next to it. On Linux the addon has `RUNPATH=$ORIGIN` (verified). On Windows the DLLs sit next to `sherpa-onnx.node`, which Node's addon loading is expected to find (not verified here; the `PATH` prefix is the fallback).

## Licences and attribution

| Part | Licence |
| --- | --- |
| sherpa-onnx 2.0.1 (native addon, onnxruntime) | Apache-2.0 (onnxruntime: MIT) |
| Vosk small streaming Bengali model (`alphacep/vosk-model-small-streaming-bn`) | Apache-2.0 |
| **bangla-zipformer-onnx by Sayed Shaun** (`SayedShaun/bangla-zipformer-onnx`, int8 files) | **CC BY-SA 4.0**: attribution required |

The Sayed model is downloaded unchanged by the user's own computer from Hugging Face and is not redistributed in the vsix. Attribution is shown in the download prompt, `companion/NOTICE`, `companion/README.md` and here: model by Sayed Shaun, <https://huggingface.co/SayedShaun/bangla-zipformer-onnx>, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Output text produced with the model is not a derivative of the model files.

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

- Bangla only (`opencode.voice.languages` without `bn` shows a one-time note). English words are written in Bangla script and are sometimes wrong (`রেফাক্টর`, `ইউনিট`).
- The streaming model gives no punctuation; the offline re-decode adds `।` and `?`, but only after a pause or at stop. Live text can differ from the final text (the final one replaces it).
- The offline model works best on utterances of a few seconds up to ~20 s; very long monologues without a pause are decoded as one segment.
- About 3 s to start (model load) and ~450 MB of memory in the recorder process while recording.
- Platforms: the engine exists for Windows x64/arm64, macOS x64/arm64 and Linux x64/arm64; microphone capture exists for all of those except Linux arm64.
- Not verified yet: Windows and macOS (see above). macOS may strip `DYLD_LIBRARY_PATH` for hardened apps; the addon is expected to find its libraries next to itself.
- Settings: `opencode.voice.engine`, `opencode.voice.localThreads` (default 2 per model).

# OpenCode Voice (unofficial)

> **Unofficial.** Made by SR Web Studio; not affiliated with, endorsed by or supported by the OpenCode team.

The microphone half of voice input for the [**OpenCode (unofficial)**](https://marketplace.visualstudio.com/items?itemName=sr-web-studio.opencode-unofficial) extension. You normally don't install it yourself: the OpenCode (unofficial) extension installs it on the computer in front of you when it starts.

VS Code webviews cannot use the microphone, and with Remote SSH the OpenCode extension runs on the server, far from your
microphone. This small extension runs on the computer in front of you (`extensionKind: ui`), records only while the mic
button in the OpenCode prompt box is on and hands the text back to OpenCode. Two engines (setting `opencode.voice.engine`):

- **`local` (default): free, offline, on this computer. One multilingual model for English and about 28 other languages; Bangla is an optional extra pack.**
  The first time, it asks to download once (about 693 MB: the sherpa-onnx speech engine and the multilingual model;
  Bangla alone is about 179 MB) into this extension's storage folder; nothing is uploaded. Keep up to two active
  languages (`opencode.voice.localLanguages`, limit `opencode.voice.maxLanguages`) with **OpenCode: Choose Voice
  Language**; switch with **OpenCode: Switch Voice Language** or the language label next to the mic. Only the first
  active language records, and only one model is loaded at a time. **OpenCode Voice: Remove Downloaded Languages**
  frees the space again. Details, licences and diagnostics:
  [docs/local-voice.md](https://github.com/sr-web-studio/opencode-vscode/blob/main/docs/local-voice.md).
  Runs on Windows x64/arm64, macOS (Apple silicon and Intel) and Linux x64/arm64 (where a microphone can be used).
- **`soniox`: cloud, with your own paid Soniox key.** Better accuracy, mixed languages, many languages. The audio
  is streamed to Soniox.

The on-device models (a pack downloads only when you first use a language of it; every download is checked against a pinned checksum before it is used):

| Pack | Languages | Model |
| --- | --- | --- |
| Multilingual (default, about 682 MB) | English, Spanish, French, German, Italian, Portuguese, Dutch, Turkish, Russian, Ukrainian, Arabic, Hindi, Japanese, Korean, Vietnamese (best accuracy); Polish, Swedish, Czech, Norwegian, Danish, Bulgarian, Finnish, Croatian, Slovak, Hungarian, Romanian, Estonian (lower accuracy); Mandarin (weak); automatic detection | [NVIDIA Nemotron 3.5 ASR Streaming 0.6B](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b), [OpenMDW-1.1](https://openmdw.ai/license/1-1/), sherpa-onnx int8 export by csukuangfj. Writes cased, punctuated text. |
| Bangla (বাংলা) (optional, about 168 MB) | Bangla | Live text: [Vosk small streaming Bengali](https://huggingface.co/alphacep/vosk-model-small-streaming-bn) (Apache-2.0). Final text at each pause: [bangla-zipformer-onnx](https://huggingface.co/SayedShaun/bangla-zipformer-onnx) by **Sayed Shaun** ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)), with punctuation |

Attribution: NVIDIA Nemotron 3.5 ASR Streaming 0.6B, OpenMDW-1.1; sherpa-onnx int8 export by csukuangfj. The licence text is in [NOTICE](NOTICE).

- Your Soniox key stays in the OpenCode extension's secret storage. This extension only gets a key that expires after
  two minutes, one per recording.
- Recording runs in a separate process, so a problem with the audio driver cannot crash VS Code.
- Microphone capture: Windows x64/arm64, macOS (Apple silicon and Intel), Linux x64.
- **Diagnostics:** the "OpenCode Voice" output channel (or **OpenCode Voice: Show Log**) lists the engine, platform, VS Code's
  Electron/Node versions, load times and each recognized segment.

## Window attention

When OpenCode finishes or needs your answer while this VS Code window is not in front, the companion makes the window ask for attention on the computer in front of you (setting `opencode.notifications.os`, `auto` by default; `off` keeps notifications inside VS Code):

- **Windows:** the taskbar button of this window flashes until you bring it to the front. A small PowerShell helper (started on first use, stopped after 10 idle minutes) calls the system's `FlashWindowEx`; nothing is installed and the focus is never moved.
- **Linux (X11):** the window is marked as needing attention with `wmctrl`, else a `notify-send` notification. Wayland: `notify-send` only.
- **macOS:** a system notification (another program cannot bounce VS Code's Dock icon).

Check it with **OpenCode Voice: Test Window Attention**: switch to another window within 5 seconds. The "OpenCode Voice" output channel lists the windows it saw and the one it picked.

Audio capture uses [`@picovoice/pvrecorder-node`](https://github.com/Picovoice/pvrecorder) (Apache-2.0).

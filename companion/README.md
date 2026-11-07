# OpenCode Voice (unofficial)

> **Unofficial.** Made by SR Web Studio; not affiliated with, endorsed by or supported by the OpenCode team.

The microphone half of voice input for the [**OpenCode (unofficial)**](https://marketplace.visualstudio.com/items?itemName=sr-web-studio.opencode-unofficial) extension. You normally don't install it yourself: the OpenCode (unofficial) extension installs it on the computer in front of you when it starts.

VS Code webviews cannot use the microphone, and with Remote SSH the OpenCode extension runs on the server, far from your
microphone. This small extension runs on the computer in front of you (`extensionKind: ui`), records only while the mic
button in the OpenCode prompt box is on and hands the text back to OpenCode. Two engines (setting `opencode.voice.engine`):

- **`local` (default): free, offline, on this computer. English by default; pick another language from the catalog.**
  The first time, it asks to download the language you use (English: about 205 MB once, the sherpa-onnx speech engine
  and two models) into this extension's storage folder; nothing is uploaded. Choose the language with **OpenCode:
  Choose Voice Language** (or the setting `opencode.voice.localLanguage`); only that language is downloaded.
  **OpenCode Voice: Remove Downloaded Languages** frees the space again. Details, licences and diagnostics:
  [docs/local-voice.md](https://github.com/sr-web-studio/opencode-vscode/blob/main/docs/local-voice.md).
  Runs on Windows x64/arm64, macOS (Apple silicon and Intel) and Linux x64/arm64 (where a microphone can be used).
- **`soniox`: cloud, with your own paid Soniox key.** Better accuracy, mixed languages, many languages. The audio
  is streamed to Soniox.

The on-device models (each language downloads only its own; every download is checked against a pinned checksum before it is used):

| Language | Live text | Final text at each pause |
| --- | --- | --- |
| English | [Streaming Zipformer English](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26) (icefall / k2-fsa, Apache-2.0) | [Moonshine Tiny English](https://github.com/moonshine-ai/moonshine) by Useful Sensors / Moonshine AI ([MIT](https://github.com/moonshine-ai/moonshine/blob/main/LICENSE)), cased and punctuated |
| Bangla (বাংলা) | [Vosk small streaming Bengali](https://huggingface.co/alphacep/vosk-model-small-streaming-bn) (Apache-2.0) | [bangla-zipformer-onnx](https://huggingface.co/SayedShaun/bangla-zipformer-onnx) by **Sayed Shaun** ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)), with punctuation |

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

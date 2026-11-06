# OpenCode Voice (unofficial)

> **Unofficial.** Made by SR Web Studio; not affiliated with, endorsed by or supported by the OpenCode team.

The microphone half of voice input for the [**OpenCode (unofficial)**](https://marketplace.visualstudio.com/items?itemName=sr-web-studio.opencode-unofficial) extension. You normally don't install it yourself: the OpenCode (unofficial) extension installs it on the computer in front of you when it starts.

VS Code webviews cannot use the microphone, and with Remote SSH the OpenCode extension runs on the server, far from your
microphone. This small extension runs on the computer in front of you (`extensionKind: ui`), records only while the mic
button in the OpenCode prompt box is on and hands the text back to OpenCode. Two engines (setting `opencode.voice.engine`):

- **`local` (default): free, offline, on this computer. Bangla only for now.** The first time, it asks to download about
  190 MB once (the sherpa-onnx speech engine and two Bangla models) into this extension's storage folder; nothing is
  uploaded. Details, licences and diagnostics: [docs/local-voice.md](https://github.com/sr-web-studio/opencode-vscode/blob/main/docs/local-voice.md).
  Runs on Windows x64/arm64, macOS (Apple silicon and Intel) and Linux x64/arm64 (where a microphone can be used).
- **`soniox`: cloud, with your own paid Soniox key.** Better accuracy, mixed Bangla/English, many languages. The audio
  is streamed to Soniox.

The on-device models: [Vosk small streaming Bengali](https://huggingface.co/alphacep/vosk-model-small-streaming-bn)
(Apache-2.0, live text) and [bangla-zipformer-onnx](https://huggingface.co/SayedShaun/bangla-zipformer-onnx) by
**Sayed Shaun** ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), the final text with punctuation).
Every download is checked against a pinned checksum before it is used.

- Your Soniox key stays in the OpenCode extension's secret storage. This extension only gets a key that expires after
  two minutes, one per recording.
- Recording runs in a separate process, so a problem with the audio driver cannot crash VS Code.
- Microphone capture: Windows x64/arm64, macOS (Apple silicon and Intel), Linux x64.
- **Diagnostics:** the "OpenCode Voice" output channel (or **OpenCode Voice: Show Log**) lists the engine, platform, VS Code's
  Electron/Node versions, load times and each recognized segment.

Audio capture uses [`@picovoice/pvrecorder-node`](https://github.com/Picovoice/pvrecorder) (Apache-2.0).

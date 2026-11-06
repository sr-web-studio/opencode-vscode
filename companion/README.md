# OpenCode Voice (unofficial)

> **Unofficial.** Made by SR Web Studio; not affiliated with, endorsed by or supported by the OpenCode team.

The microphone half of voice input for the [**OpenCode (unofficial)**](https://marketplace.visualstudio.com/items?itemName=sr-web-studio.opencode-vscode) extension. You normally don't install it yourself: the OpenCode (unofficial) extension installs it on the computer in front of you when it starts.

VS Code webviews cannot use the microphone, and with Remote SSH the OpenCode extension runs on the server, far from your
microphone. This small extension runs on the computer in front of you (`extensionKind: ui`), records only while the mic
button in the OpenCode prompt box is on, streams the audio to Soniox and hands the text back to OpenCode.

- Your Soniox key stays in the OpenCode extension's secret storage. This extension only gets a key that expires after
  two minutes, one per recording.
- Recording runs in a separate process, so a problem with the audio driver cannot crash VS Code.
- Supported: Windows x64/arm64, macOS (Apple silicon and Intel), Linux x64.

Audio capture uses [`@picovoice/pvrecorder-node`](https://github.com/Picovoice/pvrecorder) (Apache-2.0).

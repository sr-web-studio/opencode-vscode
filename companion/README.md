# OpenCode Voice

The microphone half of voice input for the **OpenCode** extension.

VS Code webviews cannot use the microphone, and with Remote SSH the OpenCode extension runs on the server, far from your
microphone. This small extension runs on the computer in front of you (`extensionKind: ui`), records only while the mic
button in the OpenCode prompt box is on, streams the audio to Soniox and hands the text back to OpenCode.

- Your Soniox key stays in the OpenCode extension's secret storage. This extension only gets a key that expires after
  two minutes, one per recording.
- Recording runs in a separate process, so a problem with the audio driver cannot crash VS Code.
- Supported: Windows x64/arm64, macOS (Apple silicon and Intel), Linux x64.

Audio capture uses [`@picovoice/pvrecorder-node`](https://github.com/Picovoice/pvrecorder) (Apache-2.0).

# Changelog

## 0.3.6 (preview)

- **OpenCode: Set Server Password** (was "Set Remote Server Password"). It names the server it is for, and explains that OpenCode on this computer needs no password.
- `opencode.serverUrl` shows examples (LAN, Tailscale, HTTPS domain). `http://` is added when left out, and a malformed address gets a clear message.

## 0.3.5 (preview): first public release

The first release on the VS Code Marketplace and Open VSX.

- Chat with OpenCode V2 sessions of the open workspace folder. Sessions live on the OpenCode server and keep running when VS Code is closed.
- Compact tool lines, folded finished steps, collapsible reasoning, a distinct user bubble, a sticky prompt and a floating task list.
- Messages sent while the agent works steer the running turn. Prompts queued by other clients show **Send now** / **Remove**.
- File paths open in the editor (images too). Edits open as native VS Code diffs, with a **Changes (N files)** link per turn.
- Agent shell commands are mirrored into read-only terminals that never steal focus. Ctrl+C stops the running command.
- Inline permissions and question forms; agent and model picker; session switcher with pins; background workers as a header chip, each opening read-only.
- Notifications when OpenCode needs you or finishes work.
- Voice input with your own Soniox key (Bangla, English and more), recorded by the companion **OpenCode Voice (unofficial)**, which installs itself. Microphone permission check, **Choose Microphone**, and a clear message when the microphone sends only silence.
- Sessions are listed by OpenCode project, so subfolders and differently spelled Windows paths are found.

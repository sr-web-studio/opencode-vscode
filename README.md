# OpenCode (unofficial) for VS Code

> **Unofficial.** This extension is made by SR Web Studio and is not affiliated with, endorsed by or supported by the OpenCode team. "OpenCode" is the name of their project, used here only to say what this extension works with. Official extensions: [OpenCode](https://marketplace.visualstudio.com/items?itemName=sst-dev.opencode).

A chat panel for [OpenCode](https://opencode.ai) V2 in the VS Code sidebar. Your sessions live on the OpenCode server, so they keep running when you close VS Code, and you find them again when you come back.

## Why I built this

I'm a big OpenCode fan. I run OpenCode as a service on a machine that is on 24/7, so I can open my sessions from anywhere, my laptop or my phone, and pick each one up exactly where it is, even hours later.

What I badly missed was the VS Code editor around it: opening files, native diffs, the terminal, all next to the chat. So I built this extension for myself, and it now helps me every day. Maybe it helps you too.

I'm also working on an Android app with the same UI, for the same always-on setup.

**Preview:** this is an early release. Please report problems in [Issues](https://github.com/sr-web-studio/opencode-vscode/issues).

## Features

- **Chat** with the sessions of the open workspace folder. Compact one-line tool calls with details on click, finished turns folded into "N steps completed", collapsible reasoning.
- **Steer while it works:** a message sent while the agent is busy joins the running turn.
- **Editor integration:** file paths open in the editor (images too), and edits open as native VS Code diffs.
- **Terminal:** shell commands the agent runs show up in a read-only VS Code terminal, without stealing focus. Ctrl+C stops the running command, after asking.
- **Permissions and questions** inline: `Allow · Always · Deny`, and question forms that stay fully readable.
- **Agent and model picker**, session switcher, pinned sessions, a floating task list, and background workers in a header chip. Click a worker to open it read-only.
- **Notifications** when OpenCode needs you or finishes work.
- **Voice input** (optional, free with your own key): speak Bangla, English or many other languages into the prompt box. See [Voice input](#voice-input).

OpenCode stays in charge: models, providers, MCP servers, skills, agents and all configuration come from your OpenCode setup. The extension never changes OpenCode's configuration and never stops or restarts the OpenCode service.

## Requirements

- VS Code 1.144 or newer.
- [OpenCode](https://opencode.ai) V2 installed, so the `opencode` command works. If it is missing, the panel shows how to install it. You can also set **OpenCode: Set CLI Path**.
- An OpenCode server. If none is running, the extension starts OpenCode's shared background service (`opencode serve --service`), which keeps running on its own. To use a server elsewhere, set `opencode.serverUrl` and run **OpenCode: Set Remote Server Password**.

The workspace folder you open is the OpenCode project.

## Voice input

Voice input uses [Soniox](https://soniox.com) speech-to-text with **your own API key**; there is no paid tier here. Soniox charges you directly for what you use.

1. Create a key in the [Soniox console](https://console.soniox.com).
2. Run **OpenCode: Set Voice API Key (Soniox)**. The key is checked, then stored in VS Code's secret storage.
3. Click the mic in the prompt box, speak, and click again to stop. The text is added to the prompt; nothing is sent until you press Enter.

The mic button stays dimmed until a key is set. Recording is done by the small companion extension **OpenCode Voice (unofficial)**, which is installed automatically on the computer in front of you, also when you work over Remote SSH. On first use it checks the microphone permission and tells you how to fix it if it is blocked. Use **OpenCode Voice: Choose Microphone** to pick a device.

Set your languages in `opencode.voice.languages` (default: `bn`, `en`). They are hints; other languages are still recognized.

## Settings

Open Settings and search for **OpenCode**:

| Setting | What it does |
| --- | --- |
| `opencode.serverUrl` | URL of a remote OpenCode server. Empty: use the local shared service. |
| `opencode.cliPath` | Path to `opencode`. Empty: `PATH`, then `~/.opencode/bin`. |
| `opencode.transcript.*` | Fold finished steps, expand tool details, reasoning display, font size. |
| `opencode.todo.defaultExpanded` | Show the task list expanded. |
| `opencode.notifications.*` | Which events notify you, and whether to notify while the window is focused. |
| `opencode.terminal.*` | When to reveal terminals, one per session or per command, how many to keep open. |
| `opencode.voice.languages`, `opencode.voice.model` | Voice input languages and Soniox model. |

## Privacy

- The extension talks only to your OpenCode server and, for voice input, to Soniox.
- Audio is recorded only while the mic button is on. Your Soniox key stays in VS Code's secret storage; the recorder receives a key that expires after two minutes, one per recording.
- No telemetry.

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## License

MIT. Not affiliated with the OpenCode team.

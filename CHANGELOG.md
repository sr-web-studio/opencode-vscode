# Changelog

## Unreleased

- **Open Global Config:** a gear in the OpenCode view's title bar, **Edit config** at the bottom of the MCP servers panel, or **OpenCode: Open Global Config** opens your global OpenCode config (`~/.config/opencode/opencode.json` or `.jsonc`) in the editor. The extension only opens it; if there is none yet it asks before creating one with just the schema line. When the server runs on another computer, it tells you the config is there instead of opening a file on this one.
- **A failed turn shows its error once.** When a step and the turn failed with the same message (for example a provider refusing a model), the message appeared twice; now only the turn's error line shows it.

## 0.3.7 (preview)

### Voice input
- **Free on-device voice input is now the default engine** (`opencode.voice.engine`: `local`). No key and no account; after a one-time download it works offline on your own computer.
- **One multilingual model** (NVIDIA Nemotron 3.5 streaming, about 690 MB once, checksum-verified) speaks **English by default and 27 more languages** (Spanish, French, German, Italian, Portuguese, Dutch, Turkish, Russian, Ukrainian, Arabic, Hindi, Japanese, Korean, Vietnamese, Polish, Swedish, Czech, …), with casing and punctuation, live while you speak. It needs about 1 GB of memory while recording.
- **Bangla** is an optional extra pack (about 170 MB), downloaded only if you choose it.
- **Up to two active languages** by default (`opencode.voice.maxLanguages`, up to 5). Pick them with **OpenCode: Choose Voice Language**; switch with the `EN`/`BN` label next to the mic (it never takes focus from the prompt) or **OpenCode: Switch Voice Language**. Only one model runs at a time, so more languages cost disk space, not memory.
- **OpenCode Voice: Remove Downloaded Languages** frees the space of languages you no longer use. Models of the earlier test versions are cleaned up automatically.
- Soniox with your own key stays available as the `soniox` engine, for mixed-language speech.
- A built-in laptop microphone array can be too faint for the on-device engine; a headset works.
- The companion **OpenCode Voice** is only ever upgraded, never downgraded, so two installed copies of the extension no longer keep reinstalling each other's companion and asking for a reload.

### Workers (subagents)
- **Each worker shows its model**, e.g. `Developer · Sonnet 5.5 High`, in the worker panel, the worker tab header and the worker's row in the conversation.
- **Stop a worker:** a stop button on each running worker in the worker panel, on its row in the conversation, and in the worker tab header. Only that worker stops; the lead gets a "cancelled" result and keeps going.
- **Spot a stuck worker:** a running worker that has been quiet for over a minute shows `· quiet 5m`.
- **Remove finished workers from the panel:** an `x` on each done, failed or stopped worker, and **Clear done** for all of them at once. This only hides them in the panel (remembered per session); nothing is deleted on the OpenCode server, and a worker that runs again shows up again.
- Worker tabs share one editor group instead of opening a new split each time.

### Conversation
- **Tool rows: the whole row is the action.** File rows open the file (a Read at the line it read from, an Edit or Patch at the first changed line), link rows open in the browser, other rows show their details. The chevron at the end, or Alt-click, shows details.
- **Code rows** (OpenCode's Code Mode, `execute`) show which MCP tools the script calls, e.g. `exa.web_search_exa, chrome.new_page`, with the script and its output in the details.
- **Code blocks** wrap long lines instead of scrolling sideways, and have a **Copy** button (on hover or focus, always on touch screens) plus the language label.
- **Readable width:** in a wide editor tab the conversation stays at a comfortable reading width (860 px, centred).

### Prompt box and MCP
- **Slash commands:** type `/` for a popup of OpenCode commands and skills. Built in: `/mcps`, `/compact`, `/undo`, `/redo`, `/fork`, `/skills`. The popup never takes focus.
- **MCP servers panel** (`/mcps`, **OpenCode: MCP Servers**, or the chip in the footer): status of each server, turn it on or off for the running server, and sign in or out of OAuth servers.

### Notifications
- **The window asks for attention** when OpenCode finishes or needs you and the window is not focused: the taskbar button flashes on Windows, the window is marked urgent on Linux X11, and macOS shows a notification. Done by the OpenCode Voice companion on your computer; it never steals focus. Turn it off with `opencode.notifications.os: off`, try it with **OpenCode Voice: Test Window Attention**.

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

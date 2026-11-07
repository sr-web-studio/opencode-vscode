# Changelog

## Unreleased

- **Stop a worker:** a stop button on each running worker in the worker panel, on its row in the transcript, and in the worker tab header. Only that worker stops; the lead gets a "cancelled" result and keeps going. A running worker that has been quiet for over a minute shows `· quiet 5m`, so a stuck one is easy to spot.
- **Workers show their model**, e.g. `Developer · Sonnet 5.5 High`, in the worker panel, the worker tab header and the transcript's worker rows.
- **Remove finished workers from the panel:** an `x` on each done, failed or stopped worker, and **Clear done** to remove them all at once. This only hides them in the panel (remembered per session); nothing is deleted on the OpenCode server, and a worker that runs again shows up again.
- **The window asks for attention** when OpenCode finishes or needs you and the window is not focused: the taskbar button flashes on Windows (like Copilot Chat), the window is marked urgent on Linux X11, and macOS shows a notification. Done by the OpenCode Voice companion on your computer; never steals focus. Turn off with `opencode.notifications.os: off`. Try it with **OpenCode Voice: Test Window Attention**.
- **Tool rows: the whole row is the action.** File rows open the file (a Read at the line it read from, an Edit or Patch at the first changed line), link rows open in the browser, other rows show their details. The chevron at the end, or Alt-click, shows details.
- **Code rows** (OpenCode's Code Mode, `execute`) show which MCP tools the script calls, e.g. `exa.web_search_exa, chrome.new_page`, and the script with its output in the details.
- **Free on-device voice input**, now the default engine (`opencode.voice.engine`: `local`). One multilingual model (NVIDIA Nemotron 3.5 streaming, about 690 MB once, checksum-verified) speaks English by default and 27 more languages (Spanish, French, German, Hindi, Arabic, Japanese, …) with casing and punctuation, live while you speak. Bangla is an optional extra pack (about 170 MB). Keep up to `opencode.voice.maxLanguages` (default 2) active languages, chosen with **OpenCode: Choose Voice Language**, and switch with the `EN`/`BN` label next to the mic (or **OpenCode: Switch Voice Language**); only one model runs at a time, so more languages cost disk, not memory. Needs about 1 GB of memory while recording. **OpenCode Voice: Remove Downloaded Languages** frees the space. Soniox with your own key stays available as the `soniox` engine. A built-in laptop microphone may be too faint for it; a headset works.
- **OpenCode Voice is only ever upgraded**, never downgraded: two installed copies of the extension no longer keep reinstalling their own version and asking for a reload.
- **Code blocks** in answers wrap long lines instead of scrolling sideways, and have a **Copy** button (shown on hover or focus, always on touch screens) plus the language label.
- **Slash commands** in the prompt box: type `/` for a popup of OpenCode commands and skills. Built in: `/mcps`, `/compact`, `/undo`, `/redo`, `/fork`, `/skills`. The popup never takes focus.
- **MCP servers panel** (`/mcps`, **OpenCode: MCP Servers**, or the chip in the footer): status of each server, turn it on or off for the running server, and sign in or out of OAuth servers.

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

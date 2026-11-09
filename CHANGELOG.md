# Changelog

## Unreleased

- **Sessions sidebar.** An OpenCode icon in the left sidebar lists the sessions of the folder (and, with several folders, the folders as projects), the ones that need you or are running first, then the newest, with a spinning icon while a session runs. Click one to open it in the chat; right-click to delete it (after the usual confirmation) or to rename a project.
- **Android app: one drawer for every project and session.** The menu button (top left) opens a list of all projects and their sessions, the ones that need you or are running first, then the newest, with a moving icon while a session runs. Tap a session to open it. While the drawer is open, rows stay in place so a tap never lands on the wrong one; the next open sorts again.

## 0.3.13 (preview)

- **Project names from OpenCode.** The folder dropdown shows the name a project has in OpenCode, and **OpenCode: Rename Project…** (also in the dropdown and on the Settings page) renames it; a rename in the browser UI or on the phone shows up live. Only the display name on the server changes, never the folder or the OpenCode config.
- **Android app: project names, and renaming from the phone.** The Projects screen shows the name OpenCode has for each folder's own project (not an older record's name), and a pencil on a project row or in the session list header renames it. A rename in the browser UI or in VS Code updates the phone live while a project is open; the Projects list reloads when you come back to it.
- **Android app: a worker's question can be answered from its notification.** The worker screen now shows the worker's own pending question and permission, so tapping a worker's question notice leads to a screen where you can answer it; the notice names the parent session. The VS Code worker tab stays transcript-only.
- **Android app: worker sessions are read-only everywhere.** A notification tap, a deep link or any other route to a child session now opens the read-only worker screen (with the parent's chat under it), never a writable chat; the prompt box can no longer send to a worker.
- **Android app: worker notifications are off by default.** A worker finishing or failing no longer notifies unless **Workers** is switched on in Settings (existing installs are migrated once). A worker's permission request or question is still announced, because it blocks the parent turn; tapping it opens the worker screen.

## 0.3.12 (preview)

- **Polish also fixes sentence structure.** Enhance prompt → Polish now splits run-on sentences, reorders clumsy phrasing and joins fragments, besides grammar, spelling and dictation errors, while keeping the order of your ideas.
- **Pictures the agent reads.** A `read` of an image shows a thumbnail in the tool's details (a large picture shows an **Open picture** link instead). On the phone, tapping it opens the picture, also when it is outside the project, for example a screenshot in `/tmp`.
- **Android app: long lines wrap.** The file viewer and diffs no longer scroll sideways; long lines and URLs wrap at the screen width and the line numbers stay in place.
- **Multi-root workspaces.** With two or more folders open, a dropdown at the top of the chat switches between them; each folder has its own sessions and keeps its own unsent prompt and attachments. Sessions, notifications, terminals and workers keep running in every folder, and the dropdown marks a folder that is busy or needs you.
- **Minimum width for the chat view.** When the view opens narrower than `opencode.view.minWidth` (default 380 px, `0` turns it off), it tries to widen itself once per window. VS Code has no API for the side bar width, so this is best effort; if it stays narrow, bind a key to `workbench.action.increaseViewSize` with `"when": "auxiliaryBarFocus"`.
- **OpenCode Settings page.** The gear in the chat's title bar (or **OpenCode: Open Settings**) opens one page for every `opencode.*` setting, with search, a reset per setting and live updates. It also shows whether the server password and the voice key are set (never their values), the Enhance prompt model with a reset to the server default, buttons that open the global or the project OpenCode config, quick actions (pair a phone, reconnect, voice language) and About. It is the only gear in the title bar; **OpenCode: Open Global Config** and the new **OpenCode: Open Project Config** stay in the Command Palette.
- **A smaller Enhance prompt menu.** The menu above the prompt box (Polish, Rewrite, model) uses the compact row height of the other pickers and never grows wider than the prompt box; rows stay finger-sized on the phone.
- **Android app: a full Settings screen.** Transcript text size, how steps, reasoning and the todo list show, the Enhance prompt model per server (with a reset to the server default), notifications and battery, server and pairing shortcuts, and About. "Reset app settings" never deletes servers, sessions or passwords.

## 0.3.11 (preview)

- **Enhance prompt.** The sparkle button in the prompt box turns a rough or dictated message into a clear prompt: **Polish** fixes grammar, spelling, punctuation and speech-to-text slips while keeping every technical detail, and **Rewrite** turns it into a detailed, well-structured prompt for the agent. The result replaces the text in the box, with **Undo** until you edit or send, and a notice instead of an overwrite if you changed the prompt while it ran. It is one stateless model call (OpenCode 2.2 or newer): only the prompt text is sent, never files, images or session history, and it never changes the session's agent or model. Pick the model for it in the button's menu; by default the server's default model is used.
- **Pair Mobile Device is clearer.** The address picker now says these are the OpenCode server's addresses, never the phone's; it labels Wi-Fi/LAN, Tailscale, public and container addresses and puts the one this window uses first. The QR panel shows the address, the three steps and a "Phone can't connect?" hint. A new guide, [Connect the Android app](https://github.com/sr-web-studio/opencode-vscode/blob/main/docs/mobile-setup.md), covers the server setup end to end (listen on `0.0.0.0`, port, password, firewall, Tailscale).
- **A worker keeps streaming after it moves to its own folder.** A worker that moves its session into a worktree (or any other folder) went on working, but its tab, its row in the conversation and its notifications stopped updating until the tab was reopened. Live events now follow the session, not the folder it runs in.
- **The transcript no longer gives two turns the same list key.** After a compaction dropped earlier turns from the view, a new turn could reuse the key of the one still shown, which froze the conversation until it was reopened.

## 0.3.10 (preview)

- **Pair Mobile Device:** **OpenCode: Pair Mobile Device…** shows a QR code (LAN or Tailscale address, one-time code valid for 5 minutes) that the Android app scans to connect. It never exposes the server to the internet.
- **Android app (beta), a separate download.** The phone app is not part of this extension; its APK is published as a beta pre-release on [GitHub Releases](https://github.com/sr-web-studio/opencode-vscode/releases). See the README.
- **A stopped command reads calmly.** Stopping a running shell command from its terminal made the tool row show the raw `Shell.NotFoundError`; it now says "The command was stopped."
- **The terminal badge stays correct.** When a turn of the open session ends, the list of running commands is refreshed from the server, so a stopped command no longer keeps counting.

## 0.3.9 (preview)

- **Compaction shows while it runs.** `/compact` (and an automatic compaction when the context is full) now shows a "Compacting conversation…" line with a spinner and the time so far; the summary being written can be opened. When it is done the line becomes the usual "Context compacted" line. A failed compaction shows its error, and a stopped one shows "Compaction cancelled".
- **Turn-finished notifications are more reliable.** A finished or failed turn of a session listed in this window now always counts as this project's, even when the server spells the folder differently, so its notification and taskbar flash are no longer dropped. Every notification decision (shown, dropped and why, attention requested or skipped) is logged at debug level in the OpenCode output channel.

## 0.3.8 (preview)

- **Open Global Config:** a gear in the OpenCode view's title bar, **Edit config** at the bottom of the MCP servers panel, or **OpenCode: Open Global Config** opens your global OpenCode config (`~/.config/opencode/opencode.json` or `.jsonc`) in the editor. The extension only opens it; if there is none yet it asks before creating one with just the schema line. When the server runs on another computer, it tells you the config is there instead of opening a file on this one.
- **Delete a session:** a trash icon on each row of the session list (or the Delete key on the highlighted row), or **OpenCode: Delete Session…**. It always asks first, and deletes the session and its workers on the server for every client. Running sessions, sessions with a running worker and sessions waiting for your answer cannot be deleted. The extension never deletes anything on its own.
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

# Architecture

How the pieces in this repository fit together. For setup, checks and release steps see
[DEVELOPMENT.md](DEVELOPMENT.md) and [PUBLISHING.md](PUBLISHING.md); for the workspace layout see
[monorepo.md](monorepo.md).

The project ships three clients for one [OpenCode](https://opencode.ai) V2 server:

- a VS Code extension with the OpenCode Voice companion,
- an Android app (Capacitor),
- an optional server plugin that sends phone push notifications through ntfy.

The OpenCode server owns sessions, models, providers, MCP servers, skills, agents, permissions and all
configuration. Every client here is a view onto that state and a way to send it commands.

## Principles

1. **OpenCode owns its configuration.** The clients never write it. The only command that touches the
   global config opens the file in an editor for the user to edit; it never saves changes itself.
2. **A client never stops or restarts the OpenCode service.** Closing VS Code, the app or a terminal
   window must not affect a running session. If no service is running, the extension may ask OpenCode to
   start its own detached shared service; it never starts a child process tied to the client.
3. **No session is deleted without an explicit, confirmed user action.** Events, timers, cleanup and
   startup never delete, archive or rename anything. Delete exists in the UI behind a modal confirmation,
   and it deletes on the server for every client, including the session's workers.
4. **Reconnect means re-reading state.** Nothing that the server already holds is cached across a
   reconnect. The event stream carries deltas; the client resynchronises when the stream reopens.

## Packages and boundaries

| Package | Contents | May import |
| --- | --- | --- |
| `packages/core` (`@occ/core`) | API/state layer on `@opencode/client`, transcript reducer, forms, notifications, session/model/command logic, `Controller` | `@opencode/client` root entry only. No `vscode`, no `node:*`. |
| `packages/ui` (`@occ/ui`) | Svelte 5 components and the `HostBridge` interface | `@occ/core`. No `vscode`, no `node:*`. |
| `apps/vscode` | Extension host, webview entry and the VS Code bridge, OpenCode Voice companion | everything, including `@opencode/client/service` |
| `apps/mobile` | Capacitor shell, screens, Android bridge and the native notification service | `@occ/core`, `@occ/ui`, Capacitor plugins |
| `plugins/opencode-push` | Standalone OpenCode server plugin (TypeScript, no build step) | `@opencode/plugin` at runtime |

The UI talks to its platform only through `HostBridge`: opening files and diffs, showing a terminal,
opening external links, notifications, storage and host requests. VS Code and Android each implement it.
`test/unit/boundaries.test.ts` enforces the import rules on every test run: `core` and `ui` may not
import `vscode` or Node built-ins, `core` may not import another workspace package, and `ui` may import
only `@occ/core` from the workspace.

`packages/core` contains the controller that both clients embed. It holds connection state, the session
list, the transcript, pending permissions and forms, workers, commands and MCP state. It is pure
TypeScript: the same code runs in the VS Code webview and inside the Android WebView.

## Connecting and authenticating

- **Local server.** `Service.discover()` finds the registered shared service. If there is none, the
  extension checks that the `opencode` binary exists and lets `Service.ensure()` start
  `opencode serve --service`. The service is detached and shared with every other client, so it keeps
  running when the extension closes.
- **Remote server.** `opencode.serverUrl` is used as-is. The password is stored in VS Code's
  `SecretStorage` and sent as HTTP Basic auth with the user name `opencode`.
- **Pairing.** The extension calls `POST /api/pair`, which returns a one-time code and its lifetime
  (five minutes). It shows `<base URL>/auth/connect/<code>` as a QR code, where the base URL is one the
  phone can reach (LAN, Tailscale or a public address). The app redeems the link and receives a session
  token, which it stores as the profile's password. The token is never put in the link, and the code is
  never logged.
- **Android.** The same Basic auth header is built by hand (`opencode:<password>`), because the native
  service does not use the JavaScript client.

## The event stream

The server exposes `GET /api/event` as a server-sent event stream. It is **live-only**: there is no
replay, so a client that was disconnected does not receive what it missed. Every client therefore:

1. opens the stream,
2. reads the current state over HTTP (session list, messages, pending requests, shells),
3. applies the deltas that arrive from then on,
4. resynchronises from step 2 whenever the stream reopens.

The stream sends a keepalive about every 15 seconds. The extension treats 45 seconds of silence as a
stale connection and reconnects with exponential backoff. The Android service uses a 60-second read
timeout for the same purpose and reconnects with backoff; it also reconnects immediately when the
network changes.

The Android notification service asks for only the event types it needs (permissions, forms, turn ends,
session deletion), which keeps the stream quiet. It keeps **one server-wide stream per saved server**,
not one per project: the server sends events for every project when no directory is requested. Session
and project metadata for a notification are read over HTTP, because `session.execution.*` events do not
carry a location.

## Feature → API map

| Feature | API |
| --- | --- |
| Connect / start a local service | `Service.discover()`, `Service.ensure()`, `server.info()` |
| Project = workspace folder | location `{ directory }` on session and message calls; `location.get` resolves the server's spelling |
| Session list, switch, new, rename | `session.list`, `session.create`, `session.get`, `session.update`, `session.message.list` |
| Transcript streaming | `event.subscribe` → `session.text.delta`, `session.reasoning.delta`, `session.tool.*`, `session.step.*`, `session.execution.*`, `session.compaction.*` |
| Prompt, agent, model, variant | `session.prompt`, `session.switchAgent`, `session.switchModel`, `agent.list`, `model.list` |
| Commands, skills, MCP | `command.list`, `session.command`, `skill.list`, `mcp.list`, `experimental.mcp.connect` / `disconnect`, `integration.*` and `credential.remove` for OAuth |
| Permissions and questions | `permission.asked` → `session.permission.reply`; `form.created` → `session.form.reply` |
| Diffs and revert | `session.diff`, `session.revert.stage` / `clear` / `commit` (servers 2.2 and newer) |
| Shell commands | `shell.created` / `shell.exited`, `GET /api/shell/{id}/output` cursor paging, `DELETE /api/shell/{id}`, `session.background` |
| Workers (subagents) | child sessions (`parentID`), their events and `session.get` |
| Attachments | `files[]` on `session.prompt` (`file://` or inline `data:` URIs) |
| Delete a session | `session.remove` (also removes child sessions), `session.deleted` |
| Pairing | `POST /api/pair`, `server.connect({ code })` |

Interactive input is not part of this map; see [Known limitations](#known-limitations).

## Notifications

The same decision rules exist in three runtimes: the extension's engine (`@occ/core`), the push plugin
and the Android service. They cannot share code across the VS Code, Bun/plugin and Java boundaries, so
the rules are kept identical by tests in each runtime.

### Rules

| Kind | Trigger | Extension default | App default |
| --- | --- | --- | --- |
| Needs attention: permission | `permission.asked` | on | on |
| Needs attention: question | `form.created` | on | on |
| Turn finished | `session.execution.succeeded` on a root session | on | on |
| Turn failed | `session.execution.failed` on a root session | on | on |
| Worker turn ended | `session.execution.*` on a child session | off | on |
| Background shell ended | `shell.exited` linked through the shell's session | off | — |

Shared rules:

- At most one notice per session per 5-second window. A later attention notice replaces a turn-end
  notice; a turn-end notice does not replace an attention notice.
- The same permission or question request is announced once, even if it is seen again after a reconnect.
- Answering a permission or form elsewhere (`permission.replied`, `form.replied`, `form.cancelled`)
  clears its notification.
- Wording is short and contains no tool input, file contents or secrets: a status mark and the session
  title, one line of detail, and the project folder name (not the path). Question and error text is
  clipped and passes a redaction step for tokens, `password=` pairs and long random strings.

### In the extension

`NotificationEngine` in `packages/core` is pure: it receives events and calls a `Notifier`. The VS Code
implementation shows `showWarningMessage` for attention and `showInformationMessage` for turn ends, with
`Open` and, for permissions, `Allow` / `Deny`. Notices are limited to the window's project and are
suppressed while the window is focused and that session is on screen (`opencode.notifications.whenFocused`).
VS Code cannot close a toast from code, so a dismissed notice is marked stale and its buttons become
harmless.

When the window is not focused, the extension asks the OpenCode Voice companion (which runs on the
user's computer even in a Remote SSH window) to draw attention: a taskbar flash on Windows, an urgent
window mark on Linux X11, or a system notification on macOS. The companion never moves focus. If it is
missing or older, the VS Code toast is still shown.

### In the Android app

The app keeps its own connection so it can notify while the UI is not running. A foreground service
(`WatchService`) holds the server-wide event stream for each saved server. It does not poll and holds no
wake lock: it sits on blocked sockets and the phone wakes it when the server sends something.

- **Foreground service type `specialUse`.** The other types do not fit. `dataSync` is cut off after six
  hours a day on Android 15 and may not start at boot; `remoteMessaging` is for relaying messages
  between devices. `specialUse` has no time limit and may start from `BOOT_COMPLETED`. The manifest
  carries the required subtype explanation.
- **Storage.** The service needs the servers and their passwords without the WebView. It keeps them
  encrypted with an AES-GCM key that lives in the Android Keystore and never leaves it; backups are
  disabled. The UI's own copy of the profiles uses the same Keystore-backed secure storage plugin.
- **Wording.** A status mark and the session title, one line of detail and the folder, the full text
  when expanded, and a sub-text for a worker ("worker of …") or, when more than one server is saved,
  the profile name. One notification per session replaces the previous one, grouped per server.
- **Suppression.** The service skips the session currently on screen, and applies the per-kind switches.
- **Cancel on reply.** A `permission.replied` / `form.replied` / `form.cancelled` event removes the
  matching notification, including when the request was answered from another client.
- **Watchdog.** Android's sticky restart is not reliable on every vendor build. An inexact alarm every
  15 minutes starts the service again if it should be running and is not. If Android refuses the start,
  the ongoing notification changes to "Not watching — tap to resume" rather than claiming to watch.
- **Catch-up.** After a reconnect, the service asks the server for open forms and permission requests
  in the most recently active projects and announces them, because the event stream does not replay
  what happened while it was down. Turn ends that happened during the gap are not re-announced.

### Push plugin (optional)

`plugins/opencode-push` is an OpenCode server plugin that sends the same notices through
[ntfy](https://ntfy.sh). It subscribes to the same event types, applies the same coalescing and
de-duplication rules, and sends the session title, the project folder name and, when enabled, one line
of question or error text. It never sends transcript text, tool input or output, file contents or
secrets. Tapping a push opens `opencode-mobile://session/<id>?server=<serverId>`.

The Android app does not need this plugin: it keeps its own connection and notifies itself. The plugin
is for setups where push must arrive through a notification service instead.

## Android app specifics

- **Same UI.** The app mounts `@occ/ui/App.svelte` and implements the same `HostBridge`. VS Code-only
  actions are replaced: files and diffs open in read-only screens, shell output is a read-only screen
  with Stop, and the status bar becomes a connection pill in the header.
- **No fixed workspace.** The app lists every OpenCode project and the sessions in it.
- **WebView origin.** The origin is `http://tauri.localhost`, set in one place
  (`apps/mobile/capacitor.config.ts`). The OpenCode server already allows it in its CORS list, so the
  app can call the server directly with `fetch`.
- **`CapacitorHttp` stays off.** Its native HTTP layer buffers whole responses, which breaks the
  server-sent event stream. The WebView's own `fetch` is used instead.
- **Cleartext and logging.** Cleartext HTTP is allowed because servers are commonly reached over a LAN
  or Tailscale address. Capacitor's bridge logging is disabled, because secure-storage calls carry the
  saved servers and their passwords.
- **Deep links.** `opencode-mobile://session/<id>?server=<serverId>` opens the app on that session and
  server. Without a `server` parameter a single saved server, or the one used last, is chosen; otherwise
  the app asks.
- **Voice** is not implemented in the app yet; the prompt box reports that it comes later.

## Voice

VS Code webviews have no microphone access, so recording lives in a second extension, **OpenCode Voice**
(`apps/vscode/companion/`). It is installed on the user's own computer, also when VS Code runs over
Remote SSH, because it declares `extensionKind: ["ui"]`. The main extension installs and upgrades the
companion from the bundled vsix.

The main extension decides what to record and keeps the credentials; the companion records and returns
text. The recorder runs in its own process (`ELECTRON_RUN_AS_NODE=1`), so a native crash cannot take
down the extension host. Text is only inserted into the prompt box, never sent automatically.

- **Local engine (default).** A free, offline sherpa-onnx model runs in the companion: one multilingual
  model for English and about 28 other languages, plus an optional Bangla pack. Models are downloaded
  once, checksum-verified, and stay on the user's computer. Details, measurements and limits are in
  [local-voice.md](local-voice.md).
- **Soniox (optional).** The user supplies their own Soniox key. It is stored in `SecretStorage`; the
  extension host mints a short-lived key for each recording, so the long-lived key never reaches the
  webview. Nothing is billed through this project.

The phone has native microphone access, so it can use the same engine interface directly once voice is
added there.

## Known limitations

- **No interactive stdin.** Agent shell commands run through a non-interactive API that captures output
  to a file. The terminal mirror can show live output and stop the command, but cannot send keystrokes
  such as `y` / `n`. Persistent PTY routes exist but the agent's use of them is not documented.
- **The event stream does not replay.** A client that was offline misses events. It re-reads state when
  it reconnects, and the Android service re-announces open permission and question requests, but a turn
  that finished during the gap produces no notification.
- **Background survival is the platform's decision.** The Android service is a foreground service with
  a watchdog, but aggressive battery management can still stop it. The app asks once to be exempted and
  reports honestly when it is not watching.
- **Server feature detection.** Revert needs a server with snapshots (2.2 or newer). On older servers
  the action is hidden rather than failing.
- **On-device voice inside VS Code's Electron** has been verified on Linux; loading the native addon on
  Windows and macOS inside VS Code was not verified when this was written. See
  [local-voice.md](local-voice.md#diagnostics).

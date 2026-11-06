# OpenCode for VS Code — design draft

Status: approved 2026-11-06. Repo: `sr-web-studio/opencode-vscode`.

Chosen UI direction: `docs/mockups/v2/` (compact, Claude Code style). The first round (`docs/mockups/gemini/`) was rejected because its tool cards were too large.

## Transcript UI rules (approved)

- Every tool call is **one line**: bold tool name + muted target (path, pattern, command) + short result (`+12 −3`, `✓ exit 0`, `✗ failed`). No cards or boxes.
- A thin left connector line chains the steps in a turn. A running step shows a spinner. A step that needs attention (permission/question) gets an amber left border.
- Each tool line can be expanded/collapsed: an edit shows a small inline diff plus "Open diff", a shell shows its last output lines plus "Show terminal", a read shows its range.
- When a turn finishes, all its steps fold under one line, `› N steps completed · 42s`, placed above the final answer.
- Default: everything collapsed. The extension settings can change this:
  - `opencode.transcript.collapseCompletedSteps` (default `true`)
  - `opencode.transcript.expandToolDetails` (default `false`)
  - `opencode.transcript.showReasoning` (`"collapsed" | "expanded" | "hidden"`, default `"collapsed"`)
  - `opencode.transcript.fontSize` (default: inherit VS Code `chat.editor.fontSize`, else 13)
- Comfortable spacing, readable font, theme colors only from `--vscode-*` variables. Markdown answers have proper paragraph and list spacing.
- Permission prompts are inline lines with "Allow once / Always / Reject".
- A slim "Background · 2 workers, 1 shell" row sits above the transcript and expands into a list.

## Decision: interactive input

Option A. v1 provides live output, Stop and Background for agent shell commands. Interactive stdin is deferred until the persistent PTY path is confirmed.

## Ground truth (checked 2026-11-06 on srws-server-office)

- OpenCode `v2.2.5`, service on `0.0.0.0:4096`. `GET /api/info` reports `capabilities.persistentPty: true`.
- Service registration: `~/.config/opencode/service.json` (`hostname`, `port`, `password`).
- Official client: `@opencode/client`. `@opencode/client/service` provides `Service.discover()`, `Service.ensure()` (starts `opencode serve --service` when needed), and `Service.headers()`.
- Server API: 170 operations, OpenAPI at `/openapi.json`. Event stream: `GET /api/event`. The client only receives live events, with no replay, so the extension resyncs on `server.connected`.
- VS Code `1.144.0` is installed on this host. Salim uses VS Code Remote SSH from the laptop, so the extension runs on the office server and reaches `127.0.0.1:4096` directly.
- Existing extensions: `sst-dev.opencode` is only a terminal launcher. Community options include OpenChamber and ACP Patchbay (ACP). None of them meets the requirements below.

## Principles

1. The extension is a client only. The OpenCode server owns sessions, models, providers, MCPs, skills, agents and permissions. The extension never writes OpenCode config.
2. Closing VS Code must never affect a session. The extension does not own any process the agent depends on. If it starts the service, it uses `Service.ensure()`, which starts the detached shared service. It never starts a child process tied to the extension host.
3. Reconnect means re-reading the session state. Do not cache state that the server already holds.

## Feature → API map

| Feature | API | Notes |
| --- | --- | --- |
| Connect / auto start | `Service.discover()` → `Service.ensure()`; manual URL + password for a remote server | If `opencode` is not on PATH, show a setup card |
| Project = workspace folder | location `{ directory: workspaceFolder }` on every call | |
| Session list / switch / new | `session.list`, `session.create`, `session.get`, `session.message.list` | |
| Chat streaming | `event.subscribe` → `session.text.delta`, `session.tool.*`, `session.step.*`, `session.execution.*` | |
| Prompt, agent, model, variant | `session.prompt`, `session.switchAgent`, `session.switchModel`, `agent.list`, `model.list`, `command.list`, `skill.list` | Pickers show what OpenCode reports and nothing else |
| Open file links | Tool input/metadata paths → `vscode.window.showTextDocument` | |
| Diffs | `session.diff` (`FileDiff.Info.patch`) → virtual "before" document + `vscode.diff` | Show per turn and for the whole session |
| Permissions / questions | `permission.asked` → `session.permission.reply`; `form.created` → `session.form.reply` | Inline cards, optionally a native notification |
| Shell commands in the terminal panel | `shell.created/exited` events, `GET /api/shell` (`metadata.sessionID`), `GET /api/shell/{id}/output` cursor paging → `vscode.Pseudoterminal` | One VS Code terminal per agent command, named `OpenCode: <cmd>` |
| Stop a command | `DELETE /api/shell/{id}`, or `session.interrupt` | |
| Move to background | `POST /api/session/{id}/background` | |
| Workers (subagents) | sessions whose `parentID` is the main session; their events | Expandable tree; clicking opens a read-only editor tab (WebviewPanel) |
| Background wake-up | Handled by the server. The UI shows inbox/synthetic messages and `session.execution.started` | |
| Status bar | connection + `session.active` | |

## Known gap: interactive input (y/n)

The agent's `shell` tool uses `POST /api/shell`, which the API describes as "Spawn one non-interactive shell command … stdout/stderr captured to a file." The terminal mirror can therefore show live output and Stop, but it cannot send keystrokes to that process.

There are experimental persistent PTY routes (`/api/experimental/session/{id}/terminal`, `/persistent-pty/{id}/connect`, a WebSocket with input). The agent's use of them is not documented yet, so it has not been verified.

Options:

- A. v1: live output + Stop + Background. Interactive input is added later, once the persistent PTY path is confirmed.
- B. Investigate the persistent PTY / agent terminal path first (spike), then decide.

## Tech stack (to verify versions before scaffolding)

- TypeScript, Bun for scripts, esbuild bundle, `@vscode/vsce` packaging; Open VSX publishing too.
- Webview UI: Svelte + Tailwind using VS Code theme CSS variables (`--vscode-*`), so the UI follows the user's theme.
- `@opencode/client` for every API call. No hand-written HTTP client.

## Build phases

1. Scaffold + connection layer + status bar + session list/switch + chat view (read and send).
2. Tool cards: file links, diff view, permission/question cards.
3. Terminal mirror for shell tools (output, Stop, Background).
4. Workers tree + worker editor tabs.
5. Polish, settings (server URL, password stored in `SecretStorage`), packaging, README, publish decision.

Each phase is a separate brief for a Sonnet 5.5 (high) developer worker, with a review after it.

# OpenCode for VS Code

A client for [OpenCode](https://opencode.ai) V2 that lives in the VS Code secondary sidebar. The OpenCode server owns your sessions, so closing VS Code never stops or changes a running session.

> Status: milestone M1 (branch `phase-1`). See `docs/design.md` for the design and `docs/mockups/` for the approved screens.

## What it does

- Chat with sessions of the current workspace folder: transcript, prompt box, stop button.
- One-line tool calls with expandable details, folded finished turns, collapsed reasoning, clickable file paths.
- Inline permission prompts (`Allow · Always · Deny`) and a question/form chooser that replaces the prompt box.
- Agent and model picker, session switcher, task list (when the agent uses `todowrite`), empty-project view.
- VS Code notifications when OpenCode needs you or finishes work (`opencode.notifications.*`).

## Requirements

- VS Code 1.144 or newer.
- The `opencode` command (setting `opencode.cliPath`, else `PATH`, else `~/.opencode/bin/opencode`). Without it the panel shows a setup state with install instructions.
- The extension never writes OpenCode configuration and never stops or restarts the OpenCode service. If no local service runs it starts the shared background service (`opencode serve --service`, detached), or connects to `opencode.serverUrl`.

## Develop

Needs [Bun](https://bun.sh).

```sh
bun install
bun run build        # extension host (esbuild → dist/extension.js) + webview (vite → dist/webview)
bun run watch        # rebuild on change
bun run typecheck    # tsc (host, core, tests) + svelte-check (webview)
bun test             # unit tests (test/unit)
bun run package      # opencode-vscode.vsix
```

Press F5 (`Run Extension` in `.vscode/launch.json`) to start an Extension Development Host.

Host smoke test (real VS Code via `@vscode/test-electron`; needs a display, so on headless Linux run it under `xvfb-run -a`):

```sh
bun run test:host
```

## Layout

| Path | Purpose | May import |
| --- | --- | --- |
| `src/core/` | API/state layer, reducers, form/session/model/todo/notification logic, `Controller` | root `@opencode/client` types only. No `vscode`, no `node:*`. |
| `src/ui/` | Svelte components, `HostBridge` interface | `core/`. No `vscode`, no `node:*`. |
| `src/webview/` | Webview entry and the VS Code `HostBridge` | `ui/`, `core/` |
| `src/extension/` | Extension host: connection, view provider, notifier, commands | everything, incl. `@opencode/client/service` |
| `test/unit/` | Unit tests, including `boundaries.test.ts` which enforces the import rules | |
| `test/fixtures/` | Sanitized real-API captures (events + messages) | |

`core/` and `ui/` are written so they can move into packages for a mobile app without changes.

## Fixtures

`bun run sanitize-fixtures <capture-dir> <name>` turns a raw capture (`events.json`, `messages.json`) into `test/fixtures/<name>.json`: it drops instruction/usage noise and anything that looks like a secret. Capture only in a throwaway directory with a throwaway session, and delete the session afterwards.

## Settings

See the **OpenCode** section in VS Code settings: `opencode.serverUrl`, `opencode.cliPath`, `opencode.transcript.*`, `opencode.todo.defaultExpanded`, `opencode.notifications.*`. A remote server password is stored in VS Code SecretStorage (**OpenCode: Set Remote Server Password**).

## License

MIT

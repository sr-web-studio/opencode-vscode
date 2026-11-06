# Development

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

## Publishing

See [PUBLISHING.md](PUBLISHING.md).

# Development

Needs [Bun](https://bun.sh).

```sh
bun install
bun run build        # extension host (esbuild → dist/extension.js) + webview (vite → dist/webview)
bun run watch        # rebuild on change
bun run typecheck    # tsc (host, core, tests) + svelte-check (webview)
bun test test/unit   # unit tests (also: bun run test)
bun run package      # release build: opencode-vscode.vsix + opencode-voice.vsix (the companion)
bun run package -- --test 11   # test build for trying on another computer, never published (see PUBLISHING.md)
```

`bun run build` bundles both extensions: the main one (`dist/extension.js`, `dist/webview/`) and the OpenCode Voice companion (`companion/dist/`).

Press F5 (`Run Extension` in `.vscode/launch.json`) to start an Extension Development Host.

Host smoke test (real VS Code via `@vscode/test-electron`; needs a display, so on headless Linux run it under `xvfb-run -a`):

```sh
bun run test:host
```

The host test runs with `OPENCODE_SMOKE=1`, which only stops the extension from installing the voice companion on its own a few seconds after start.

On-device voice without VS Code (downloads the models into the cache folder on first run, then plays WAV files through the real recorder process; see the header of the script for the options):

```sh
bun run build:ext
bun scripts/local-voice-smoke.ts --lang=en /tmp/opencode/voice-cache path/to/clip.wav
```
## Layout

| Path | Purpose | May import |
| --- | --- | --- |
| `src/core/` | API/state layer, reducers, form/session/model/todo/notification logic, `Controller` | root `@opencode/client` types only. No `vscode`, no `node:*`. |
| `src/ui/` | Svelte components, `HostBridge` interface | `core/`. No `vscode`, no `node:*`. |
| `src/webview/` | Webview entry and the VS Code `HostBridge` | `ui/`, `core/` |
| `src/extension/` | Extension host: connection, view provider, notifier, commands | everything, incl. `@opencode/client/service` |
| `src/companion/` | OpenCode Voice (`companion/`): microphone, on-device and Soniox recognition, window attention. Runs on the user's computer | `core/`, `vscode`, `node:*` |
| `test/unit/` | Unit tests, including `boundaries.test.ts` which enforces the import rules | |
| `test/fixtures/` | Sanitized real-API captures (events + messages) | |

`core/` and `ui/` are written so they can move into packages for a mobile app without changes.

## Fixtures

`bun run sanitize-fixtures <capture-dir> <name>` turns a raw capture (`events.json`, `messages.json`) into `test/fixtures/<name>.json`: it drops instruction/usage noise and anything that looks like a secret. Capture only in a throwaway directory with a throwaway session, and delete the session afterwards.

## Publishing

See [PUBLISHING.md](PUBLISHING.md).

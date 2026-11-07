# Development

Needs [Bun](https://bun.sh). The repo is a Bun workspace monorepo (`packages/core`, `packages/ui`, `apps/vscode`): see [monorepo.md](monorepo.md). Run every command from the repo root.

```sh
bun install
bun run build        # extension host (esbuild → apps/vscode/dist/extension.js) + webview (vite → apps/vscode/dist/webview)
bun run watch        # rebuild on change
bun run typecheck    # core (tsc), ui (svelte-check), apps/vscode (tsc for host, companion, tests + svelte-check for the webview)
bun test test/unit   # unit tests (also: bun run test)
bun run package      # release build: apps/vscode/opencode-vscode.vsix + apps/vscode/opencode-voice.vsix (the companion)
bun run package -- --test 11   # test build for trying on another computer, never published (see PUBLISHING.md)
```

`bun run build` bundles both extensions: the main one (`apps/vscode/dist/extension.js`, `apps/vscode/dist/webview/`) and the OpenCode Voice companion (`apps/vscode/companion/dist/`).

Press F5 (`Run Extension` in `.vscode/launch.json`, which points at `apps/vscode`) to start an Extension Development Host.

Host smoke test (real VS Code via `@vscode/test-electron`; needs a display, so on headless Linux run it under `xvfb-run -a`):

```sh
bun run test:host
```

The host test runs with `OPENCODE_SMOKE=1`, which only stops the extension from installing the voice companion on its own a few seconds after start.

On-device voice without VS Code (downloads the models into the cache folder on first run, then plays WAV files through the real recorder process; see the header of the script for the options):

```sh
bun run --cwd apps/vscode build:ext
bun scripts/local-voice-smoke.ts --lang=en /tmp/opencode/voice-cache path/to/clip.wav
```
## Layout

| Path | Purpose | May import |
| --- | --- | --- |
| `packages/core/src/` (`@occ/core`) | API/state layer, reducers, form/session/model/todo/notification logic, `Controller` | root `@opencode/client` types only. No `vscode`, no `node:*`. |
| `packages/ui/src/` (`@occ/ui`) | Svelte components, `HostBridge` interface | `@occ/core`. No `vscode`, no `node:*`. |
| `apps/vscode/src/webview/` | Webview entry and the VS Code `HostBridge` | `@occ/ui`, `@occ/core` |
| `apps/vscode/src/extension/` | Extension host: connection, view provider, notifier, commands | everything, incl. `@opencode/client/service` |
| `apps/vscode/src/companion/` | OpenCode Voice (`apps/vscode/companion/`): microphone, on-device and Soniox recognition, window attention. Runs on the user's computer | `@occ/core`, `vscode`, `node:*` |
| `test/unit/` | Unit tests for all packages, including `boundaries.test.ts` which enforces the import rules | |
| `test/fixtures/` | Sanitized real-API captures (events + messages) | |
| `apps/vscode/test/host/` | Host smoke test in a real VS Code | |

`packages/core` and `packages/ui` are shared with the mobile app planned in `apps/mobile` (see [monorepo.md](monorepo.md)).

## Fixtures

`bun run sanitize-fixtures <capture-dir> <name>` turns a raw capture (`events.json`, `messages.json`) into `test/fixtures/<name>.json`: it drops instruction/usage noise and anything that looks like a secret. Capture only in a throwaway directory with a throwaway session, and delete the session afterwards.

## Publishing

See [PUBLISHING.md](PUBLISHING.md).

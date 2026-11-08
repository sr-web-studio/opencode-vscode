# Development

Needs [Bun](https://bun.sh) 1.4 or newer. The repo is a Bun workspace monorepo (`packages/core`,
`packages/ui`, `apps/vscode`, `apps/mobile`, `plugins/opencode-push`): see [monorepo.md](monorepo.md).
Run every command from the repo root.

```sh
bun install
bun run build        # extension host (esbuild → apps/vscode/dist/extension.js) + webview (vite → apps/vscode/dist/webview)
bun run watch        # rebuild on change
bun run typecheck    # core (tsc), ui (svelte-check), apps/vscode (tsc + svelte-check), apps/mobile (svelte-check)
bun run test         # unit tests in test/unit
bun run format       # Prettier
bun run format:check # Prettier in check mode (what CI runs)
```

`bun run build` bundles both extensions: the main one (`apps/vscode/dist/extension.js`,
`apps/vscode/dist/webview/`) and the OpenCode Voice companion (`apps/vscode/companion/dist/`).

Press F5 (`Run Extension` in `.vscode/launch.json`, which points at `apps/vscode`) to start an Extension
Development Host.

Host smoke test (real VS Code via `@vscode/test-electron`; needs a display, so on headless Linux run it
under `xvfb-run -a`):

```sh
bun run test:host
```

The host test runs with `OPENCODE_SMOKE=1`, which only stops the extension from installing the voice
companion on its own a few seconds after start.

On-device voice without VS Code (downloads the models into the cache folder on first run, then plays WAV
files through the real recorder process; see the header of the script for the options):

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
| `apps/mobile/src/` (`@occ/mobile`) | Capacitor app: screens, `HostBridge`, pure modules in `src/lib/` (unit-tested from `test/unit`) | `@occ/core`, `@occ/ui`, Capacitor plugins |
| `apps/mobile/android/` | Generated Capacitor project, committed; build output is ignored. The notification service is `app/src/main/java/dev/srwebstudio/opencode/notify/` | |
| `plugins/opencode-push/` | OpenCode server plugin that sends ntfy pushes (no build step) | `@opencode/plugin` at runtime |
| `test/unit/` | Unit tests for all packages, including `boundaries.test.ts` which enforces the import rules | |
| `test/fixtures/` | Sanitized real-API captures (events + messages) | |
| `apps/vscode/test/host/` | Host smoke test in a real VS Code | |

`packages/core` and `packages/ui` are shared by the extension and the Android app. See
[monorepo.md](monorepo.md) for how the imports resolve, and [architecture.md](architecture.md) for how
the clients fit together.

## Android app

Building the app needs a JDK (21 is what the Gradle project uses) and the Android SDK with
`platform-tools` and a recent platform. Point `JAVA_HOME` and `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) at
your installation; no other machine-specific setup is expected.

```sh
bun run mobile:build                                  # Vite build into apps/mobile/dist
bun run --cwd apps/mobile dev                          # dev server on http://127.0.0.1:5173 for desktop testing
cd apps/mobile && bun run apk                          # vite build + cap sync + gradlew assembleDebug
cd apps/mobile/android && ./gradlew testDebugUnitTest  # the Java unit tests (notification service, wording, SSE parser)
```

The debug APK is in `apps/mobile/android/app/build/outputs/apk/debug/`. A release build needs the
signing material described in [PUBLISHING.md](PUBLISHING.md). The notification service and its Java
tests live in `apps/mobile/android/app/src/main/java/dev/srwebstudio/opencode/notify/` and
`apps/mobile/android/app/src/test/java/dev/srwebstudio/opencode/notify/`.

## Plugin

```sh
cd plugins/opencode-push
bun test
bun run typecheck
```

The plugin is part of the workspace (`plugins/*`), so `bun install` at the root installs its
dependencies too. It still has no build step and no runtime dependencies: OpenCode provides
`@opencode/plugin` when it loads the plugin.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

- `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, `bun run format:check`,
- the Android Gradle unit tests,
- the plugin tests and typecheck.

The host smoke test needs a display, so it stays a manual check.

## Fixtures

`bun run sanitize-fixtures <capture-dir> <name>` turns a raw capture (`events.json`, `messages.json`)
into `test/fixtures/<name>.json`: it drops instruction/usage noise and anything that looks like a
secret. Capture only in a throwaway directory with a throwaway session, and delete the session
afterwards.

## Publishing

See [PUBLISHING.md](PUBLISHING.md).

# Monorepo

One Bun workspace with four packages and one plugin: `packages/core`, `packages/ui`, `apps/vscode`,
`apps/mobile` and `plugins/opencode-push`.

```
.
├── package.json        private root: "workspaces": ["packages/*", "apps/*", "plugins/*"], delegating scripts
├── bunfig.toml         linker = "hoisted" (one flat node_modules at the root)
├── tsconfig.base.json  compiler options shared by every package
├── .env.example        names of the publishing tokens; the real .env is git-ignored
├── packages/
│   ├── core/           @occ/core: API/state layer on @opencode/client, reducers, forms, grouping
│   └── ui/             @occ/ui: Svelte components, store, HostBridge interface (src/bridge.ts)
├── apps/
│   ├── mobile/         @occ/mobile (Capacitor 8 Android app, id dev.srwebstudio.opencode)
│   │   ├── src/lib/         pure modules (bridge, workspace, nav, profiles, pairing, deep links): unit-tested from test/unit
│   │   ├── src/screens/     one Svelte file per screen; src/model.svelte.ts is the app state
│   │   └── android/         the generated Capacitor project (committed; build outputs are git-ignored)
│   └── vscode/         @occ/vscode (extension id sr-web-studio.opencode-unofficial)
│       ├── src/extension/   extension host
│       ├── src/webview/     webview entry + VS Code HostBridge
│       ├── src/companion/   OpenCode Voice (separate extension, folder companion/)
│       ├── companion/       OpenCode Voice package.json, README, NOTICE, icon
│       ├── media/ tools/ test/host/ esbuild.mjs vite.config.ts svelte.config.mjs tsconfig*.json .vscodeignore
│       └── package.json     the extension manifest (name, publisher, version, contributes unchanged)
├── plugins/
│   └── opencode-push/  OpenCode server plugin (TypeScript, no build step)
├── test/               unit tests for all packages (`bun test` from the root), fixtures, fakes
├── scripts/            repo-level scripts (fixtures, local voice smoke test)
├── .github/            CI workflow, issue and pull-request templates, security policy
├── docs/  README.md  CHANGELOG.md  CONTRIBUTING.md  SECURITY.md  AGENTS.md  LICENSE
```

`@occ` is short for "OpenCode clients"; the extension keeps its published name
`opencode-unofficial`, the companion is `opencode-voice`, and the app is `@occ/mobile`.

## Who may import what

| Package | May import | Must not import |
| --- | --- | --- |
| `@occ/core` | `@opencode/client` (root entry, types only) | `vscode`, `node:*` (and bare `fs`, `path`, …), any other `@occ/*`, `apps/*` |
| `@occ/ui` | `@occ/core`, `svelte`, `marked`, `dompurify`, tailwind | `vscode`, `node:*`, `@occ/vscode`, any `apps/*` |
| `apps/vscode` | `@occ/core`, `@occ/ui`, `vscode`, `node:*`, `@opencode/client/service` | |
| `apps/mobile` | `@occ/core`, `@occ/ui`, Capacitor plugins, `@opencode/client` | `vscode`, `apps/vscode` |
| `plugins/opencode-push` | `@opencode/plugin` at runtime | any workspace package |

`test/unit/boundaries.test.ts` enforces this on every `bun test`: it fails if `packages/core` or
`packages/ui` import `vscode`, `node:*` or a Node builtin, if `core` imports another workspace package,
if `ui` imports anything from the workspace except `@occ/core`, or if the webview entry pulls in
`@opencode/client/*` beyond the root entry.

## How cross-package imports resolve

Packages import each other by name with subpath imports: `@occ/core/transcript/reducer`,
`@occ/ui/App.svelte`.

- `packages/core/package.json` has `"exports": { "./*": "./src/*.ts" }`; `packages/ui` has
  `"./*.svelte": "./src/*.svelte"` and `"./*": "./src/*.ts"`.
- Bun links the workspace packages into the root `node_modules/@occ/*` (`linker = "hoisted"` in
  `bunfig.toml`), so one real directory structure serves everything. TypeScript
  (`moduleResolution: bundler`), `bun test`, esbuild and Vite all follow the standard `exports` map, and
  svelte-check uses the TypeScript resolution. No `paths`, no aliases, no build step for the packages:
  the source is consumed directly.
- Why not TS `paths`/Vite aliases: each tool would need its own copy of the mapping (tsconfig, esbuild,
  Vite, svelte-check, bun test), and they would drift. `exports` is read by all of them.
- Why `hoisted`: Bun's default isolated linker only links a package's own dependencies next to it, so
  root-level tests (which import both packages and the extension host code) would not find `@occ/*` or
  `@vscode/codicons`.

## Build, test, package

Run everything from the repo root.

```sh
bun install
bun run typecheck                 # core (tsc) + ui (svelte-check) + apps/vscode (tsc + svelte-check) + apps/mobile (svelte-check)
bun test                          # all unit tests in test/unit (also: bun run test)
bun run format                    # Prettier over the repo
bun run format:check              # Prettier in check mode
bun run build                     # esbuild (host + companion) and Vite (webview) into apps/vscode/dist and apps/vscode/companion/dist
bun run mobile:build              # Vite build into apps/mobile/dist
cd apps/mobile && bun run apk     # vite build + cap sync + gradlew assembleDebug
cd apps/mobile/android && ./gradlew testDebugUnitTest
cd plugins/opencode-push && bun test && bun run typecheck
bun run package                   # release build: apps/vscode/opencode-vscode.vsix + apps/vscode/opencode-voice.vsix
bun run package -- --test 17      # test build; package.json files are restored afterwards
bun run publish:marketplace       # reads the two vsix files and ../../.env (see PUBLISHING.md)
bun run publish:openvsx
bun run test:host                 # real VS Code smoke test (needs a display, e.g. xvfb-run -a)
```

`.github/workflows/ci.yml` runs the typecheck, the unit tests, `format:check`, the Android Gradle tests
and the plugin tests on every push and pull request.

vsce packs `README.md`, `CHANGELOG.md` and `LICENSE` from the extension folder. The root files are the
source of truth; `apps/vscode/tools/package.ts` copies them into `apps/vscode/` before packaging (the
copies are git-ignored), so the vsix content is the same as before the split. Images referenced from
the README are absolute URLs, so the Marketplace listing renders them too.

## `apps/mobile` (Capacitor)

The controllers of `@occ/core` run inside the app, and the bridge calls `controller.dispatch` directly
(`src/lib/bridge.ts`). One controller per open project, disposed when its last screen closes
(`src/lib/workspace.ts`).

The WebView origin (`http://tauri.localhost`) is set in one place, `apps/mobile/capacitor.config.ts`.
Code that tests import (`apps/mobile/src/lib/*`) must not touch the DOM: the root tests are typechecked
without a DOM lib.

The native notification service is Java under
`apps/mobile/android/app/src/main/java/dev/srwebstudio/opencode/notify/`; it keeps its own event stream
per saved server so notifications work while the app is closed. See
[architecture.md](architecture.md#in-the-android-app). Its unit tests run with
`./gradlew testDebugUnitTest`.

Releases are APK pre-releases on GitHub Releases; see [PUBLISHING.md](PUBLISHING.md).

# Monorepo

One Bun workspace, three workspace packages today, a fourth (`apps/mobile`) later.

```
.
├── package.json        private root: "workspaces": ["packages/*", "apps/*"], delegating scripts
├── bunfig.toml         linker = "hoisted" (one flat node_modules at the root)
├── tsconfig.base.json  compiler options shared by every package
├── packages/
│   ├── core/           @occ/core: API/state layer on @opencode/client, reducers, forms, grouping
│   └── ui/             @occ/ui: Svelte components, store, HostBridge interface (src/bridge.ts)
├── apps/
│   └── vscode/         @occ/vscode (extension id sr-web-studio.opencode-unofficial)
│       ├── src/extension/   extension host
│       ├── src/webview/     webview entry + VS Code HostBridge
│       ├── src/companion/   OpenCode Voice (separate extension, folder companion/)
│       ├── companion/       OpenCode Voice package.json, README, NOTICE, icon
│       ├── media/ tools/ test/host/ esbuild.mjs vite.config.ts svelte.config.mjs tsconfig*.json .vscodeignore
│       └── package.json     the extension manifest (name, publisher, version, contributes unchanged)
├── test/               unit tests for all packages (`bun test` from the root), fixtures, fakes
├── scripts/            repo-level scripts (fixtures, local voice smoke test)
├── docs/  plan.md  README.md  CHANGELOG.md  LICENSE  .env (git-ignored, publish tokens)
```

## Who may import what

| Package | May import | Must not import |
| --- | --- | --- |
| `@occ/core` | `@opencode/client` (root entry, types only) | `vscode`, `node:*` (and bare `fs`, `path`, …), any other `@occ/*`, `apps/*` |
| `@occ/ui` | `@occ/core`, `svelte`, `marked`, `dompurify`, tailwind | `vscode`, `node:*`, `@occ/vscode`, any `apps/*` |
| `apps/vscode` | `@occ/core`, `@occ/ui`, `vscode`, `node:*`, `@opencode/client/service` | |
| `apps/mobile` (future) | `@occ/core`, `@occ/ui`, Capacitor | `vscode`, `apps/vscode` |

`test/unit/boundaries.test.ts` enforces this on every `bun test`: it fails if `packages/core` or `packages/ui` import `vscode`, `node:*` or a Node builtin, if `core` imports another workspace package, if `ui` imports anything from the workspace except `@occ/core`, or if the webview entry pulls in `@opencode/client/*` beyond the root entry.

## How cross-package imports resolve

Packages import each other by name with subpath imports: `@occ/core/transcript/reducer`, `@occ/ui/App.svelte`.

- `packages/core/package.json` has `"exports": { "./*": "./src/*.ts" }`; `packages/ui` has `"./*.svelte": "./src/*.svelte"` and `"./*": "./src/*.ts"`.
- Bun links the workspace packages into the root `node_modules/@occ/*` (`linker = "hoisted"` in `bunfig.toml`), so one real directory structure serves everything. TypeScript (`moduleResolution: bundler`), `bun test`, esbuild and Vite all follow the standard `exports` map, and svelte-check uses the TypeScript resolution. No `paths`, no aliases, no build step for the packages: the source is consumed directly.
- Why not TS `paths`/Vite aliases: each tool would need its own copy of the mapping (tsconfig, esbuild, Vite, svelte-check, bun test), and they would drift. `exports` is read by all of them.
- Why `hoisted`: Bun's default isolated linker only links a package's own dependencies next to it, so root-level tests (which import both packages and the extension host code) would not find `@occ/*` or `@vscode/codicons`.

## Build, test, package

Run everything from the repo root.

```sh
bun install
bun run typecheck                 # core (tsc) + ui (svelte-check) + apps/vscode (tsc + svelte-check)
bun test                          # all unit tests in test/unit (also: bun run test)
bun run build                     # esbuild (host + companion) and Vite (webview) into apps/vscode/dist and apps/vscode/companion/dist
bun run package                   # apps/vscode/opencode-vscode.vsix + apps/vscode/opencode-voice.vsix
bun run package -- --test 17      # test build; package.json files are restored afterwards
bun run publish:marketplace       # reads the two vsix files and ../../.env (see PUBLISHING.md)
bun run publish:openvsx
bun run test:host                 # real VS Code smoke test (needs a display, e.g. xvfb-run -a)
```

vsce packs `README.md`, `CHANGELOG.md` and `LICENSE` from the extension folder. The root files are the source of truth; `apps/vscode/tools/package.ts` copies them into `apps/vscode/` before packaging (the copies are git-ignored), so the vsix content is the same as before the split.

## Adding `apps/mobile` (Capacitor)

1. Create `apps/mobile` with `package.json` (`"name": "@occ/mobile"`, `"private": true`, dependencies `@occ/core` and `@occ/ui` as `workspace:*`).
2. Write its `HostBridge` implementation (same interface as `apps/vscode/src/webview/vscode-bridge.ts`) and a Vite entry that mounts `@occ/ui/App.svelte`. Capacitor plugins (QR scanner, push, storage) live only in this app.
3. Add a `typecheck` script to it and one line to the root `typecheck` script; `bun test` already covers the shared packages. The workspace globs pick the new app up without other changes.
4. Anything the mobile app needs from the extension today (for example code in `apps/vscode/src/extension`) moves into `packages/core` first, keeping the boundary rules above.

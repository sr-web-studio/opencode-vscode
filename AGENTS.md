# Agent guidelines

Instructions for AI coding agents (and a short reference for human contributors) working in this repository. This is a **public** repository: everything committed here is read by other developers, so keep it clean, consistent and professional.

## Branches and releases

| Branch / tag | Purpose |
| --- | --- |
| `main` | Released code only. Updated by merging `dev` when a release is published. Never commit to it directly, never rewrite its history. |
| `dev` | Integration branch. Feature and fix branches are merged here with `--no-ff` after review and green checks. |
| `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>` | Short-lived work branches from `dev`, deleted after merging. |
| `vX.Y.Z` | VS Code extension releases (both extensions share the version). |
| `mobile-vX.Y.Z-beta` | Android app pre-releases on GitHub Releases (`gh release create --prerelease`). |

Release steps are in [docs/PUBLISHING.md](docs/PUBLISHING.md). Test builds are never published.

## Layout

Bun workspace monorepo; run every command from the repo root.

- `packages/core` (`@occ/core`): API/state layer and `Controller`. No `vscode`, no `node:*`.
- `packages/ui` (`@occ/ui`): shared Svelte 5 UI. No `vscode`, no `node:*`.
- `apps/vscode`: the VS Code extension and the OpenCode Voice companion.
- `apps/mobile`: the Android app (Capacitor, Svelte 5, a native notification service in Java).
- `plugins/opencode-push`: optional OpenCode server plugin.
- `test/unit`: unit tests for all packages; `test/unit/boundaries.test.ts` enforces the import rules.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [docs/monorepo.md](docs/monorepo.md).

## Checks before a commit

```sh
bun run typecheck
bun run test                                        # not plain `bun test`
cd apps/mobile/android && ./gradlew testDebugUnitTest   # when apps/mobile/android changed
```

A change to `packages/*` affects both the extension and the app: say so in the commit message and add a `CHANGELOG.md` line when users of the extension will notice it.

## Commits

- Imperative, scoped subject: `mobile: …`, `core: …`, `ui: …`, `vscode: …`, `voice: …`, `docs: …`, `build: …`. One logical change per commit.
- Merge commits: `Merge <branch>: <what it brings>`.
- No work-in-progress, "fix typo again" or "round 2" commits on `dev`: tidy the branch before merging.

## Public-repo hygiene

Never commit:

- Secrets: `.env`, tokens, passwords, keystores (`*.jks`, `*.keystore`), service-account JSON. Signing material lives outside the repo; the release keystore password comes from `ANDROID_KEYSTORE_PASSWORD`.
- Personal or internal details: people's names, home paths, real host names or IP addresses of private machines, Drive or account paths. Use neutral examples (`http://192.168.1.10:4096`, `my-server`).
- Internal process notes: agent or worker reports, briefs, "round N" logs, dated decision diaries, chat transcripts, scratch files. Keep them outside the repository (for example `/tmp`), never in `docs/`.
- Build output, generated APK/VSIX files, screenshots from test runs.

Write code comments and docs for an outside reader: explain *why*, not who decided it or when. No commented-out code, no stray `console.log`/`Log.d` debugging, no TODOs without an issue link.

## Product rules

- The clients never change OpenCode's configuration and never stop or restart the OpenCode service. Deleting a session only happens on an explicit, confirmed user action.
- Notifications and logs never contain tool input, file contents, passwords or tokens.
- "OpenCode" belongs to the OpenCode team. Everything here is "OpenCode (unofficial)" and says it is not affiliated.

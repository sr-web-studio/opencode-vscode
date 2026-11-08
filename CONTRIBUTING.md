# Contributing

Thanks for taking the time to help. This repository holds the **unofficial** OpenCode clients: the VS Code extension (with the OpenCode Voice companion), the Android app, and the `opencode-push` server plugin. It is not affiliated with the OpenCode team; bugs in the OpenCode server, CLI or official plugins belong in [their repository](https://github.com/anomalyco/opencode).

Before a large change, open an issue and describe what you want to do, so nobody duplicates work or builds in the wrong direction.

## Setup

- [Bun](https://bun.sh) 1.4 or newer (`package.json` pins the exact version in `packageManager`). Run every command from the repository root.
- JDK 21 and the Android SDK only if you work on the Android app; the Gradle wrapper is committed.

```sh
bun install
```

## Checks before a pull request

CI runs these on every pull request, and a pull request should be green before review:

```sh
bun run typecheck       # core, ui, extension, mobile, plugin
bun run test            # unit tests in test/unit
bun run test:plugin     # tests in plugins/opencode-push
bun run build           # extension + voice companion
bun run mobile:build    # Android web app
bun run format:check    # Prettier (advisory until the one-time reformat lands)
```

When you change `apps/mobile/android`, also run the JVM tests:

```sh
cd apps/mobile/android && ./gradlew testDebugUnitTest
```

`bun run test:host` starts a real VS Code window and needs a display (use `xvfb-run -a` on a headless machine). It is not part of CI.

## Branches and pull requests

- `dev` is the integration branch; `main` only contains releases.
- Branch from `dev` as `feat/<topic>`, `fix/<topic>`, `docs/<topic>` or `chore/<topic>`.
- Open pull requests against `dev`, keep one logical change per pull request, and delete the branch after it is merged.
- Never commit to `main` directly.

## Commits

Imperative, scoped subject: `mobile: …`, `core: …`, `ui: …`, `vscode: …`, `voice: …`, `docs: …`, `build: …`. One logical change per commit, no work-in-progress subjects, details in the body when they help.

## Public-repository hygiene

Everything here is public. Never commit:

- Secrets: `.env` files, tokens, passwords, keystores (`*.jks`, `*.keystore`), service-account JSON.
- Personal or internal details: names, home paths, real host names or IP addresses. Use neutral examples (`http://192.168.1.10:4096`, `my-server`).
- Build output, generated APK/VSIX files, screenshots from test runs, or scratch notes.
- Raw AI chat transcripts, generated reports or "round N" logs. Write the explanation yourself.

Logs pasted into issues or pull requests must have passwords, tokens and private addresses removed first.

## Where to look

- [`AGENTS.md`](AGENTS.md): the rules above in more detail, including the import boundaries.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md): layout, host smoke test, fixtures.
- [`docs/PUBLISHING.md`](docs/PUBLISHING.md): release flow (maintainers only).

Security issues go through [private disclosure](SECURITY.md), not the public issue tracker.

# Publishing

How SR Web Studio ships this extension, `sr-web-studio.opencode-unofficial` (Marketplace names are unique across publishers and `opencode-vscode` was taken), with the companion `sr-web-studio.opencode-voice`. This is the same setup as `grok-build-unofficial`, which is already published from these accounts.

## Accounts (already exist)

| Store | Publisher / namespace | Manage | Token |
| --- | --- | --- | --- |
| VS Code Marketplace | `sr-web-studio` | https://marketplace.visualstudio.com/manage | Azure DevOps PAT: https://dev.azure.com/sr-web-studio/_usersSettings/tokens. Scope **Marketplace → Manage**, organization **All accessible organizations** |
| Open VSX | `sr-web-studio` (verified) | https://open-vsx.org/user-settings/namespaces | https://open-vsx.org/user-settings/tokens |

- The Microsoft identity behind `VSCE_PAT` must be an **Owner** of the `sr-web-studio` publisher. If publishing returns "Access Denied", the PAT's identity is usually a different MSA/Azure AD account; add it as Owner.
- No tokens are stored on the build server: `grok-build-unofficial` has no `.env` and no GitHub Actions secrets. Create new tokens, or copy them from wherever they were saved, into this repo's `.env`.

## Local setup

```bash
cp .env.example .env    # then fill in VSCE_PAT and OVSX_PAT
```

- `.env` lives at the **repo root** (not in `apps/vscode`); `tools/publish.ts` reads it from there. It is listed in `.gitignore` and `apps/vscode/.vscodeignore`.
- `apps/vscode/tools/publish.ts` refuses to publish if the vsix contains a `.env` file, and it scrubs tokens from all output.

## Release steps

There are two extensions with the same version: the main one (`sr-web-studio.opencode-unofficial`) and the companion **OpenCode Voice** (`sr-web-studio.opencode-voice`, folder `apps/vscode/companion/`). The main vsix carries the companion's vsix (`dist/opencode-voice.vsix`) and installs it on the user's computer, so both must be published.

Everything below runs from the repo root. The extensions live in `apps/vscode/`; the root `README.md`, `CHANGELOG.md` and `LICENSE` are the source of truth, and `bun run package` copies them into `apps/vscode/` (git-ignored copies) because vsce packs them from the extension folder.

1. Bump `version` in `apps/vscode/package.json` and update the root `CHANGELOG.md`. (`bun run package` copies the version to `apps/vscode/companion/package.json`.)
2. `bun run typecheck && bun run test && bun run package`. This builds and writes **`apps/vscode/opencode-vscode.vsix`** (main) and **`apps/vscode/opencode-voice.vsix`** (companion).
3. Check the contents of both vsix files (run `bun run package` first: the main vsix lists `dist/opencode-voice.vsix` only after that):

   ```bash
   (cd apps/vscode && bunx @vscode/vsce ls --no-dependencies)                     # main
   (cd apps/vscode/companion && bunx @vscode/vsce ls --no-dependencies)           # companion
   ```

   Main: `dist/extension.js`, `dist/webview/main.{js,css,ttf}`, `dist/opencode-voice.vsix`, `media/`, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`. Companion: `dist/extension.js`, `dist/recorder.js`, `dist/pvrecorder/**`, `media/icon.png`, `package.json`, `README.md`, `LICENSE`, `NOTICE`. No `.env`, no `.map`, no `.onnx` models (the voice models are downloaded by the user's computer, never shipped).
4. Publish. `apps/vscode/tools/publish.ts` publishes **the companion first, then the main extension**, to each store (the main extension installs the companion, so it must already be in the store when users update):

   ```bash
   bun run publish:marketplace   # → https://marketplace.visualstudio.com/items?itemName=sr-web-studio.opencode-unofficial (and ...opencode-voice)
   bun run publish:openvsx       # → https://open-vsx.org/extension/sr-web-studio/opencode-unofficial (and .../opencode-voice)
   ```

5. On `dev`: commit (`Release X.Y.Z`), tag `vX.Y.Z`. Then merge `dev` into `main` with `--no-ff` (`Merge dev: release X.Y.Z`) and push `main`, `dev` and the tag. `main` only ever receives these release merges (see [AGENTS.md](../AGENTS.md)).

## Android app (beta pre-release)

The Android app (`apps/mobile`) is never part of the vsix; it is published as an APK on GitHub Releases, marked as a pre-release.

1. Bump `version` in `apps/mobile/package.json` and `versionName`/`versionCode` in `apps/mobile/android/app/build.gradle` (versions end in `-beta` while the app is a preview).
2. Load the signing password: `set -a; . ./.env; set +a` (`ANDROID_KEYSTORE_PASSWORD`). The release keystore lives outside the repo (default `~/.config/occ-android/release.jks`, override with `ANDROID_KEYSTORE_PATH`; key alias `opencode-mobile`). Without the password the release build is unsigned.
3. `cd apps/mobile && bun run android:sync && cd android && ./gradlew assembleRelease`, then check the APK: `apksigner verify --print-certs` shows the release certificate, `aapt dump badging` shows the version.
4. Tag `mobile-vX.Y.Z-beta` on `dev`, push it, and create the release with `gh release create mobile-vX.Y.Z-beta <apk> --prerelease --latest=false`. The notes say beta, unofficial and not affiliated, how to install and pair, and list the APK's SHA-256 and the certificate fingerprint.

## Test builds (never published)

To try a build on another computer (for example Windows) before a release:

```bash
bun run package -- --test 11
```

- It uses the **same extension ids** (`sr-web-studio.opencode-unofficial`, `sr-web-studio.opencode-voice`), so installing it replaces the installed extension instead of adding a second copy.
- The version is the **next patch** with a prerelease suffix: with `0.3.6` in `apps/vscode/package.json`, `0.3.7-test.11`. Names end with ` TEST 11` ("OpenCode (unofficial) TEST 11"). The companion gets the same version, and the main extension upgrades the companion from the bundled vsix (`0.3.7` ranks above `0.3.7-test.11`, `-test.12` above `-test.11`).
- Files (in `apps/vscode/`): `opencode-unofficial-0.3.7-test.11.vsix` and `opencode-voice-0.3.7-test.11.vsix` (install the main one with **Extensions: Install from VSIX…**; it installs the companion by itself). `apps/vscode/package.json` and `apps/vscode/companion/package.json` are restored afterwards, so the working tree stays clean.
- **Never publish a test build.** `bun run publish:*` only reads `opencode-vscode.vsix` and `opencode-voice.vsix`, which a test build does not write; do not pass a test vsix to `vsce publish` or `ovsx publish` by hand.

## Listing (done)

- **Name:** `sst-dev.opencode` ("opencode") and `sst-dev.opencode-v2` ("OpenCode Beta") are the official extensions, and "OpenCode" belongs to the OpenCode team. This one is "OpenCode (unofficial)", with a disclaimer at the top of the README and the companion's README.
- **Listing:** 128×128 PNG icon (the Marketplace does not accept SVG), README with the `opencode` CLI requirement, CHANGELOG, `repository`/`bugs`/`homepage` in `package.json`, and a LICENSE file.
- **Repo:** `sr-web-studio/opencode-vscode` is public (since 0.3.5).
- **CI (optional, not set up):** a tag-triggered GitHub Action like `grok-build-unofficial/.github/workflows/release.yml`, with `VSCE_PAT` and `OVSX_PAT` as repository secrets.

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

- `.env` is listed in `.gitignore` and `.vscodeignore`.
- `tools/publish.ts` refuses to publish if the vsix contains a `.env` file, and it scrubs tokens from all output.

## Release steps

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. `bun run typecheck && bun run test && bun run package` → `opencode-vscode.vsix`.
3. Check the contents: `bunx @vscode/vsce ls --no-dependencies`. Only `dist/`, `media/`, `package.json`, `README.md`, `LICENSE` and `CHANGELOG.md` should be listed.
4. Publish:

   ```bash
   bun run publish:marketplace   # → https://marketplace.visualstudio.com/items?itemName=sr-web-studio.opencode-unofficial
   bun run publish:openvsx       # → https://open-vsx.org/extension/sr-web-studio/opencode-unofficial
   ```

5. Commit, then tag `vX.Y.Z` and push the tag.

## Before the first public release (M5)

- **Name:** `sst-dev.opencode` ("opencode") and `sst-dev.opencode-v2` ("OpenCode Beta") are the official extensions. The Marketplace rejects a display name that is already taken, and "OpenCode" belongs to the OpenCode team. Use an unofficial name, as with Grok Build, for example "OpenCode Client (unofficial)", with a disclaimer at the top of the README.
- **Listing:** 128×128 PNG icon (the Marketplace does not accept SVG), README with screenshots and the `opencode` CLI requirement, CHANGELOG, `repository`/`bugs`/`homepage` in `package.json`, and a LICENSE file.
- **Repo:** `sr-web-studio/opencode-vscode` is public (since 0.3.5).
- **CI (optional):** a tag-triggered GitHub Action like `grok-build-unofficial/.github/workflows/release.yml`, with `VSCE_PAT` and `OVSX_PAT` as repository secrets.

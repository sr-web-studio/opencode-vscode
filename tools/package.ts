// Packages both extensions. The companion (OpenCode Voice) gets the main extension's version and is shipped inside
// the main vsix (dist/opencode-voice.vsix), which installs it on the user's computer by itself.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { $ } from "bun"

const root = JSON.parse(readFileSync("package.json", "utf8"))
const companionPath = "companion/package.json"
const companion = JSON.parse(readFileSync(companionPath, "utf8"))
if (companion.version !== root.version) {
  companion.version = root.version
  writeFileSync(companionPath, JSON.stringify(companion, null, 2) + "\n")
}
await $`bun run build`
await $`vsce package --no-dependencies --out ../opencode-voice.vsix`.cwd("companion")
copyFileSync("opencode-voice.vsix", "dist/opencode-voice.vsix")
await $`vsce package --no-dependencies --out opencode-vscode.vsix`

// Packages both extensions. The companion (OpenCode Voice) gets the main extension's version and is shipped inside
// the main vsix (dist/opencode-voice.vsix), which installs it on the user's computer by itself.
//
//   bun run package                 release build: opencode-vscode.vsix + opencode-voice.vsix
//   bun run package -- --test 11    test build: same extension ids (it replaces the installed one, no second copy),
//                                   version <next patch>-test.11, names end with "TEST 11", files
//                                   opencode-unofficial-<version>.vsix + opencode-voice-<version>.vsix.
//                                   package.json files are restored afterwards; never publish a test build.
//
// Runs in apps/vscode (it changes into it first, so it works from any directory). The vsix files are written there,
// where tools/publish.ts reads them. README.md, CHANGELOG.md and LICENSE live at the repo root (the source of truth);
// vsce packs them from the extension folder, so they are copied here first (git-ignored copies).
import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { $ } from "bun"

const repoRoot = resolve(import.meta.dir, "../../..")
process.chdir(resolve(import.meta.dir, ".."))
for (const file of ["README.md", "CHANGELOG.md", "LICENSE"]) copyFileSync(resolve(repoRoot, file), file)

const rootPath = "package.json"
const companionPath = "companion/package.json"

const testArg = process.argv.indexOf("--test")
const testNo = testArg >= 0 ? process.argv[testArg + 1] : undefined
if (testArg >= 0 && !/^\d+$/.test(testNo ?? "")) throw new Error("--test needs a build number, e.g. --test 11")

const rootText = readFileSync(rootPath, "utf8")
const companionText = readFileSync(companionPath, "utf8")
const root = JSON.parse(rootText)
const companion = JSON.parse(companionText)

const save = (path: string, json: unknown) => writeFileSync(path, JSON.stringify(json, null, 2) + "\n")

if (!testNo) {
  if (companion.version !== root.version) {
    companion.version = root.version
    save(companionPath, companion)
  }
  await $`bun run build`
  await $`vsce package --no-dependencies --out ../opencode-voice.vsix`.cwd("companion")
  copyFileSync("opencode-voice.vsix", "dist/opencode-voice.vsix")
  await $`vsce package --no-dependencies --out opencode-vscode.vsix`
} else {
  const [major, minor, patch] = String(root.version).split(/[.-]/).map(Number)
  const version = `${major}.${minor}.${patch + 1}-test.${testNo}`
  const label = ` TEST ${testNo}`
  try {
    save(rootPath, { ...root, version, displayName: `${root.displayName}${label}` })
    save(companionPath, { ...companion, version, displayName: `${companion.displayName}${label}` })
    await $`bun run build`
    await $`vsce package --no-dependencies --out ../opencode-voice-${version}.vsix`.cwd("companion")
    copyFileSync(`opencode-voice-${version}.vsix`, "dist/opencode-voice.vsix")
    await $`vsce package --no-dependencies --out opencode-unofficial-${version}.vsix`
    console.log(`Test build ${version}: opencode-unofficial-${version}.vsix, opencode-voice-${version}.vsix`)
  } finally {
    writeFileSync(rootPath, rootText)
    writeFileSync(companionPath, companionText)
  }
}

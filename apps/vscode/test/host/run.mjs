// Launches a real VS Code (downloaded by @vscode/test-electron) with the built extension and runs suite.cjs inside it.
// Needs a display: on a headless Linux box run it under `xvfb-run -a bun test/host/run.mjs`.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { runTests } from "@vscode/test-electron"

const root = resolve(import.meta.dirname, "../..")
const scratch = mkdtempSync(join(tmpdir(), "occ-host-"))
const workspace = join(scratch, "workspace")

try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, "test/host/suite.cjs"),
    launchArgs: [workspace, "--user-data-dir", join(scratch, "user"), "--extensions-dir", join(scratch, "ext"), "--disable-extensions", "--disable-workspace-trust"],
    // The smoke test must never start or touch the shared OpenCode service.
    extensionTestsEnv: { OPENCODE_SMOKE: "1" },
  })
} catch (e) {
  console.error("Host smoke test failed:", e instanceof Error ? e.message : e)
  process.exitCode = 1
}

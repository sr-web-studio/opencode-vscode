// Bundles the extension host (CJS) into dist/extension.js, and the voice companion into companion/dist.
// @opencode/client is ESM-only; esbuild inlines it (and its deps) into the CJS output.
import { build, context } from "esbuild"
import { cpSync, mkdirSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { createRequire } from "node:module"

const watch = process.argv.includes("--watch")

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["vscode"],
  minify: false,
  logLevel: "info",
  mainFields: ["module", "main"],
  conditions: ["import", "node"],
}

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  { ...common, entryPoints: ["src/extension/extension.ts"], outfile: "dist/extension.js", sourcemap: true },
  // The companion (OpenCode Voice) runs on the user's laptop. No source maps: it is published as its own small vsix.
  { ...common, entryPoints: ["src/companion/extension.ts"], outfile: "companion/dist/extension.js" },
  { ...common, entryPoints: ["src/companion/recorder-process.ts"], outfile: "companion/dist/recorder.js" },
]

// pvrecorder is loaded from files, not bundled: it resolves its native binary as `__dirname/../lib/<platform>`.
// Only the desktop builds the companion supports are shipped (no Raspberry Pi builds).
function copyRecorder() {
  // Workspace installs may hoist the package to the repo root, so resolve it instead of assuming ./node_modules.
  const from = dirname(createRequire(import.meta.url).resolve("@picovoice/pvrecorder-node/package.json"))
  const to = "companion/dist/pvrecorder"
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  cpSync(`${from}/dist`, `${to}/dist`, { recursive: true, filter: (p) => !p.endsWith(".map") && !p.includes("/types") })
  for (const dir of ["linux/x86_64", "mac/arm64", "mac/x86_64", "windows/amd64", "windows/arm64"]) {
    cpSync(`${from}/lib/${dir}`, `${to}/lib/${dir}`, { recursive: true })
  }
  cpSync(`${from}/package.json`, `${to}/package.json`)
}

copyRecorder()
if (watch) {
  for (const options of builds) await (await context(options)).watch()
  console.log("[esbuild] watching…")
} else {
  await Promise.all(builds.map((options) => build(options)))
}

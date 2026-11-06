// Bundles the extension host (CJS) into dist/extension.js.
// @opencode/client is ESM-only; esbuild inlines it (and its deps) into the CJS output.
import { build, context } from "esbuild"

const watch = process.argv.includes("--watch")

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["vscode"],
  sourcemap: true,
  minify: false,
  logLevel: "info",
  mainFields: ["module", "main"],
  conditions: ["import", "node"],
}

if (watch) {
  const ctx = await context(options)
  await ctx.watch()
  console.log("[esbuild] watching…")
} else {
  await build(options)
}

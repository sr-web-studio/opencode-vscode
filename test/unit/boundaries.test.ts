import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

const imports = (file: string) => [...readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\(|import\s+)["']([^"']+)["']/g)].map((m) => m[1]!)

/** core/ and ui/ must move into packages and run in a browser webview later. */
describe("code boundaries", () => {
  for (const dir of ["src/core", "src/ui"]) {
    const files = walk(dir).filter((f) => /\.(ts|svelte)$/.test(f))
    test(`${dir} has no vscode, node:* or service imports (${files.length} files)`, () => {
      const bad = files.flatMap((f) => imports(f).filter((i) => i === "vscode" || i.startsWith("node:") || i === "fs" || i === "path" || i === "os" || i.startsWith("@opencode/client/service") || i.includes("/extension/")).map((i) => `${f}: ${i}`))
      expect(bad).toEqual([])
    })
  }
  test("webview entry uses only the root client entry", () => {
    const bad = walk("src/webview").flatMap((f) => imports(f).filter((i) => i === "vscode" || i.startsWith("node:") || i.startsWith("@opencode/client/")).map((i) => `${f}: ${i}`))
    expect(bad).toEqual([])
  })
  test("only types are imported from @opencode/client in core/ui (nothing pulled into the webview bundle)", () => {
    const files = [...walk("src/core"), ...walk("src/ui")].filter((f) => /\.(ts|svelte)$/.test(f))
    const bad = files.filter((f) => /import\s+(?!type\b)[^;]*from\s+["']@opencode\/client["']/.test(readFileSync(f, "utf8")))
    expect(bad).toEqual([])
  })
})

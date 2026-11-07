import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

const imports = (file: string) => [...readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\(|import\s+)["']([^"']+)["']/g)].map((m) => m[1]!)

const NODE_BUILTINS = new Set(["fs", "path", "os", "child_process", "crypto", "zlib", "stream", "events", "buffer", "util", "net", "http", "https", "url"])
const usesNode = (i: string) => i.startsWith("node:") || NODE_BUILTINS.has(i.split("/")[0]!)

/** core and ui must run in a browser webview (VS Code today, a Capacitor WebView later). */
describe("code boundaries", () => {
  for (const dir of ["packages/core/src", "packages/ui/src"]) {
    const files = walk(dir).filter((f) => /\.(ts|svelte)$/.test(f))
    test(`${dir} has no vscode, node:* or service imports (${files.length} files)`, () => {
      const bad = files.flatMap((f) => imports(f).filter((i) => i === "vscode" || usesNode(i) || i.startsWith("@opencode/client/service") || i.includes("/extension/") || i.includes("apps/")).map((i) => `${f}: ${i}`))
      expect(bad).toEqual([])
    })
  }
  test("packages/core imports no other workspace package and no host code", () => {
    const files = walk("packages/core/src").filter((f) => /\.(ts|svelte)$/.test(f))
    const bad = files.flatMap((f) => imports(f).filter((i) => i.startsWith("@occ/") || i.startsWith("$ui") || i.includes("/ui/")).map((i) => `${f}: ${i}`))
    expect(bad).toEqual([])
  })
  test("packages/ui imports only @occ/core from the workspace", () => {
    const files = walk("packages/ui/src").filter((f) => /\.(ts|svelte)$/.test(f))
    const bad = files.flatMap((f) => imports(f).filter((i) => i.startsWith("@occ/") && !i.startsWith("@occ/core/")).map((i) => `${f}: ${i}`))
    expect(bad).toEqual([])
  })
  test("packages/core and packages/ui declare no vscode or node type dependency", () => {
    for (const dir of ["packages/core", "packages/ui"]) {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      expect(deps.filter((d) => d === "vscode" || d === "@types/vscode" || d === "@types/node" || d === "@occ/vscode")).toEqual([])
    }
  })
  test("webview entry uses only the root client entry", () => {
    const bad = walk("apps/vscode/src/webview").flatMap((f) => imports(f).filter((i) => i === "vscode" || usesNode(i) || i.startsWith("@opencode/client/")).map((i) => `${f}: ${i}`))
    expect(bad).toEqual([])
  })
  test("only types are imported from @opencode/client in core/ui (nothing pulled into the webview bundle)", () => {
    const files = [...walk("packages/core/src"), ...walk("packages/ui/src")].filter((f) => /\.(ts|svelte)$/.test(f))
    const bad = files.filter((f) => /import\s+(?!type\b)[^;]*from\s+["']@opencode\/client["']/.test(readFileSync(f, "utf8")))
    expect(bad).toEqual([])
  })
})

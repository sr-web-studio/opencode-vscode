import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.(svelte|ts|css)$/.test(n) ? [p] : []
  })

const vars = (text: string) => new Set([...text.matchAll(/--vscode-[A-Za-z0-9-]+/g)].map((m) => m[0]))

const theme = readFileSync("apps/mobile/src/theme.css", "utf8")
const [dark, light] = theme.split("@media (prefers-color-scheme: light)")

describe("mobile theme", () => {
  test("defines every --vscode-* variable that packages/ui and packages/core read", () => {
    const used = new Set<string>()
    for (const dir of ["packages/ui/src", "packages/core/src"]) for (const f of files(dir)) for (const v of vars(readFileSync(f, "utf8"))) used.add(v)
    const defined = vars(dark!)
    // `--vscode-terminal-` and `--vscode-terminal-ansi` are prefixes (core/ansi.ts builds the full name at run time, and a
    // comment says `ansi*`); the sixteen real ansi names are checked below.
    const prefixes = new Set(["--vscode-terminal-", "--vscode-terminal-ansi"])
    const missing = [...used].filter((v) => !prefixes.has(v) && !defined.has(v))
    expect(missing).toEqual([])
  })

  test("all sixteen ansi colors that core/ansi.ts can name exist in both schemes", () => {
    const names = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"].flatMap((n) => [`ansi${n}`, `ansiBright${n}`])
    for (const part of [dark!, light!]) for (const n of names) expect(part).toContain(`--vscode-terminal-${n}:`)
  })

  test("the light scheme only overrides variables that the dark one defines", () => {
    const d = vars(dark!)
    expect([...vars(light!)].filter((v) => !d.has(v))).toEqual([])
  })

  test("the light scheme gives the terminal colors a readable background", () => {
    expect(light).toContain("--vscode-terminal-background: #ffffff")
  })
})

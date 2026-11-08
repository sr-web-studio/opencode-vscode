import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { aboutLine } from "../../apps/mobile/src/lib/version"

const root = join(import.meta.dir, "../../apps/mobile")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }

describe("app version and preview label", () => {
  test("the preview line names the version, the preview build and the disclaimer", () => {
    expect(aboutLine("0.2.2-beta")).toBe("OpenCode (unofficial) 0.2.2-beta · Preview build · Not affiliated with the OpenCode team")
  })
  test("a plain release carries no preview wording", () => {
    expect(aboutLine("1.0.0")).toBe("OpenCode (unofficial) 1.0.0 · Not affiliated with the OpenCode team")
  })
  test("package.json is a beta and the Android versionName is the same string", () => {
    expect(pkg.version).toMatch(/-beta/)
    const gradle = readFileSync(join(root, "android/app/build.gradle"), "utf8")
    expect(/versionName\s+"([^"]+)"/.exec(gradle)?.[1]).toBe(pkg.version)
    expect(Number(/versionCode\s+(\d+)/.exec(gradle)?.[1])).toBeGreaterThanOrEqual(3)
  })
  test("the app never suggests `opencode pair`", () => {
    for (const f of ["src/screens/ServersScreen.svelte", "src/screens/ServerFormScreen.svelte", "src/lib/pairing-link.ts"]) {
      const text = readFileSync(join(root, f), "utf8")
      expect(text).not.toMatch(/opencode pair|pair --remote/)
    }
  })
})

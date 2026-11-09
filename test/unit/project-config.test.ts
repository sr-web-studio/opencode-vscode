import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { NEW_CONFIG_TEXT, type ConfigHost } from "@occ/core/global-config"
import { openProjectConfig, projectConfigCandidates, resolveProjectConfig } from "@occ/core/project-config"

const root = "/home/ann/app"
const linux = { root, platform: "linux" }

describe("project config candidates", () => {
  test("direct opencode.json(c) first, then .opencode/opencode.json(c), in OpenCode's load order", () => {
    expect(projectConfigCandidates("linux", root)).toEqual([`${root}/opencode.json`, `${root}/opencode.jsonc`, `${root}/.opencode/opencode.json`, `${root}/.opencode/opencode.jsonc`])
  })
  test("Windows paths", () => {
    expect(projectConfigCandidates("win32", "C:\\Users\\Ann\\app")).toEqual([
      "C:\\Users\\Ann\\app\\opencode.json",
      "C:\\Users\\Ann\\app\\opencode.jsonc",
      "C:\\Users\\Ann\\app\\.opencode\\opencode.json",
      "C:\\Users\\Ann\\app\\.opencode\\opencode.jsonc",
    ])
  })
})

describe("which project file to open", () => {
  test("only the direct opencode.json exists: that one", () => {
    expect(resolveProjectConfig({ ...linux, existing: [`${root}/opencode.json`] })).toMatchObject({ path: `${root}/opencode.json`, exists: true })
  })
  test("both direct files exist: opencode.jsonc, which OpenCode loads last", () => {
    expect(resolveProjectConfig({ ...linux, existing: [`${root}/opencode.json`, `${root}/opencode.jsonc`] })?.path).toBe(`${root}/opencode.jsonc`)
  })
  test("a .opencode file overrides the direct one", () => {
    expect(resolveProjectConfig({ ...linux, existing: [`${root}/opencode.jsonc`, `${root}/.opencode/opencode.json`] })?.path).toBe(`${root}/.opencode/opencode.json`)
  })
  test("all four exist: .opencode/opencode.jsonc has the highest precedence", () => {
    const existing = projectConfigCandidates("linux", root)
    expect(resolveProjectConfig({ ...linux, existing })?.path).toBe(`${root}/.opencode/opencode.jsonc`)
  })
  test("none exists: the path OpenCode would read in the folder, not yet existing", () => {
    expect(resolveProjectConfig({ ...linux, existing: [] })).toEqual({
      root,
      path: `${root}/opencode.jsonc`,
      exists: false,
      candidates: projectConfigCandidates("linux", root),
    })
  })
  test("unrelated files do not count", () => {
    expect(resolveProjectConfig({ ...linux, existing: [`${root}/config.json`, `${root}/opencode.json.bak`] })?.exists).toBe(false)
  })
  test("no folder: unknown", () => {
    expect(resolveProjectConfig({ root: "", platform: "linux", existing: [] })).toBeUndefined()
  })
})

/** A fake machine: `files` is what exists; every effect is recorded. */
function fake(files: string[], answer = true) {
  const log: string[] = []
  const host: ConfigHost = {
    exists: async (p) => files.includes(p),
    confirmCreate: async (p) => (log.push(`ask ${p}`), answer),
    create: async (p, text) => (log.push(`create ${p} ${JSON.stringify(text)}`), void files.push(p)),
    open: async (p) => void log.push(`open ${p}`),
    info: (m) => void log.push(`info ${m}`),
  }
  return { host, log }
}
const local = { root, platform: "linux", serverUrl: "" }

describe("openProjectConfig", () => {
  test("existing file: opened, no question, nothing created", async () => {
    const { host, log } = fake([`${root}/.opencode/opencode.jsonc`])
    expect(await openProjectConfig(local, host)).toBe("opened")
    expect(log).toEqual([`open ${root}/.opencode/opencode.jsonc`])
  })
  test("missing: asks first; Cancel changes nothing", async () => {
    const { host, log } = fake([], false)
    expect(await openProjectConfig(local, host)).toBe("cancelled")
    expect(log).toEqual([`ask ${root}/opencode.jsonc`])
  })
  test("missing and confirmed: creates only the schema line, then opens", async () => {
    const { host, log } = fake([])
    expect(await openProjectConfig(local, host)).toBe("created")
    expect(log).toEqual([`ask ${root}/opencode.jsonc`, `create ${root}/opencode.jsonc ${JSON.stringify(NEW_CONFIG_TEXT)}`, `open ${root}/opencode.jsonc`])
  })
  test("another computer's server: the same notice as the global command, no file access at all", async () => {
    const { host, log } = fake([`${root}/opencode.json`])
    const r = await openProjectConfig({ ...local, serverUrl: "http://192.168.1.10:4096", serverHostname: "my-server", localHostname: "laptop" }, host)
    expect(r).toBe("remote")
    expect(log).toHaveLength(1)
    expect(log[0]).toContain("my-server")
    expect(log[0]).toContain("usually")
  })
  test("no folder: says to open one first", async () => {
    const { host, log } = fake([])
    expect(await openProjectConfig({ ...local, root: "" }, host)).toBe("no-folder")
    expect(log).toEqual(["info Open a folder first."])
  })
})

describe("wiring", () => {
  const pkg = JSON.parse(readFileSync("apps/vscode/package.json", "utf8"))
  test("the command is contributed and in the palette, without a title-bar icon", () => {
    const cmd = pkg.contributes.commands.find((c: { command: string }) => c.command === "opencode.openProjectConfig")
    expect(cmd).toMatchObject({ title: "Open Project Config", category: "OpenCode" })
    expect(cmd.icon).toBeUndefined()
    expect(pkg.contributes.menus["view/title"]).not.toContainEqual(expect.objectContaining({ command: "opencode.openProjectConfig" }))
    expect(pkg.contributes.menus.commandPalette ?? []).not.toContainEqual(expect.objectContaining({ command: "opencode.openProjectConfig", when: "false" }))
  })
  test("the command reads the chat view's active folder", () => {
    const src = readFileSync("apps/vscode/src/extension/extension.ts", "utf8")
    expect(src).toContain(`registerCommand("opencode.openProjectConfig"`)
    expect(src).toMatch(/registerCommand\("opencode\.openProjectConfig",\s*\(\)\s*=>\s*openProjectConfigCommand\(folders\.activeDirectoryName,/)
  })
  test("the Settings page groups both config actions and allows the new command", () => {
    const src = readFileSync("apps/vscode/src/extension/settings-page.ts", "utf8")
    expect(src).toContain(`command: "opencode.openGlobalConfig"`)
    expect(src).toContain(`command: "opencode.openProjectConfig"`)
    expect(src.match(/group: "OpenCode config"/g)).toHaveLength(2)
    // ALLOWED_COMMANDS is derived from every action, so the new row is allowed without a second list to keep in sync.
    expect(src).toContain("...ACTIONS.map((action) => action.command)")
  })
})

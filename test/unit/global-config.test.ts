import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { CONFIG_SCHEMA, NEW_CONFIG_TEXT, configPlace, globalConfigDir, openGlobalConfig, remoteConfigNotice, resolveGlobalConfig, type ConfigHost } from "@occ/core/global-config"

const linux = { env: {}, home: "/home/ann", platform: "linux" }

describe("global config location", () => {
  test("default is ~/.config/opencode", () => {
    expect(globalConfigDir(linux)).toBe("/home/ann/.config/opencode")
  })
  test("XDG_CONFIG_HOME wins over the home folder; an empty one counts as unset", () => {
    expect(globalConfigDir({ ...linux, env: { XDG_CONFIG_HOME: "/data/cfg/" } })).toBe("/data/cfg/opencode")
    expect(globalConfigDir({ ...linux, env: { XDG_CONFIG_HOME: "" } })).toBe("/home/ann/.config/opencode")
  })
  test("OPENCODE_CONFIG_DIR is the directory itself and wins over XDG", () => {
    expect(globalConfigDir({ ...linux, env: { OPENCODE_CONFIG_DIR: "/srv/oc", XDG_CONFIG_HOME: "/data/cfg" } })).toBe("/srv/oc")
  })
  test("Windows uses %USERPROFILE%\\.config\\opencode with backslashes (not APPDATA)", () => {
    const win = { env: { APPDATA: "C:\\Users\\Ann\\AppData\\Roaming" }, home: "C:\\Users\\Ann", platform: "win32" }
    expect(globalConfigDir(win)).toBe("C:\\Users\\Ann\\.config\\opencode")
    expect(globalConfigDir({ ...win, env: { XDG_CONFIG_HOME: "D:\\cfg\\" } })).toBe("D:\\cfg\\opencode")
  })
  test("no home and no variables: unknown", () => {
    expect(globalConfigDir({ env: {}, home: "", platform: "linux" })).toBeUndefined()
    expect(resolveGlobalConfig({ env: {}, home: "", platform: "linux", existing: [] })).toBeUndefined()
  })
  test("OPENCODE_CONFIG (a single extra file) is not the global config", () => {
    const r = resolveGlobalConfig({ ...linux, env: { OPENCODE_CONFIG: "/tmp/x.json" }, existing: [] })
    expect(r?.dir).toBe("/home/ann/.config/opencode")
  })
})

describe("which file to open", () => {
  const dir = "/home/ann/.config/opencode"
  test("only opencode.json exists: that one", () => {
    expect(resolveGlobalConfig({ ...linux, existing: [`${dir}/opencode.json`] })).toMatchObject({ path: `${dir}/opencode.json`, exists: true })
  })
  test("only opencode.jsonc exists: that one", () => {
    expect(resolveGlobalConfig({ ...linux, existing: [`${dir}/opencode.jsonc`] })).toMatchObject({ path: `${dir}/opencode.jsonc`, exists: true })
  })
  test("both exist: opencode.jsonc, which OpenCode loads last (highest precedence)", () => {
    expect(resolveGlobalConfig({ ...linux, existing: [`${dir}/opencode.json`, `${dir}/opencode.jsonc`] })?.path).toBe(`${dir}/opencode.jsonc`)
  })
  test("none exists: the path OpenCode would read, not yet existing", () => {
    expect(resolveGlobalConfig({ ...linux, existing: [] })).toEqual({ dir, path: `${dir}/opencode.jsonc`, exists: false, candidates: [`${dir}/opencode.json`, `${dir}/opencode.jsonc`] })
  })
  test("unrelated files do not count (config.json, backups)", () => {
    expect(resolveGlobalConfig({ ...linux, existing: [`${dir}/config.json`, `${dir}/opencode.json.bak`] })?.exists).toBe(false)
  })
  test("Windows paths", () => {
    const r = resolveGlobalConfig({ env: {}, home: "C:\\Users\\Ann", platform: "win32", existing: ["C:\\Users\\Ann\\.config\\opencode\\opencode.json"] })
    expect(r?.path).toBe("C:\\Users\\Ann\\.config\\opencode\\opencode.json")
  })
})

describe("which computer", () => {
  test("no serverUrl or a loopback address: this machine", () => {
    expect(configPlace({ serverUrl: "" })).toEqual({ where: "here" })
    expect(configPlace({ serverUrl: "http://127.0.0.1:4096", serverHostname: "other" })).toEqual({ where: "here" })
    expect(configPlace({ serverUrl: "localhost:4096" })).toEqual({ where: "here" })
  })
  test("another address with the same host name as this machine: this machine", () => {
    expect(configPlace({ serverUrl: "http://192.168.1.10:4096", serverHostname: "Home server", localHostname: "home server" })).toEqual({ where: "here" })
  })
  test("another computer: the server's, with its name when known", () => {
    expect(configPlace({ serverUrl: "http://192.168.1.10:4096", serverHostname: "my-server", localHostname: "laptop" })).toEqual({ where: "server", hostname: "my-server" })
    expect(configPlace({ serverUrl: "https://opencode.example.com" })).toEqual({ where: "server", hostname: undefined })
  })
  test("the notice names the computer and never claims a path as fact", () => {
    expect(remoteConfigNotice("box")).toContain("“box”")
    expect(remoteConfigNotice()).toContain("computer that runs the server")
    expect(remoteConfigNotice("box")).toContain("usually")
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
const local = { env: {}, home: "/home/ann", platform: "linux", serverUrl: "" }

describe("openGlobalConfig", () => {
  test("existing file: opened, no question, nothing created", async () => {
    const { host, log } = fake(["/home/ann/.config/opencode/opencode.json"])
    expect(await openGlobalConfig(local, host)).toBe("opened")
    expect(log).toEqual(["open /home/ann/.config/opencode/opencode.json"])
  })
  test("missing: asks first; Cancel changes nothing", async () => {
    const { host, log } = fake([], false)
    expect(await openGlobalConfig(local, host)).toBe("cancelled")
    expect(log).toEqual(["ask /home/ann/.config/opencode/opencode.jsonc"])
  })
  test("missing and confirmed: creates only the schema line, then opens", async () => {
    const { host, log } = fake([])
    expect(await openGlobalConfig(local, host)).toBe("created")
    expect(log).toEqual([
      "ask /home/ann/.config/opencode/opencode.jsonc",
      `create /home/ann/.config/opencode/opencode.jsonc ${JSON.stringify(NEW_CONFIG_TEXT)}`,
      "open /home/ann/.config/opencode/opencode.jsonc",
    ])
  })
  test("another computer's server: an info message, no file access at all", async () => {
    const { host, log } = fake(["/home/ann/.config/opencode/opencode.json"])
    const r = await openGlobalConfig({ ...local, serverUrl: "http://192.168.1.10:4096", serverHostname: "my-server", localHostname: "laptop" }, host)
    expect(r).toBe("remote")
    expect(log).toHaveLength(1)
    expect(log[0]).toContain("my-server")
  })
  test("no home folder: says so", async () => {
    const { host, log } = fake([])
    expect(await openGlobalConfig({ ...local, home: "" }, host)).toBe("unknown")
    expect(log[0]).toStartWith("info ")
  })
})

describe("new file content", () => {
  test("only the schema line, valid JSON", () => {
    expect(JSON.parse(NEW_CONFIG_TEXT)).toEqual({ $schema: CONFIG_SCHEMA })
    expect(CONFIG_SCHEMA).toBe("https://opencode.ai/config.json")
  })
})

describe("wiring", () => {
  const pkg = JSON.parse(readFileSync("apps/vscode/package.json", "utf8"))
  test("the command is contributed and in the palette, without a title-bar icon", () => {
    const cmd = pkg.contributes.commands.find((c: { command: string }) => c.command === "opencode.openGlobalConfig")
    expect(cmd).toMatchObject({ title: "Open Global Config", category: "OpenCode" })
    expect(cmd.icon).toBeUndefined()
    expect(pkg.contributes.menus["view/title"]).not.toContainEqual(expect.objectContaining({ command: "opencode.openGlobalConfig" }))
    expect(pkg.contributes.menus.commandPalette ?? []).not.toContainEqual(expect.objectContaining({ command: "opencode.openGlobalConfig", when: "false" }))
  })
  test("the chat view's title bar has one gear: the Settings page", () => {
    const view = pkg.contributes.views.opencode[0].id
    expect(pkg.contributes.menus["view/title"]).toEqual([{ command: "opencode.openSettings", when: `view == ${view}`, group: "navigation@95" }])
    const gear = pkg.contributes.commands.find((c: { command: string }) => c.command === "opencode.openSettings")
    expect(gear).toMatchObject({ icon: "$(settings-gear)" })
  })
  test("the MCP panel button posts the host request, and the host routes it to the command", () => {
    expect(readFileSync("packages/ui/src/components/McpPanel.svelte", "utf8")).toContain(`request: { type: "openGlobalConfig" }`)
    expect(readFileSync("packages/core/src/protocol.ts", "utf8")).toContain(`{ type: "openGlobalConfig" }`)
    const host = readFileSync("apps/vscode/src/extension/host.ts", "utf8")
    expect(host).toMatch(/case "openGlobalConfig":\s+return void \(await vscode\.commands\.executeCommand\("opencode\.openGlobalConfig"\)\)/)
    expect(readFileSync("apps/vscode/src/extension/extension.ts", "utf8")).toContain(`registerCommand("opencode.openGlobalConfig"`)
  })
  test("the extension only opens the file: the sole write is the confirmed `wx` create of the schema line", () => {
    const src = readFileSync("apps/vscode/src/extension/global-config.ts", "utf8")
    expect(src.match(/writeFile\(/g)).toHaveLength(1)
    expect(src).toContain(`flag: "wx"`)
  })
})

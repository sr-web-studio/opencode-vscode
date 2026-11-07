import { describe, expect, test } from "bun:test"
import { deniedMessage, micSettingsTarget, regValue, windowsMicPermission } from "../../apps/vscode/src/companion/privacy"

const out = (v: string) => `\r\nHKEY_CURRENT_USER\\Software\\...\\microphone\r\n    Value    REG_SZ    ${v}\r\n\r\n`

describe("Windows microphone permission", () => {
  test("reads the value of `reg query … /v Value`", () => {
    expect(regValue(out("Allow"))).toBe("Allow")
    expect(regValue("ERROR: The system was unable to find the specified registry key")).toBeUndefined()
  })
  test("any Deny blocks, and names the switches to turn on", () => {
    const p = windowsMicPermission([out("Allow"), out("Allow"), out("Deny")])
    expect(p).toEqual({ state: "denied", switches: ["Let desktop apps access your microphone"] })
    expect(deniedMessage(p.state === "denied" ? p.switches : [])).toContain("“Let desktop apps access your microphone”")
    expect(windowsMicPermission([out("Deny"), out("Allow"), out("Allow")])).toMatchObject({ state: "denied", switches: ["Microphone access"] })
  })
  test("all allowed, or nothing readable (older Windows): recording goes ahead", () => {
    expect(windowsMicPermission([out("Allow"), out("Allow"), out("Allow")])).toEqual({ state: "allowed" })
    expect(windowsMicPermission([undefined, undefined, undefined])).toEqual({ state: "unknown" })
    expect(windowsMicPermission([undefined, out("Allow"), undefined])).toEqual({ state: "allowed" })
  })
  test("settings page per platform", () => {
    expect(micSettingsTarget("win32")).toEqual({ command: "explorer.exe", args: ["ms-settings:privacy-microphone"] })
    expect(micSettingsTarget("darwin")?.command).toBe("open")
    expect(micSettingsTarget("linux")).toBeUndefined()
  })
})

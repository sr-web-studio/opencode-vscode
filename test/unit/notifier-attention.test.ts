import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { Notice } from "@occ/core/notifications/types"

/** The notifier is the only code here that talks to VS Code: stand `vscode` in with just what it uses. */
const state = { focused: false }
const calls: Array<{ command: string; args: unknown[] }> = []
const toasts: string[] = []
let executeResult: () => Promise<unknown> = () => Promise.resolve(undefined)

mock.module("vscode", () => ({
  window: {
    state: {
      get focused() {
        return state.focused
      },
    },
    showWarningMessage: (text: string) => (toasts.push(`warn:${text}`), Promise.resolve(undefined)),
    showInformationMessage: (text: string) => (toasts.push(`info:${text}`), Promise.resolve(undefined)),
  },
  commands: {
    executeCommand: (command: string, ...args: unknown[]) => {
      calls.push({ command, args })
      return executeResult()
    },
  },
}))

const { VscodeNotifier } = await import("../../apps/vscode/src/extension/notifier")

const notice = (over: Partial<Notice> = {}): Notice => ({ id: "n1", kind: "completed", sessionID: "s", severity: "info", title: "OpenCode", body: "Done", actions: [], ...over })
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  state.focused = false
  calls.length = 0
  toasts.length = 0
  executeResult = () => Promise.resolve(undefined)
})

describe("VscodeNotifier window attention", () => {
  test("unfocused + auto: shows the toast, then asks the companion", () => {
    const n = new VscodeNotifier(() => undefined, { os: () => "auto" })
    n.show(notice({ kind: "permission", severity: "warning", title: "Permission", body: "rm -rf dist" }))
    expect(toasts).toEqual(["warn:Permission: rm -rf dist"])
    expect(calls).toEqual([{ command: "opencode.companion.attention", args: [{ kind: "permission", title: "Permission", body: "rm -rf dist" }] }])
  })

  test("focused window: no call", () => {
    state.focused = true
    new VscodeNotifier(() => undefined, { os: () => "auto" }).show(notice())
    expect(toasts.length).toBe(1)
    expect(calls).toEqual([])
  })

  test("os off: no call", () => {
    new VscodeNotifier(() => undefined, { os: () => "off" }).show(notice())
    expect(toasts.length).toBe(1)
    expect(calls).toEqual([])
  })

  test("no options: no call", () => {
    new VscodeNotifier(() => undefined).show(notice())
    expect(calls).toEqual([])
  })

  test("companion missing: nothing thrown, logged once", async () => {
    executeResult = () => Promise.reject(new Error("command 'opencode.companion.attention' not found"))
    const lines: string[] = []
    const n = new VscodeNotifier(() => undefined, { os: () => "auto", log: (l) => lines.push(l) })
    expect(() => n.show(notice())).not.toThrow()
    n.show(notice({ id: "n2" }))
    await flush()
    expect(calls.length).toBe(2)
    const missing = lines.filter((l) => l.includes("did not take the request"))
    expect(missing.length).toBe(1)
    expect(missing[0]).toContain("not found")
  })

  test("the log says whether attention was requested or why it was skipped (kind and session id only)", () => {
    const lines: string[] = []
    new VscodeNotifier(() => undefined, { os: () => "auto", log: (l) => lines.push(l) }).show(notice({ kind: "completed", sessionID: "ses_1", title: "Secret", body: "Secret body" }))
    state.focused = true
    new VscodeNotifier(() => undefined, { os: () => "auto", log: (l) => lines.push(l) }).show(notice({ kind: "failed", sessionID: "ses_2" }))
    state.focused = false
    new VscodeNotifier(() => undefined, { os: () => "off", log: (l) => lines.push(l) }).show(notice({ kind: "question", sessionID: "ses_3" }))
    expect(lines).toEqual([
      "Window attention requested (completed, session ses_1)",
      "Window attention skipped (failed, session ses_2): this window has the focus",
      "Window attention skipped (question, session ses_3): opencode.notifications.os is off",
    ])
  })

  test("a command that throws synchronously never reaches the caller", () => {
    executeResult = () => {
      throw new Error("boom")
    }
    const n = new VscodeNotifier(() => undefined, { os: () => "auto" })
    expect(() => n.show(notice())).not.toThrow()
  })

  test("a throwing setting reader never blocks the toast", () => {
    const n = new VscodeNotifier(() => undefined, {
      os: () => {
        throw new Error("settings")
      },
    })
    expect(() => n.show(notice())).not.toThrow()
    expect(toasts.length).toBe(1)
  })
})

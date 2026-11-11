import { describe, expect, test } from "bun:test"
import { TERMINAL_CLOSE_NOTICE, terminalCloseAction, type TerminalCloseCause } from "@occ/core/terminal-close"

describe("closing a mirrored terminal", () => {
  test("a running command the user closed tells them it still runs", () => {
    expect(terminalCloseAction({ running: true, cause: "user" })).toBe("notify")
  })
  test("a finished command never notifies", () => {
    expect(terminalCloseAction({ running: false, cause: "user" })).toBe("silent")
  })
  test("shutdown, reload, an extension dispose and trim stay silent", () => {
    const causes: TerminalCloseCause[] = ["shutdown", "extension", "unknown"]
    for (const cause of causes) expect(terminalCloseAction({ running: true, cause })).toBe("silent")
  })
  test("the notice names Show terminal", () => {
    expect(TERMINAL_CLOSE_NOTICE).toContain("Show terminal")
    expect(TERMINAL_CLOSE_NOTICE).toContain("keeps running on the server")
  })
})

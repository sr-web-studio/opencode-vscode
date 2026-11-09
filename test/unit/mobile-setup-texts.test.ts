import { describe, expect, test } from "bun:test"
import { ADDRESS_HELP, EMPTY_SERVERS_HELP, SCAN_HELP, SETUP_GUIDE_LABEL, SETUP_GUIDE_URL } from "../../apps/mobile/src/lib/texts"

/** The help texts of the app's server screens: they must say which computer, not the phone. */
describe("mobile setup texts", () => {
  test("the guide link is an absolute GitHub URL on main", () => {
    expect(SETUP_GUIDE_URL).toBe("https://github.com/sr-web-studio/opencode-vscode/blob/main/docs/mobile-setup.md")
    expect(SETUP_GUIDE_URL.startsWith("https://")).toBe(true)
  })
  test("the empty state offers both routes and names the computer, not the phone", () => {
    expect(EMPTY_SERVERS_HELP).toContain("Pair Mobile Device")
    expect(EMPTY_SERVERS_HELP).toContain("QR code")
    expect(EMPTY_SERVERS_HELP).toContain("computer's address")
    expect(EMPTY_SERVERS_HELP).toContain("server password")
    expect(EMPTY_SERVERS_HELP.toLowerCase()).not.toContain("this phone's address")
  })
  test("the scan help names the VS Code command and the code", () => {
    expect(SCAN_HELP).toContain("OpenCode: Pair Mobile Device")
    expect(SCAN_HELP).toContain("QR code")
  })
  test("the address help says it is the computer's address, not the phone's", () => {
    expect(ADDRESS_HELP).toContain("not this phone")
    expect(ADDRESS_HELP).toContain("password")
  })
  test("the link label is short enough for a button", () => {
    expect(SETUP_GUIDE_LABEL).toBe("How to set up the server")
  })
})

import { describe, expect, test } from "bun:test"
import { normalizeServerUrl, serverUrlProblem } from "@occ/core/server-url"

describe("server URL setting", () => {
  test("adds http:// when missing, keeps the port as typed, drops trailing slashes", () => {
    expect(normalizeServerUrl("")).toBe("")
    expect(normalizeServerUrl("  ")).toBe("")
    expect(normalizeServerUrl("192.168.1.10:4096")).toBe("http://192.168.1.10:4096")
    expect(normalizeServerUrl("my-box.tail1234.ts.net:4096/")).toBe("http://my-box.tail1234.ts.net:4096")
    expect(normalizeServerUrl("http://localhost:4096")).toBe("http://localhost:4096")
    expect(normalizeServerUrl("https://opencode.example.com//")).toBe("https://opencode.example.com")
    expect(normalizeServerUrl("HTTPS://Example.com")).toBe("HTTPS://Example.com")
  })
  test("explains addresses that can't work", () => {
    expect(serverUrlProblem("192.168.1.10:4096")).toBeUndefined()
    expect(serverUrlProblem("https://opencode.example.com")).toBeUndefined()
    expect(serverUrlProblem("ws://host:4096")).toContain("http://")
    expect(serverUrlProblem("http://exa mple:12")).toContain("not a valid address")
  })
})

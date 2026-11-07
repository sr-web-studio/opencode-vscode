import { describe, expect, test } from "bun:test"
import { classifyConnectError } from "../../apps/mobile/src/lib/connect-error"

const URL = "http://10.0.0.10:4096"

describe("connection test errors", () => {
  test("401: the client's UnauthorizedError (a plain object with _tag)", () => {
    const e = Object.assign(new Error("Authentication required"), { _tag: "UnauthorizedError" })
    expect(classifyConnectError(e, URL).kind).toBe("unauthorized")
    expect(classifyConnectError({ _tag: "UnauthorizedError" }, URL).kind).toBe("unauthorized")
    expect(classifyConnectError(new Error("HTTP 401"), URL).kind).toBe("unauthorized")
  })
  test("unreachable: refused, timed out, no route, unknown host", () => {
    for (const m of ["Transport: ECONNREFUSED: Unable to connect", "connect ETIMEDOUT", "net::ERR_ADDRESS_UNREACHABLE EHOSTUNREACH", "getaddrinfo ENOTFOUND box", "The request timed out"]) {
      const r = classifyConnectError(new Error(m), URL)
      expect(r.kind).toBe("unreachable")
      expect(r.message).toContain(URL)
    }
  })
  test("a browser TypeError (Failed to fetch) is the CORS-or-unreachable case and names the app's origin", () => {
    const r = classifyConnectError(new TypeError("Failed to fetch"), URL, "http://tauri.localhost")
    expect(r.kind).toBe("cors")
    expect(r.message).toContain("http://tauri.localhost")
    expect(r.message).toContain(URL)
    expect(classifyConnectError(new TypeError("Load failed"), URL).kind).toBe("cors")
  })
  test("a TypeError caused by a refused connection is still reported as unreachable (Bun/Node wording)", () => {
    const e = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 10.0.0.10:4096") })
    expect(classifyConnectError(e, URL).kind).toBe("unreachable")
  })
  test("anything else keeps its message; empty errors still say something", () => {
    expect(classifyConnectError(new Error("Boom"), URL)).toEqual({ kind: "other", message: "Could not connect: Boom" })
    expect(classifyConnectError(undefined, URL).message.length).toBeGreaterThan(5)
  })
})

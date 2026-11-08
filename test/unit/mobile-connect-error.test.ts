import { describe, expect, test } from "bun:test"
import { classifyConnectError, diagnoseConnectError, hostLabel, startProbe, PROBE_TIMEOUT_MS, type Probe } from "../../apps/mobile/src/lib/connect-error"

const URL = "http://192.168.1.10:4096"
const answered = (yes: boolean) => (): Probe => ({ result: Promise.resolve(yes), cancel() {} })

describe("diagnoseConnectError: Failed to fetch is settled by a second request", () => {
  const fetchError = new TypeError("Failed to fetch")

  test("the host does not answer: unreachable, in the wording for the user", async () => {
    const r = await diagnoseConnectError(fetchError, URL, "http://tauri.localhost", answered(false))
    expect(r).toEqual({ kind: "unreachable", message: "Can't reach 192.168.1.10:4096. Check the address, Wi-Fi or Tailscale." })
  })

  test("the host answers: it is the CORS list, and the origin is named", async () => {
    const r = await diagnoseConnectError(fetchError, URL, "http://tauri.localhost", answered(true))
    expect(r.kind).toBe("cors")
    expect(r.message).toContain("http://tauri.localhost")
    expect(r.message).toContain("CORS")
    expect(r.message).not.toContain("Can't reach")
  })

  test("other errors are not probed", async () => {
    let probed = 0
    const probe = (): Probe => (probed++, { result: Promise.resolve(true), cancel() {} })
    expect((await diagnoseConnectError({ _tag: "UnauthorizedError" }, URL, "", probe)).kind).toBe("unauthorized")
    expect((await diagnoseConnectError(new Error("connect ECONNREFUSED"), URL, "", probe)).kind).toBe("unreachable")
    expect((await diagnoseConnectError(new Error("Boom"), URL, "", probe)).kind).toBe("other")
    expect(probed).toBe(0)
  })

  test("the stored error of a server row and the form use the same function: same input, same words", async () => {
    const a = await diagnoseConnectError(fetchError, URL, "http://tauri.localhost", answered(false))
    const b = await diagnoseConnectError(fetchError, URL, "http://tauri.localhost", answered(false))
    expect(a).toEqual(b)
  })
})

describe("startProbe", () => {
  test("asks with no-cors and no cache; any answer (opaque) counts as reachable", async () => {
    let seen: { url: string; init: RequestInit } | undefined
    const fakeFetch = (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response(null))) as unknown as typeof fetch
    expect(await startProbe(URL, 1000, fakeFetch).result).toBe(true)
    expect(seen!.url).toBe(URL)
    expect(seen!.init.mode).toBe("no-cors")
    expect(seen!.init.cache).toBe("no-store")
  })

  test("a network error is false, never a rejection", async () => {
    const fakeFetch = (async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof fetch
    expect(await startProbe(URL, 1000, fakeFetch).result).toBe(false)
  })

  test("no answer within the timeout aborts the request and is false", async () => {
    let aborted = false
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal!.addEventListener("abort", () => {
          aborted = true
          reject(new DOMException("aborted", "AbortError"))
        })
      })) as unknown as typeof fetch
    const started = Date.now()
    expect(await startProbe(URL, 30, hang).result).toBe(false)
    expect(aborted).toBe(true)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test("the real timeout is 5 s, and the host label drops the scheme", () => {
    expect(PROBE_TIMEOUT_MS).toBe(5000)
    expect(hostLabel("http://10.0.0.99:4096")).toBe("10.0.0.99:4096")
    expect(hostLabel("https://box.tail1234.ts.net/")).toBe("box.tail1234.ts.net")
    expect(hostLabel("not a url")).toBe("not a url")
  })
})

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
      expect(r.message).toBe("Can't reach 192.168.1.10:4096. Check the address, Wi-Fi or Tailscale.")
    }
  })
  test("a browser TypeError (Failed to fetch) is provisionally CORS and names the app's origin", () => {
    const r = classifyConnectError(new TypeError("Failed to fetch"), URL, "http://tauri.localhost")
    expect(r.kind).toBe("cors")
    expect(r.message).toContain("http://tauri.localhost")
    expect(r.message).toContain("192.168.1.10:4096")
    expect(classifyConnectError(new TypeError("Load failed"), URL).kind).toBe("cors")
  })
  test("a TypeError caused by a refused connection is still reported as unreachable (Bun/Node wording)", () => {
    const e = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 192.168.1.10:4096") })
    expect(classifyConnectError(e, URL).kind).toBe("unreachable")
  })
  test("anything else keeps its message; empty errors still say something", () => {
    expect(classifyConnectError(new Error("Boom"), URL)).toEqual({ kind: "other", message: "Could not connect: Boom" })
    expect(classifyConnectError(undefined, URL).message.length).toBeGreaterThan(5)
  })
})

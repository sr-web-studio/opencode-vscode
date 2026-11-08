import { describe, expect, test } from "bun:test"
import { pairLink } from "../../apps/vscode/src/extension/pairing"
import { parsePairingLink } from "../../apps/mobile/src/lib/pairing-link"

const CODE = "AbCdEfGhIjKlMnOpQrStUv" // 22 URL-safe characters, like the server's codes

describe("pairing link (the QR of “OpenCode: Pair Mobile Device”)", () => {
  test("accepts exactly what the extension builds", () => {
    for (const base of ["http://192.168.1.10:4096", "http://192.168.1.10:4096/", "https://oc.example.com", "http://100.64.0.1:4096"]) {
      const r = parsePairingLink(pairLink(base, CODE))
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.link.code).toBe(CODE)
        expect(r.link.baseUrl).toBe(base.replace(/\/+$/, ""))
      }
    }
  })
  test("the example from the brief", () => {
    const r = parsePairingLink(`http://192.168.1.10:4096/auth/connect/${CODE}`)
    expect(r).toEqual({ ok: true, link: { baseUrl: "http://192.168.1.10:4096", code: CODE } })
  })
  test("trims whitespace and a trailing slash; decodes the code", () => {
    expect(parsePairingLink(`  http://h:1/auth/connect/${CODE}/  \n`)).toEqual({ ok: true, link: { baseUrl: "http://h:1", code: CODE } })
    const r = parsePairingLink(pairLink("http://h:1", "a b/c"))
    expect(r.ok && r.link.code).toBe("a b/c")
  })
  test("a reverse-proxy prefix stays in the base address; query and hash are ignored", () => {
    expect(parsePairingLink(`https://x.example.com/oc/auth/connect/${CODE}?utm=1#frag`)).toEqual({ ok: true, link: { baseUrl: "https://x.example.com/oc", code: CODE } })
  })
  test("refuses anything else, with a reason", () => {
    const bad = [
      "",
      "   ",
      "hello",
      "192.168.1.10:4096/auth/connect/abc",
      "ftp://h/auth/connect/abc",
      "http://h:4096",
      "http://h:4096/auth/connect/",
      "http://h:4096/auth/connect",
      "http://h:4096/other/abc",
      "opencode-mobile://session/ses_1",
      "http://h/auth/connect/%E0%A4%A",
    ]
    for (const raw of bad) {
      const r = parsePairingLink(raw)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(5)
    }
  })
})

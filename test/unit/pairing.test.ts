import { describe, expect, test } from "bun:test"
import { candidateUrls, canonicalUrl, classifyHost, customUrlProblem, expiresAt, formatCountdown, logHost, pairLink, secondsLeft } from "../../apps/vscode/src/extension/pairing"
import { escapeHtml, pairPanelCsp, pairPanelHtml, qrSvg } from "../../apps/vscode/src/extension/pairing-html"

describe("address classification", () => {
  test("private LAN ranges", () => {
    for (const h of ["192.168.1.10", "192.168.1.5", "172.16.0.1", "172.31.255.254", "printer.local"]) expect(classifyHost(h)).toBe("lan")
    expect(classifyHost("172.32.0.1")).toBe("custom")
    expect(classifyHost("172.15.0.1")).toBe("custom")
  })
  test("Tailscale is 100.64.0.0/10 and *.ts.net", () => {
    expect(classifyHost("100.64.0.1")).toBe("tailscale")
    expect(classifyHost("100.64.0.10")).toBe("tailscale")
    expect(classifyHost("100.127.255.255")).toBe("tailscale")
    expect(classifyHost("100.63.0.1")).toBe("custom")
    expect(classifyHost("100.128.0.1")).toBe("custom")
    expect(classifyHost("box.tail1234.ts.net")).toBe("tailscale")
    expect(classifyHost("[fd7a:115c:a1e0::1]")).toBe("tailscale")
  })
  test("loopback and wildcard", () => {
    for (const h of ["127.0.0.1", "127.1.2.3", "localhost", "LOCALHOST", "0.0.0.0", "[::1]", "[::]"]) expect(classifyHost(h)).toBe("loopback")
  })
  test("everything else is custom", () => {
    for (const h of ["8.8.8.8", "opencode.example.com", "[2001:db8::1]"]) expect(classifyHost(h)).toBe("custom")
  })
})

describe("candidate URLs", () => {
  const server = ["http://127.0.0.1:4096", "http://192.168.1.10:4096", "http://100.64.0.10:4096"]
  test("server URLs first, loopback dropped with a flag, kinds set", () => {
    const r = candidateUrls(server, "http://127.0.0.1:4096")
    expect(r.droppedLoopback).toBe(true)
    expect(r.candidates).toEqual([
      { url: "http://192.168.1.10:4096", kind: "lan" },
      { url: "http://100.64.0.10:4096", kind: "tailscale" },
    ])
  })
  test("the window URL is added once, even in another spelling", () => {
    const r = candidateUrls(server, "http://192.168.1.10:4096/")
    expect(r.candidates.map((c) => c.url)).toEqual(["http://192.168.1.10:4096", "http://100.64.0.10:4096"])
    const extra = candidateUrls(server, "https://Box.tail1234.ts.net")
    expect(extra.candidates.at(-1)).toEqual({ url: "https://box.tail1234.ts.net", kind: "tailscale" })
  })
  test("0.0.0.0, junk and non-http entries are ignored; no flag when nothing was dropped", () => {
    expect(candidateUrls(["http://0.0.0.0:4096", "nonsense", "ftp://x"], undefined)).toEqual({ candidates: [], droppedLoopback: true })
    expect(candidateUrls(["http://192.168.1.2:4096"], undefined).droppedLoopback).toBe(false)
  })
})

describe("typed address", () => {
  test("validates http(s) and rejects loopback", () => {
    expect(customUrlProblem("")).toContain("Enter an address")
    expect(customUrlProblem("192.168.1.2:4096")).toContain("http://")
    expect(customUrlProblem("ws://x")).toContain("http://")
    expect(customUrlProblem("http://localhost:4096")).toContain("this computer")
    expect(customUrlProblem("https://opencode.example.com")).toBeUndefined()
    expect(customUrlProblem(" http://192.168.1.2:4096 ")).toBeUndefined()
  })
  test("canonicalUrl drops path, trailing slash and lowercases the host", () => {
    expect(canonicalUrl("http://A.b:4096/some/path?x=1")).toBe("http://a.b:4096")
    expect(canonicalUrl("https://x.com:443/")).toBe("https://x.com")
    expect(canonicalUrl("x.com")).toBeUndefined()
  })
})

describe("link and logging", () => {
  test("link is base + /auth/connect/ + code", () => {
    expect(pairLink("http://192.168.1.10:4096/", "abc123")).toBe("http://192.168.1.10:4096/auth/connect/abc123")
    expect(pairLink("https://x.example.com", "a b/c")).toBe("https://x.example.com/auth/connect/a%20b%2Fc")
    expect(() => pairLink("nope", "x")).toThrow()
  })
  test("log line carries the host only", () => {
    expect(logHost("http://192.168.1.10:4096")).toBe("192.168.1.10:4096")
    expect(logHost("junk")).toBe("unknown host")
  })
})

describe("expiry countdown", () => {
  test("uses expires_in, falls back to 5 minutes for nonsense", () => {
    expect(expiresAt(1000, 300)).toBe(301_000)
    expect(expiresAt(1000, 60)).toBe(61_000)
    for (const bad of [undefined, 0, -5, Number.NaN]) expect(expiresAt(0, bad)).toBe(300_000)
    expect(expiresAt(0, 10 ** 9)).toBe(3_600_000)
  })
  test("seconds left rounds up and never goes negative", () => {
    expect(secondsLeft(300_000, 0)).toBe(300)
    expect(secondsLeft(300_000, 1)).toBe(300)
    expect(secondsLeft(300_000, 299_001)).toBe(1)
    expect(secondsLeft(300_000, 300_000)).toBe(0)
    expect(secondsLeft(300_000, 999_999)).toBe(0)
  })
  test("format m:ss", () => {
    expect(formatCountdown(300)).toBe("5:00")
    expect(formatCountdown(65)).toBe("1:05")
    expect(formatCountdown(7)).toBe("0:07")
    expect(formatCountdown(0)).toBe("0:00")
    expect(formatCountdown(-3)).toBe("0:00")
  })
})

describe("panel HTML", () => {
  const link = "http://192.168.1.10:4096/auth/connect/abc"
  const html = (now: number) => pairPanelHtml({ nonce: "N0NCE", cspSource: "vscode-webview://x", link, expiresAt: 300_000, now })
  test("strict CSP: no remote content, scripts and styles by nonce", () => {
    const csp = pairPanelCsp("N0NCE")
    expect(csp).toBe("default-src 'none'; style-src 'nonce-N0NCE'; script-src 'nonce-N0NCE'; img-src data:")
    const page = html(0)
    expect(page).toContain(`content="${csp}"`)
    // Only the link itself and the SVG namespace (an identifier, not a request) may look like a URL.
    expect(page.replaceAll("http://www.w3.org/2000/svg", "").replaceAll(link, "")).not.toMatch(/https?:\/\//)
    expect(page.match(/<script/g)?.length).toBe(1)
    expect(page).toContain('<script nonce="N0NCE">')
    expect(page).toContain('<style nonce="N0NCE">')
  })
  test("fresh code: countdown 5:00, copy shown, renew hidden; expired: greyed with New code", () => {
    const fresh = html(0)
    expect(fresh).toContain('id="timer" aria-live="off">5:00<')
    expect(fresh).toContain('<button id="renew" hidden>')
    expect(fresh).not.toContain('class="expired"')
    const gone = html(300_000)
    expect(gone).toContain('class="expired"')
    expect(gone).toContain('<button id="renew">New code</button>')
    expect(gone).toContain("This code has expired.")
  })
  test("shows the link, the instructions, and a QR svg; escapes the link", () => {
    const page = html(0)
    expect(page).toContain(`<code id="link">${link}</code>`)
    expect(page).toContain("Add server")
    expect(page).toContain("Scan QR")
    expect(page).toContain("same Wi-Fi or Tailscale")
    expect(page).toContain("<svg")
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;")
  })
  test("qrSvg is deterministic for the same text and differs for another", () => {
    expect(qrSvg(link)).toBe(qrSvg(link))
    expect(qrSvg(link)).not.toBe(qrSvg(link + "x"))
  })
})

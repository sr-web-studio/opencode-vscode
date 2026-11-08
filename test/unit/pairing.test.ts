import { describe, expect, test } from "bun:test"
import {
  KIND_DETAIL,
  KIND_LABEL,
  candidateUrls,
  canonicalUrl,
  classifyHost,
  customUrlProblem,
  expiresAt,
  formatCountdown,
  logHost,
  pairLink,
  secondsLeft,
} from "../../apps/vscode/src/extension/pairing"
import { escapeHtml, pairPanelCsp, pairPanelHtml, qrSvg } from "../../apps/vscode/src/extension/pairing-html"

describe("address classification", () => {
  test("private LAN ranges", () => {
    for (const h of ["192.168.1.10", "192.168.1.5", "172.16.0.1", "printer.local"]) expect(classifyHost(h)).toBe("lan")
    expect(classifyHost("172.32.0.1")).toBe("custom")
    expect(classifyHost("172.15.0.1")).toBe("custom")
  })
  test("Docker bridge ranges are container addresses, not LAN", () => {
    for (const h of ["172.17.0.1", "172.18.0.1", "172.31.255.254"]) expect(classifyHost(h)).toBe("container")
    // A real 172.17/16 LAN cannot be told apart from Docker, so it stays selectable as container.
    expect(classifyHost("172.16.0.1")).toBe("lan")
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
  test("link-local addresses", () => {
    for (const h of ["169.254.10.1", "169.254.255.255", "[fe80::1]", "[febf::1]"]) expect(classifyHost(h)).toBe("linklocal")
    expect(classifyHost("169.253.1.1")).toBe("custom")
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
  test("every label and detail explains the choice for a phone", () => {
    expect(KIND_LABEL.lan).toContain("same network")
    expect(KIND_LABEL.tailscale).toContain("Tailscale")
    expect(KIND_LABEL.custom).toContain("internet")
    expect(KIND_LABEL.container).toContain("container")
    expect(KIND_LABEL.linklocal).toContain("not reachable")
    for (const kind of ["lan", "tailscale", "custom", "container", "linklocal"] as const) {
      expect(KIND_DETAIL[kind].toLowerCase()).toMatch(/phone|computer|network/)
    }
  })
  test("server URLs first, loopback dropped with a flag, kinds set, first one recommended", () => {
    const r = candidateUrls(server, "http://127.0.0.1:4096")
    expect(r.droppedLoopback).toBe(true)
    expect(r.candidates).toEqual([
      { url: "http://192.168.1.10:4096", kind: "lan", recommended: true },
      { url: "http://100.64.0.10:4096", kind: "tailscale", recommended: false },
    ])
  })
  test("the window URL is added once, even in another spelling", () => {
    const r = candidateUrls(server, "http://192.168.1.10:4096/")
    expect(r.candidates.map((c) => c.url)).toEqual(["http://192.168.1.10:4096", "http://100.64.0.10:4096"])
    const extra = candidateUrls(server, "https://Box.tail1234.ts.net")
    expect(extra.candidates.map((c) => c.url)).toEqual(["http://100.64.0.10:4096", "https://box.tail1234.ts.net", "http://192.168.1.10:4096"])
    expect(extra.candidates[0]!.recommended).toBe(true)
  })
  test("0.0.0.0, junk and non-http entries are ignored; no flag when nothing was dropped", () => {
    expect(candidateUrls(["http://0.0.0.0:4096", "nonsense", "ftp://x"], undefined)).toEqual({ candidates: [], droppedLoopback: true })
    expect(candidateUrls(["http://192.168.1.2:4096"], undefined).droppedLoopback).toBe(false)
  })
  test("a window on Tailscale puts Tailscale first, a LAN window puts LAN first", () => {
    const both = ["http://192.168.1.10:4096", "http://100.64.0.10:4096"]
    const onTailscale = candidateUrls(both, "http://100.64.0.10:4096")
    expect(onTailscale.candidates.map((c) => c.kind)).toEqual(["tailscale", "lan"])
    expect(onTailscale.candidates[0]!.recommended).toBe(true)
    const onLan = candidateUrls(both, "http://192.168.1.10:4096")
    expect(onLan.candidates.map((c) => c.kind)).toEqual(["lan", "tailscale"])
    expect(onLan.candidates.filter((c) => c.recommended)).toHaveLength(1)
  })
  test("container and link-local addresses stay selectable but go last, without a recommendation", () => {
    const r = candidateUrls(["http://172.17.0.1:4096", "http://169.254.10.1:4096", "http://192.168.1.10:4096"], "http://192.168.1.10:4096")
    expect(r.candidates.map((c) => c.kind)).toEqual(["lan", "container", "linklocal"])
    expect(r.candidates[0]!.recommended).toBe(true)
    expect(r.candidates.slice(1).every((c) => !c.recommended)).toBe(true)
    // A window that itself uses the bridge address does not make it reachable from a phone: still last.
    const onlyBridge = candidateUrls(["http://172.17.0.1:4096", "http://192.168.1.10:4096"], "http://172.17.0.1:4096")
    expect(onlyBridge.candidates.map((c) => c.kind)).toEqual(["lan", "container"])
    expect(onlyBridge.candidates[0]!.recommended).toBe(true)
  })
  test("a window on a public address prefers that address", () => {
    const r = candidateUrls(["http://192.168.1.10:4096", "https://opencode.example.com"], "https://opencode.example.com")
    expect(r.candidates.map((c) => c.url)).toEqual(["https://opencode.example.com", "http://192.168.1.10:4096"])
  })
})

describe("typed address", () => {
  test("validates http(s) and rejects loopback", () => {
    expect(customUrlProblem("")).toContain("Enter an address")
    expect(customUrlProblem("192.168.1.2:4096")).toContain("http://")
    expect(customUrlProblem("ws://x")).toContain("http://")
    expect(customUrlProblem("http://localhost:4096")).toContain("this computer")
    expect(customUrlProblem("http://169.254.10.1:4096")).toContain("link-local")
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
  const address = "http://192.168.1.10:4096"
  const html = (now: number) => pairPanelHtml({ nonce: "N0NCE", cspSource: "vscode-webview://x", link, address, expiresAt: 300_000, now })
  test("strict CSP: no remote content, scripts and styles by nonce", () => {
    const csp = pairPanelCsp("N0NCE")
    expect(csp).toBe("default-src 'none'; style-src 'nonce-N0NCE'; script-src 'nonce-N0NCE'; img-src data:")
    const page = html(0)
    expect(page).toContain(`content="${csp}"`)
    // Only the link, the address and the SVG namespace (an identifier, not a request) may look like a URL.
    expect(page.replaceAll("http://www.w3.org/2000/svg", "").replaceAll(link, "").replaceAll(address, "")).not.toMatch(/https?:\/\//)
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
  test("shows the link, the three steps, the address and the troubleshooting hint; escapes the link", () => {
    const page = html(0)
    expect(page).toContain(`<code id="link">${link}</code>`)
    expect(page).toContain("Open <strong>OpenCode (unofficial)</strong> on your phone")
    expect(page).toContain("Add server")
    expect(page).toContain("Scan QR code")
    expect(page).toContain("Point the camera at this code")
    expect(page).toContain(`Your phone will connect to <code>${address}</code>`)
    expect(page).toContain("Phone can't connect?")
    expect(page).toContain("same Wi-Fi, or both signed in to the same Tailscale network")
    expect(page).toContain("opencode service set hostname 0.0.0.0")
    expect(page).toContain("<svg")
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;")
  })
  test("the address is escaped too", () => {
    const page = pairPanelHtml({ nonce: "N", cspSource: "x", link: "http://192.168.1.10:4096/auth/connect/abc", address: `http://192.168.1.10:4096/"<x>`, expiresAt: 300_000, now: 0 })
    expect(page).toContain("http://192.168.1.10:4096/&quot;&lt;x&gt;")
    expect(page).not.toContain(`/"<x>`)
  })
  test("the firewall hint names the port of the address", () => {
    const page = pairPanelHtml({ nonce: "N", cspSource: "x", link: "http://192.168.1.10:8080/auth/connect/abc", address: "http://192.168.1.10:8080", expiresAt: 300_000, now: 0 })
    expect(page).toContain("Allow TCP 8080 through this computer's firewall.")
  })
  test("qrSvg is deterministic for the same text and differs for another", () => {
    expect(qrSvg(link)).toBe(qrSvg(link))
    expect(qrSvg(link)).not.toBe(qrSvg(link + "x"))
  })
})

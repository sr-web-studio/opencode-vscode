/**
 * Pure logic of "OpenCode: Pair Mobile Device" (no `vscode` import, so `bun test` covers it).
 *
 * The server's `POST /api/pair` takes no body and returns `{ code, expires_in }`. The link the phone opens is
 * `<base URL the phone can reach>/auth/connect/<code>`, built here. The code is one-time and short-lived; the
 * session token is only handed out when the phone redeems it, so it never passes through the extension.
 */

export type AddressKind = "lan" | "tailscale" | "custom" | "container" | "linklocal" | "loopback"

export type Candidate = {
  url: string
  kind: AddressKind
  /** First item of the sorted list: the address the picker offers first. */
  recommended: boolean
}

export type Candidates = {
  candidates: Candidate[]
  /** Loopback / wildcard addresses that were left out because a phone cannot reach them. */
  droppedLoopback: boolean
}

/** Pairing codes live five minutes; the server also reports it (`expires_in`), which wins when sane. */
export const DEFAULT_EXPIRY_SECONDS = 300

export const KIND_LABEL: Record<AddressKind, string> = {
  lan: "Wi-Fi / local network — phone must be on the same network",
  tailscale: "Tailscale — works anywhere when the phone has Tailscale on",
  custom: "Public address — works anywhere with internet",
  container: "Probably a container network — usually not reachable from a phone",
  linklocal: "Link-local — not reachable from a phone",
  loopback: "This computer only",
}

/** The `detail` line under each address in the picker: what the choice means for the phone. */
export const KIND_DETAIL: Record<AddressKind, string> = {
  lan: "The phone and this computer must be on the same Wi-Fi or cable network.",
  tailscale: "The phone must be signed in to the same Tailscale network.",
  custom: "The phone needs internet access to this address.",
  container: "Docker and similar container networks use 172.17–31.x; these addresses exist only inside this computer.",
  linklocal: "169.254.x.x is assigned when no network handed out an address; a phone cannot use it.",
  loopback: "Only this computer can reach it.",
}

/** Most to least useful for a phone. Container and link-local addresses stay selectable but go last. */
const PREFERENCE: Record<Exclude<AddressKind, "loopback">, AddressKind[]> = {
  lan: ["lan", "tailscale", "custom", "container", "linklocal"],
  tailscale: ["tailscale", "lan", "custom", "container", "linklocal"],
  custom: ["custom", "lan", "tailscale", "container", "linklocal"],
  container: ["lan", "tailscale", "custom", "container", "linklocal"],
  linklocal: ["lan", "tailscale", "custom", "container", "linklocal"],
}

function parseUrl(raw: string): URL | undefined {
  try {
    const u = new URL(raw.trim())
    return u.protocol === "http:" || u.protocol === "https:" ? u : undefined
  } catch {
    return undefined
  }
}

function ipv4(host: string): number[] | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return undefined
  const parts = m.slice(1).map(Number)
  return parts.every((n) => n <= 255) ? parts : undefined
}

/** Classify a host name or IP (as in `URL.hostname`, IPv6 with brackets). */
export function classifyHost(hostname: string): AddressKind {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback"
  const v4 = ipv4(host)
  if (v4) {
    const [a, b] = v4 as [number, number, number, number]
    if (a === 127 || a === 0) return "loopback"
    if (a === 169 && b === 254) return "linklocal" // APIPA: no network gave the computer an address
    if (a === 100 && b >= 64 && b <= 127) return "tailscale" // 100.64.0.0/10 (CGNAT, used by Tailscale)
    // Docker's default bridge is 172.17.0.0/16 and compose networks continue into 172.18–31. A real
    // 172.17–31/16 LAN exists too, so these stay selectable; they are labelled and sorted last instead.
    if (a === 172 && b >= 17 && b <= 31) return "container"
    if (a === 10 || (a === 172 && b === 16) || (a === 192 && b === 168)) return "lan"
    return "custom"
  }
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1)
    if (v6 === "::1" || v6 === "::") return "loopback"
    if (/^fe[89ab][0-9a-f]:/.test(v6)) return "linklocal" // fe80::/10
    if (v6.startsWith("fd7a:115c:a1e0:")) return "tailscale"
    if (/^f[cd][0-9a-f]{2}:/.test(v6)) return "lan" // fc00::/7 unique local
    return "custom"
  }
  if (host.endsWith(".ts.net")) return "tailscale"
  if (host.endsWith(".local") || host.endsWith(".lan")) return "lan"
  return "custom"
}

/** `http://Host:4096/` -> `http://host:4096`; undefined when it is not an http(s) URL. Path and query are dropped. */
export function canonicalUrl(raw: string): string | undefined {
  const u = parseUrl(raw)
  if (!u) return undefined
  return u.origin
}

/**
 * Addresses to offer: those the server reports plus the one this window uses, de-duplicated, with addresses a phone
 * cannot reach (loopback, `0.0.0.0`) removed and the rest sorted by how likely a phone can use them.
 *
 * The window's own address decides the order: a window on Wi-Fi gets the LAN address first, a window on Tailscale
 * gets the Tailscale address first. Container and link-local addresses are kept (they cannot be told apart from a
 * real LAN by IP alone) but come last with a warning label.
 */
export function candidateUrls(serverUrls: readonly string[], windowUrl: string | undefined): Candidates {
  const seen = new Set<string>()
  const found: Candidate[] = []
  let droppedLoopback = false
  for (const raw of [...serverUrls, ...(windowUrl ? [windowUrl] : [])]) {
    const url = canonicalUrl(raw)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const kind = classifyHost(new URL(url).hostname)
    if (kind === "loopback") {
      droppedLoopback = true
      continue
    }
    found.push({ url, kind, recommended: false })
  }
  const windowCanonical = windowUrl ? canonicalUrl(windowUrl) : undefined
  const windowKind = windowCanonical ? classifyHost(new URL(windowCanonical).hostname) : undefined
  const order = PREFERENCE[windowKind === "loopback" || windowKind === undefined ? "lan" : windowKind]
  const rank = (c: Candidate) => order.indexOf(c.kind)
  const candidates = found
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => c)
  const first = candidates[0]
  if (first && first.kind !== "container" && first.kind !== "linklocal") first.recommended = true
  return { candidates, droppedLoopback }
}

/** Reason a typed address cannot be used for pairing, or undefined when it is fine. */
export function customUrlProblem(raw: string): string | undefined {
  const text = raw.trim()
  if (!text) return "Enter an address, for example http://192.168.1.10:4096"
  const u = parseUrl(text)
  if (!u) return "Use a full address starting with http:// or https://"
  const kind = classifyHost(u.hostname)
  if (kind === "loopback") return "This address only works on this computer. Use an address your phone can reach."
  if (kind === "linklocal") return "169.254.x.x is a link-local address a phone cannot reach. Use the computer's Wi-Fi or Tailscale address."
  return undefined
}

/** The one-time link for a base URL and a pairing code. Only the code is in it, never a token. */
export function pairLink(baseUrl: string, code: string): string {
  const base = canonicalUrl(baseUrl)
  if (!base) throw new Error(`Not an http(s) address: ${baseUrl}`)
  return `${base}/auth/connect/${encodeURIComponent(code)}`
}

/** Epoch ms at which a code created at `now` stops working. Falls back to five minutes for a nonsense `expires_in`. */
export function expiresAt(now: number, expiresIn: number | undefined): number {
  const seconds = typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0 ? Math.min(expiresIn, 3600) : DEFAULT_EXPIRY_SECONDS
  return now + seconds * 1000
}

/** Whole seconds left, rounded up so the display shows 0:00 only once the code is really expired. */
export function secondsLeft(expires: number, now: number): number {
  return Math.max(0, Math.ceil((expires - now) / 1000))
}

/** `5:00`, `0:07`. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** What goes in the log: the host only, never the code or the link. */
export function logHost(baseUrl: string): string {
  const u = parseUrl(baseUrl)
  return u ? u.host : "unknown host"
}

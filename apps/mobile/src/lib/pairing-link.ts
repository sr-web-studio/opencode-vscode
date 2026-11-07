/**
 * The pairing link of "OpenCode: Pair Mobile Device" and `opencode pair`: `<base-url>/auth/connect/<code>`, for example
 * `http://10.0.0.10:4096/auth/connect/AbC...` (the code is 22 URL-safe characters). Pure: no DOM, no Capacitor.
 */

export type PairingLink = { baseUrl: string; code: string }

export type PairingParse = { ok: true; link: PairingLink } | { ok: false; reason: string }

const SUFFIX = /^(.*)\/auth\/connect\/([^/?#]+)\/?$/

/** Understand what a QR code or a pasted text holds. Anything that is not exactly a pairing link is refused with a reason. */
export function parsePairingLink(raw: string): PairingParse {
  const text = raw.trim()
  if (!text) return { ok: false, reason: "Paste the pairing link first." }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, reason: "This is not a link. A pairing link looks like http://10.0.0.10:4096/auth/connect/…" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: `Use a http:// or https:// link, not ${url.protocol}//` }
  const m = SUFFIX.exec(url.pathname)
  if (!m) return { ok: false, reason: "This link is not a pairing link. It must end with /auth/connect/ and the code." }
  let code: string
  try {
    code = decodeURIComponent(m[2]!)
  } catch {
    return { ok: false, reason: "The code in this link is not valid." }
  }
  if (!code || code.length > 200) return { ok: false, reason: "The code in this link is not valid." }
  // A path in front of /auth/connect (a reverse proxy prefix) stays part of the base address.
  const prefix = m[1]!.replace(/\/+$/, "")
  return { ok: true, link: { baseUrl: `${url.origin}${prefix}`, code } }
}

/** Does this text look like a pairing link at all? Used to decide what a scanned QR code is. */
export const looksLikePairingLink = (raw: string): boolean => parsePairingLink(raw).ok

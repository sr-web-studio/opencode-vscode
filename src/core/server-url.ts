/**
 * Normalize the `opencode.serverUrl` setting. People type it in many shapes: `192.168.1.10:4096`,
 * `http://my-box:4096/`, `https://opencode.example.com`. A missing scheme means `http://`; the port is kept as typed
 * (none = 80 for http, 443 for https). Returns "" for an empty setting (use the local service).
 */
export function normalizeServerUrl(raw: string): string {
  let url = raw.trim()
  if (!url) return ""
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`
  return url.replace(/\/+$/, "")
}

/** A one-line reason the setting can't be a server URL, or undefined when it looks fine. */
export function serverUrlProblem(raw: string): string | undefined {
  const url = normalizeServerUrl(raw)
  if (!url) return undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return `“${raw.trim()}” is not a valid address. Examples: http://192.168.1.10:4096, https://opencode.example.com`
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return `Use http:// or https://, not ${parsed.protocol}//`
  return undefined
}

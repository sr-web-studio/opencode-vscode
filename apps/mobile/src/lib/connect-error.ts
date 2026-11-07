/**
 * What went wrong when a server could not be reached, in words for the user. Pure: it only reads the error that
 * `client.server.info()` or `fetch` threw.
 *
 * - `unauthorized`: the server answered 401 (wrong or missing password, expired pairing token).
 * - `cors`: a browser `TypeError` ("Failed to fetch") after the address looked reachable: either the server is not
 *   there, or it refuses this app's origin. A WebView cannot tell the two apart, so the text says both.
 * - `unreachable`: the connection was refused or timed out.
 */
export type ConnectProblem = { kind: "unauthorized" | "unreachable" | "cors" | "other"; message: string }

const text = (e: unknown): string => {
  if (e instanceof Error) return `${e.name} ${e.message} ${String((e as { cause?: unknown }).cause ?? "")}`
  if (typeof e === "string") return e
  const o = (e ?? {}) as { _tag?: unknown; message?: unknown }
  return `${typeof o._tag === "string" ? o._tag : ""} ${typeof o.message === "string" ? o.message : ""}`
}

/** `origin` is the WebView's own origin (`location.origin`), named in the CORS hint. */
export function classifyConnectError(e: unknown, url: string, origin = ""): ConnectProblem {
  const raw = text(e)
  const tag = (e as { _tag?: unknown } | undefined)?._tag
  if (tag === "UnauthorizedError" || /authentication required|unauthori[sz]ed|\b401\b/i.test(raw)) {
    return { kind: "unauthorized", message: "The server did not accept the password. Check it, or pair this phone again." }
  }
  if (/ECONNREFUSED|refused|ETIMEDOUT|timed? ?out|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|getaddrinfo|network is unreachable/i.test(raw)) {
    return { kind: "unreachable", message: `Could not reach ${url}. Is the server running, and is this phone on the same network (or Tailscale)?` }
  }
  if (e instanceof TypeError || /failed to fetch|load failed|networkerror|cors/i.test(raw)) {
    return {
      kind: "cors",
      message: `Could not connect to ${url}. Either the server is not reachable from this phone, or it does not allow this app (${origin || "its origin"}) in its CORS list.`,
    }
  }
  const detail = (e instanceof Error ? e.message : typeof e === "string" ? e : String((e as { message?: unknown } | undefined)?.message ?? "")).trim().replace(/\s+/g, " ")
  return { kind: "other", message: detail ? `Could not connect: ${detail}` : "Could not connect." }
}

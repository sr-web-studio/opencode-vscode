/**
 * What went wrong when a server could not be reached, in words for the user. Pure: it only reads the error that
 * `client.server.info()` or `fetch` threw.
 *
 * - `unauthorized`: the server answered 401 (wrong or missing password, expired pairing token).
 * - `cors`: a browser `TypeError` ("Failed to fetch"). The WebView cannot tell "server not there" from "server refuses
 *   this app's origin" by the error alone, so `classifyConnectError` returns `cors` for it and `diagnoseConnectError`
 *   settles it with a second request (see `startProbe`): an opaque `no-cors` answer means the host is there (so it is the
 *   CORS list), no answer in 5 s means it is not reachable.
 * - `unreachable`: the connection was refused or timed out, or the probe got no answer.
 */
export type ConnectProblem = { kind: "unauthorized" | "unreachable" | "cors" | "other"; message: string }

/** How long the second request may take before the host counts as unreachable. */
export const PROBE_TIMEOUT_MS = 5000

/** `192.168.1.10:4096` from `http://192.168.1.10:4096/`: what the messages call the server. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export const unreachableMessage = (url: string): string => `Can't reach ${hostLabel(url)}. Check the address, Wi-Fi or Tailscale.`

const corsMessage = (url: string, origin: string): string =>
  `${hostLabel(url)} answers, but it does not allow this app (${origin || "its origin"}) in its CORS list. Add that origin to the server's allowed origins.`

export type Probe = { result: Promise<boolean>; cancel(): void }

/** The slice of `fetch` the probe needs (so a test can pass a plain function, whatever the global `fetch` type is). */
type ProbeFetch = (url: string, init: { mode: "no-cors"; cache: "no-store"; signal: AbortSignal }) => Promise<unknown>

/**
 * Ask the server's address with `mode: "no-cors"`: the browser then hands back an opaque response whenever the host
 * answered at all (whatever the status or CORS headers), and rejects only when nothing answered. `result` is true when
 * the host answered, false on a network error or after `timeoutMs`. It never rejects.
 */
export function startProbe(url: string, timeoutMs = PROBE_TIMEOUT_MS, fetchFn: ProbeFetch = (u, init) => fetch(u, init)): Probe {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const result = fetchFn(url, { mode: "no-cors", cache: "no-store", signal: ctl.signal }).then(
    () => true,
    () => false,
  )
  void result.then(() => clearTimeout(timer))
  return { result, cancel: () => ctl.abort() }
}

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
    return { kind: "unreachable", message: unreachableMessage(url) }
  }
  if (e instanceof TypeError || /failed to fetch|load failed|networkerror|cors/i.test(raw)) {
    // Provisional: only `diagnoseConnectError` knows whether the host answered.
    return { kind: "cors", message: corsMessage(url, origin) }
  }
  const detail = (e instanceof Error ? e.message : typeof e === "string" ? e : String((e as { message?: unknown } | undefined)?.message ?? "")).trim().replace(/\s+/g, " ")
  return { kind: "other", message: detail ? `Could not connect: ${detail}` : "Could not connect." }
}

/**
 * `classifyConnectError`, and for the "Failed to fetch" case a second request that tells the two causes apart: the host
 * answered (so it is the CORS list) or it did not (so it is unreachable). Every place that shows a connection error,
 * the form's test, a pairing and the stored error of a server row, goes through this one function.
 * `probe` is injectable for tests.
 */
export async function diagnoseConnectError(e: unknown, url: string, origin = "", probe: (url: string) => Probe = (u) => startProbe(u)): Promise<ConnectProblem> {
  const first = classifyConnectError(e, url, origin)
  if (first.kind !== "cors") return first
  const answered = await probe(url).result
  return answered ? first : { kind: "unreachable", message: unreachableMessage(url) }
}

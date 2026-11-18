/** The server said the session does not exist (`SessionNotFoundError`, HTTP 404): for a delete, that means "already gone". */
export function isGone(e: unknown): boolean {
  const o = (e ?? {}) as { _tag?: unknown; name?: unknown; status?: unknown; message?: unknown }
  if (o._tag === "SessionNotFoundError" || o.name === "SessionNotFoundError" || o.status === 404) return true
  return /SessionNotFound|\b404\b/.test(typeof o.message === "string" ? o.message : typeof e === "string" ? e : "")
}

/**
 * The server said the message does not exist (`MessageNotFoundError`, 2.3.0: a tagged error with no HTTP status on
 * the object), or a 404 that names a message. A bare 404 is not enough (a wrong URL or a proxy answers it too), and
 * neither is a timeout, a 5xx or an auth error: they say nothing about the message.
 */
export function isMessageGone(e: unknown): boolean {
  const o = (e ?? {}) as { _tag?: unknown; name?: unknown; status?: unknown; message?: unknown; body?: unknown }
  if (o._tag === "MessageNotFoundError" || o.name === "MessageNotFoundError") return true
  if (o.status !== 404) return false
  const text = `${typeof o.message === "string" ? o.message : ""} ${typeof o.body === "string" ? o.body : o.body ? JSON.stringify(o.body) : ""}`
  return /message/i.test(text) && /not.?found/i.test(text)
}

/**
 * A line for the user from whatever a client call threw. The client's tagged errors (`InvalidRequestError`, …) are plain
 * objects with a `message`, not `Error` instances.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === "string") return e
  const m = (e as { message?: unknown } | undefined)?.message
  return typeof m === "string" && m ? m : "Request failed"
}

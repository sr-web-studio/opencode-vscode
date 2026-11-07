/** The server said the session does not exist (`SessionNotFoundError`, HTTP 404): for a delete, that means "already gone". */
export function isGone(e: unknown): boolean {
  const o = (e ?? {}) as { _tag?: unknown; name?: unknown; status?: unknown; message?: unknown }
  if (o._tag === "SessionNotFoundError" || o.name === "SessionNotFoundError" || o.status === 404) return true
  return /SessionNotFound|\b404\b/.test(typeof o.message === "string" ? o.message : typeof e === "string" ? e : "")
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

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

/**
 * The command arguments the sessions pane's host requests and the palette pass: a session and the folder that owns
 * it, or a folder alone. Pure, so the shape is unit-tested without VS Code.
 */

/** What a session row's command needs: the session and the folder that owns it. */
export type SessionTarget = { sessionID: string; directory?: string }

/**
 * A row target (`{ sessionID, directory }`), a tree-like node (`{ kind: "session", id, directory }`), or nothing.
 */
export function sessionTarget(arg: unknown): SessionTarget | undefined {
  if (!arg || typeof arg !== "object") return undefined
  const value = arg as { sessionID?: unknown; id?: unknown; kind?: unknown; directory?: unknown }
  const sessionID = typeof value.sessionID === "string" ? value.sessionID : value.kind === "session" && typeof value.id === "string" ? value.id : undefined
  if (!sessionID) return undefined
  return { sessionID, directory: typeof value.directory === "string" ? value.directory : undefined }
}

/** The folder a project argument (or an explicit path) names, for commands that act on one folder. */
export function directoryArg(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg || undefined
  if (!arg || typeof arg !== "object") return undefined
  const value = arg as { directory?: unknown }
  return typeof value.directory === "string" && value.directory ? value.directory : undefined
}

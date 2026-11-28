import type { SessionInfo } from "./api"
import type { AppState } from "./protocol"
import { isRoot } from "./sessions"

/** A root session id that cannot be archived from here (a worker, or unknown to this folder). */
export const NOT_ARCHIVABLE = "Only a session from the session list can be archived. Workers are archived together with their parent session."

/**
 * Root sessions of this folder, archived or not, without duplicates. Unlike deletion, archiving is reversible and
 * never touches the server's other state, so running sessions stay eligible: they keep running, only hidden.
 */
export function archivableSessions(state: Pick<AppState, "sessions" | "archived">): SessionInfo[] {
  const seen = new Set<string>()
  return [...state.sessions, ...state.archived].filter((s) => {
    if (!isRoot(s) || seen.has(s.id)) return false
    seen.add(s.id)
    return true
  })
}

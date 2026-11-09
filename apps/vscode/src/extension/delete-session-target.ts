import type { SessionInfo } from "@occ/core/api"
import type { AppState } from "@occ/core/protocol"
import { isRoot } from "@occ/core/sessions"

/** The state `Delete Session…` needs: the folder's sessions and the live busy/attention sets. */
export type DeleteState = Pick<AppState, "sessions" | "archived" | "running" | "waiting">

/**
 * Which session "Delete Session…" acts on. No id (the Command Palette) asks the user to pick; a sidebar row names one,
 * and only a stopped root session of this folder can be deleted, so anything else is refused with a reason instead of
 * showing the picker again.
 */
export type DeleteChoice = { kind: "pick" } | { kind: "target"; session: SessionInfo } | { kind: "running" } | { kind: "waiting" } | { kind: "worker" } | { kind: "gone" }

/** Resolve the row's id to a delete decision without touching VS Code or the server. */
export function chooseDeleteTarget(state: DeleteState, sessionID?: string): DeleteChoice {
  if (!sessionID) return { kind: "pick" }
  const known = [...state.sessions, ...state.archived].find((session) => session.id === sessionID)
  if (!known) return { kind: "gone" }
  if (!isRoot(known)) return { kind: "worker" }
  // Waiting outranks running, as in the shared order: the turn is blocked on the user.
  if (state.waiting.includes(sessionID)) return { kind: "waiting" }
  if (state.running.includes(sessionID)) return { kind: "running" }
  return { kind: "target", session: known }
}

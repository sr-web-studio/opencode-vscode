import type { SessionInfo } from "./api"
import type { AppState } from "./protocol"
import { isRoot, UNTITLED } from "./sessions"

/**
 * The only way this extension deletes a session: the user asks for it and confirms in a host modal. Nothing else
 * (no event, no cleanup, no timer) ever calls `session.remove`.
 */
export const DELETE_DETAIL = "This deletes the session and its workers on the OpenCode server for every client (TUI, other windows). It cannot be undone."

export const DELETE_BUTTON = "Delete"

export const deleteQuestion = (title: string | undefined): string => `Delete “${title?.trim() || UNTITLED}”?`

/** The host's modal dialog (`vscode.window.showWarningMessage`), injected so the flow can be tested without VS Code. */
export type AskModal = (message: string, options: { modal: true; detail: string }, ...buttons: string[]) => PromiseLike<string | undefined>

/** Ask once. Only the Delete button counts: Cancel, Escape and closing the dialog all answer "no". */
export async function confirmDelete(ask: AskModal, title: string | undefined): Promise<boolean> {
  const pick = await ask(deleteQuestion(title), { modal: true, detail: DELETE_DETAIL }, DELETE_BUTTON)
  return pick === DELETE_BUTTON
}

/** Root sessions of this folder (archived ones included when they are loaded) that are not running and not waiting for the user. */
export function deletableSessions(state: Pick<AppState, "sessions" | "archived" | "running" | "waiting">): SessionInfo[] {
  const busy = new Set([...state.running, ...state.waiting])
  const seen = new Set<string>()
  return [...state.sessions, ...state.archived].filter((s) => {
    if (!isRoot(s) || busy.has(s.id) || seen.has(s.id)) return false
    seen.add(s.id)
    return true
  })
}

export const STOP_FIRST = "Stop the session first, then delete it."
export const WORKER_RUNNING = "A worker of this session is still running. Stop it first, then delete the session."
export const WAITING_FOR_USER = "This session is waiting for your answer (permission or question). Answer or reject it first, then delete it."
export const NOT_DELETABLE = "Only a session from the session list can be deleted. Workers are deleted together with their parent session."

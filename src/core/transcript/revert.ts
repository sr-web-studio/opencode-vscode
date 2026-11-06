/**
 * Revert to a prompt (OpenCode snapshots). The server keeps every message while a rollback is staged; the client hides
 * the boundary prompt and everything after it, and shows a bar. The data stays in the view so Redo can bring it back.
 */
import type { RevertState, SessionView, TurnView } from "./types"

/** What the server sends: `Session.Info.revert` and the `session.revert.staged` payload. */
export type ServerRevert = { messageID?: string; files?: ReadonlyArray<unknown> | number } | null | undefined

/** Normalise a server revert. `files` is how many files were restored (0 when the server captured no snapshot). */
export function revertFromServer(raw: ServerRevert): RevertState | undefined {
  if (!raw || typeof raw.messageID !== "string") return undefined
  const files = Array.isArray(raw.files) ? raw.files.length : typeof raw.files === "number" ? raw.files : 0
  return { messageID: raw.messageID, files }
}

export const withRevert = (view: SessionView, revert: RevertState | undefined): SessionView => ({ ...view, revert })

/** Index of the turn that starts at the boundary prompt, or -1 when it is not (yet) in the view. */
export const boundaryIndex = (view: SessionView, messageID: string): number => view.turns.findIndex((t) => t.user?.id === messageID)

/** True when a staged rollback points at a prompt this view does not know (the controller then reloads history). */
export const boundaryMissing = (view: SessionView): boolean => !!view.revert && boundaryIndex(view, view.revert.messageID) === -1

/** The turns to render: everything before the boundary prompt while a rollback is staged. */
export function visibleTurns(view: SessionView): TurnView[] {
  if (!view.revert) return view.turns
  const at = boundaryIndex(view, view.revert.messageID)
  return at === -1 ? view.turns : view.turns.slice(0, at)
}

/** The text of the boundary prompt, to put back in the prompt box. */
export function revertedPrompt(view: SessionView): string | undefined {
  if (!view.revert) return undefined
  return view.turns[boundaryIndex(view, view.revert.messageID)]?.user?.text
}

export const hiddenTurnCount = (view: SessionView): number => view.turns.length - visibleTurns(view).length

/**
 * The bar text. It only says files were restored when the server reported some. A server without a snapshot for the
 * location (not a git repo, snapshots off, older version) restores nothing, and the bar must say so.
 */
export function revertBarText(revert: RevertState): string {
  if (revert.files <= 0) return "Conversation reverted · files not restored"
  return `Reverted · ${revert.files} ${revert.files === 1 ? "file" : "files"} restored`
}

/** Applies `session.revert.staged|cleared|committed`. Returns the same view for any other event. */
export function applyRevertEvent(view: SessionView, type: string, data: any): SessionView {
  switch (type) {
    case "session.revert.staged": {
      const revert = revertFromServer(data?.revert)
      return revert ? { ...view, revert } : view
    }
    case "session.revert.cleared":
      return view.revert ? { ...view, revert: undefined } : view
    case "session.revert.committed": {
      // The server dropped the hidden messages for good. `to` is the boundary; fall back to the staged one.
      const boundary = typeof data?.to === "string" ? data.to : view.revert?.messageID
      const at = boundary ? boundaryIndex(view, boundary) : -1
      const turns = at === -1 ? (view.revert ? visibleTurns(view) : view.turns) : view.turns.slice(0, at)
      return { ...view, turns, revert: undefined }
    }
    default:
      return view
  }
}

/** Feature detection: older servers (2.1.x) have no `session.revert`. */
export const canRevert = (client: { session?: { revert?: { stage?: unknown } } }): boolean => typeof client.session?.revert?.stage === "function"

/**
 * Draft session logic. `+` opens a local draft: nothing is created on the server until the first
 * prompt is sent. The sequence is session.create → session.prompt, and only then does the draft
 * turn into a real session.
 */
export type ViewTarget = { kind: "draft" } | { kind: "session"; id: string }

export type DraftPlan =
  | { action: "focus" } // already in an empty draft
  | { action: "open-draft" }

/** What `+` does: never creates a session. */
export function planNewSession(target: ViewTarget | undefined, draftHasText: boolean): DraftPlan {
  if (target?.kind === "draft" && !draftHasText) return { action: "focus" }
  return { action: "open-draft" }
}

/** On startup: open the newest root session if there is one, otherwise show a draft. */
export function initialTarget(rootIDs: ReadonlyArray<string>, remembered?: string): ViewTarget {
  if (remembered && rootIDs.includes(remembered)) return { kind: "session", id: remembered }
  const first = rootIDs[0]
  return first ? { kind: "session", id: first } : { kind: "draft" }
}

/** The empty/welcome view shows for a draft, or when the project has no sessions at all. */
export const showEmptyState = (target: ViewTarget | undefined, sessionCount: number) =>
  target?.kind === "draft" || sessionCount === 0

export const SUGGESTIONS = ["Explain this codebase", "Find and fix a bug", "Write tests for the current file"] as const
export const EMPTY_NOTE = "Sessions keep running on the OpenCode server after you close VS Code"

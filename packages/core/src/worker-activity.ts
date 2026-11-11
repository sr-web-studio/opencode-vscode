/**
 * A root session whose own turn is idle while its workers (child sessions, `parentID` set) still run.
 *
 * The server reports the child as running and the parent as idle: `session.active()` lists only the child, and the
 * parent's own `time` keeps its finished turn (`idle`, `outcome: "succeeded"`). Both lists (the editor's sessions pane
 * and the phone's drawer) therefore have to say "a worker is running" themselves, or the parent looks finished.
 *
 * The rule is deliberately separate from the activity order: a parent with running workers keeps its own place (it is
 * idle), and only the row's words and icon change. Moving it into the running group would make a finished-looking
 * parent jump above newer sessions for something the user did not ask it to do.
 *
 * Pure: no client, no DOM, no clock. The callers pass the children they listed and the running ids they already have.
 */

/** What the rule needs about a child session: its id and the parent it belongs to. */
export type WorkerChild = { id: string; parentID?: string }

/**
 * How many children of each parent are running now. Only children of `parents` count, so a server-wide running map can
 * be passed as is. A child without a parent (a root session) never counts.
 */
export function runningWorkers(parents: Iterable<string>, children: Iterable<WorkerChild>, running: ReadonlySet<string>): Map<string, number> {
  const known = new Set(parents)
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  for (const child of children) {
    if (!child.parentID || !known.has(child.parentID) || !running.has(child.id) || seen.has(child.id)) continue
    seen.add(child.id)
    counts.set(child.parentID, (counts.get(child.parentID) ?? 0) + 1)
  }
  return counts
}

/** The words behind the worker icon: `Worker running`, `2 workers running`; empty when there is none. */
export function workerLabel(count: number): string {
  if (count <= 0) return ""
  return count === 1 ? "Worker running" : `${count} workers running`
}

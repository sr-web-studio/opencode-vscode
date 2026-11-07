import type { Worker } from "./workers"

/**
 * Hiding a worker only removes its row from this extension's list. The worker session on the OpenCode server is never
 * deleted, archived or changed. Hidden worker keys (`Worker.key`) are kept per parent session in the workspace state.
 */

/** Newest keys kept per parent session. */
export const HIDDEN_PER_PARENT = 500
/** Parent sessions remembered; the least recently changed ones fall off first. */
export const HIDDEN_PARENTS = 100

export type HiddenWorkers = Record<string, string[]>

/** Whatever storage hands back (stale, hand-edited, an older shape) becomes a clean map of unique string keys. */
export function normalizeHidden(raw: unknown): HiddenWorkers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: HiddenWorkers = {}
  for (const [parent, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const keys = [...new Set(list.filter((k): k is string => typeof k === "string" && k.length > 0))].slice(-HIDDEN_PER_PARENT)
    if (keys.length) out[parent] = keys
  }
  const parents = Object.keys(out)
  for (const p of parents.slice(0, Math.max(0, parents.length - HIDDEN_PARENTS))) delete out[p]
  return out
}

/** Add keys to one parent's list (unique, newest last, capped). That parent moves to the end of the map. */
export function addHidden(hidden: HiddenWorkers, parentID: string, keys: readonly string[]): HiddenWorkers {
  const { [parentID]: current = [], ...rest } = hidden
  const merged = [...new Set([...current, ...keys])].slice(-HIDDEN_PER_PARENT)
  return normalizeHidden({ ...rest, [parentID]: merged })
}

/** Remove keys from one parent's list (a worker that runs again shows again). Same object when nothing changes. */
export function removeHidden(hidden: HiddenWorkers, parentID: string, keys: readonly string[]): HiddenWorkers {
  const current = hidden[parentID]
  if (!current || !keys.some((k) => current.includes(k))) return hidden
  const left = current.filter((k) => !keys.includes(k))
  const { [parentID]: _gone, ...rest } = hidden
  return left.length ? { ...rest, [parentID]: left } : rest
}

/** A session was deleted on the server: forget it as a parent and as a hidden worker. */
export function forgetSession(hidden: HiddenWorkers, sessionID: string): HiddenWorkers {
  const out: HiddenWorkers = {}
  for (const [parent, keys] of Object.entries(hidden)) {
    if (parent === sessionID) continue
    const left = keys.filter((k) => k !== sessionID)
    if (left.length) out[parent] = left
  }
  return out
}

/**
 * The server listed every child of `parentID` (`complete`: the page was not full): drop hidden session ids that are
 * not among them any more. `tool:<id>` keys stay, they name a call whose child was not known.
 */
export function pruneHidden(hidden: HiddenWorkers, parentID: string, children: readonly string[], complete: boolean): HiddenWorkers {
  const current = hidden[parentID]
  if (!complete || !current) return hidden
  const live = new Set(children)
  const gone = current.filter((k) => k.startsWith("ses_") && !live.has(k))
  return gone.length ? removeHidden(hidden, parentID, gone) : hidden
}

/** The workers to list. A running worker is never hidden, whatever the stored keys say. */
export function visibleWorkers(workers: readonly Worker[], hidden: readonly string[] | ReadonlySet<string>): Worker[] {
  const set = hidden instanceof Set ? hidden : new Set(hidden)
  return workers.filter((w) => w.status === "running" || !set.has(w.key))
}

/** The workers "Clear done" would hide: every one that is not running. */
export const clearable = (workers: readonly Worker[]): Worker[] => workers.filter((w) => w.status !== "running")

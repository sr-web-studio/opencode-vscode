/**
 * One order for sessions and projects, shared by the VS Code sidebar and the app drawer.
 *
 * The rule, in the user's words: the ones that need them or are running stay on top, then the latest ones. So:
 *
 *   1. `waiting` — a permission request or a question is open; the turn is blocked on the user.
 *   2. `running` — busy or retrying.
 *   3. `idle`    — everything else.
 *
 * Inside each of the first two groups the newest activity comes first too, so the whole list is "most urgent, then
 * most recent". A project is placed by the highest state among its sessions and by the newest activity among them and
 * its own record, which is why projects and sessions read the same way.
 *
 * Ties fall back to the title (case-insensitive, locale-aware) and then the id, so two redraws never swap neighbours.
 *
 * Pure: no client, no DOM, no clock. Both UIs feed it what they already have (the running/waiting id sets, the session
 * list, the project list) and get back a key to sort with.
 */
import type { SessionInfo } from "./api"

export type ActivityState = "waiting" | "running" | "idle"

export type Activity = {
  state: ActivityState
  /** Newest activity in ms since the epoch; `0` when nothing is known yet. */
  last: number
}

/** The live state sets the controller publishes: ids of running turns and of turns waiting on the user. */
export type ActivitySets = { running: ReadonlySet<string>; waiting: ReadonlySet<string> }

/** What the order needs: the activity plus the tie-breakers both lists have. */
export type ActivityKey = Activity & { title?: string; id: string }

/** Most urgent first. Lower ranks are listed earlier. */
const RANK: Record<ActivityState, number> = { waiting: 0, running: 1, idle: 2 }

/**
 * A session's state. Waiting outranks running: the turn is blocked on the user, so it needs them more than a turn
 * that is still working. This is the same precedence as the session switcher's dot.
 */
export function sessionState(id: string, { running, waiting }: ActivitySets): ActivityState {
  return waiting.has(id) ? "waiting" : running.has(id) ? "running" : "idle"
}

/**
 * A session's last activity: `time.updated`, the server's last-change stamp that the controller and the worker panels
 * already order by, plus the newest of the state stamps (`busy`, `idle`) in case a record carries only those, and
 * `created` so an untouched session still has a position.
 *
 * `viewed` is deliberately ignored: merely opening a session must not move it, or the list would jump under the
 * user's cursor while they pick something.
 */
const sessionLast = (time: SessionInfo["time"]): number => Math.max(time.updated, time.busy ?? 0, time.idle ?? 0, time.created)

/** A session's place in the order: its state from the live sets and its last activity from its own timestamps. */
export function sessionActivity(session: Pick<SessionInfo, "id" | "time">, sets: ActivitySets): Activity {
  return { state: sessionState(session.id, sets), last: sessionLast(session.time) }
}

/**
 * A project's place in the order: the highest state of its sessions and the newest activity of those sessions and of
 * the project record itself.
 *
 * `own` is the project's own timestamp — `Math.max(time.updated, time.active)` from `project.list` — and is optional
 * because a project's sessions are known even when the project list is not (or failed to load). With nothing known at
 * all the project is idle at `0`, so it sorts after anything with real activity.
 */
export function combineActivity(items: Iterable<Activity>, own?: number): Activity {
  let state: ActivityState = "idle"
  let last = own ?? 0
  for (const item of items) {
    if (RANK[item.state] < RANK[state]) state = item.state
    if (item.last > last) last = item.last
  }
  return { state, last }
}

/**
 * The shared order: state first (waiting, running, idle), then newest activity, then title case-insensitively, then id.
 * Negative when `a` is listed before `b`, zero only for the same id.
 */
export function compareActivity(a: ActivityKey, b: ActivityKey): number {
  const byState = RANK[a.state] - RANK[b.state]
  if (byState) return byState
  if (a.last !== b.last) return b.last - a.last
  const byTitle = (a.title ?? "").toLowerCase().localeCompare((b.title ?? "").toLowerCase())
  if (byTitle) return byTitle
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * A new array in the shared order; `items` is left untouched and its order is kept for entries that tie completely.
 * `key` is read once per item.
 */
export function sortByActivity<T>(items: readonly T[], key: (item: T) => ActivityKey): T[] {
  return items
    .map((item) => ({ item, key: key(item) }))
    .sort((a, b) => compareActivity(a.key, b.key))
    .map((entry) => entry.item)
}

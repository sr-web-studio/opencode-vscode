/**
 * One status per root session, shared by the in-chat sessions pane and the app's drawer.
 *
 * The shared activity order (`activity-order.ts`) decides *where* a row goes and stays untouched: a session is
 * `waiting`, `running` or `idle` there. This module decides *what the row says*: the icon and the weight, and the
 * single status a project group shows for its sessions.
 *
 * The rule, from most to least urgent:
 *
 *   1. `waiting` — a permission request or a question is open; the turn is blocked on the user.
 *   2. `running` — busy or retrying.
 *   3. `failed`  — the last turn ended `failed` and the user has not looked at the session since.
 *   4. `unread`  — the last turn finished (`succeeded` or `interrupted`) after the user last looked at it.
 *   5. `read`    — everything else: seen, or nothing finished yet.
 *
 * "Looked at" compares the server's `time.viewed` (the client's `session.view` call) with `time.idle` (the end of the
 * last turn). A missing `viewed` means no client has opened the session since view stamps existed: its turn counts as
 * seen once it ended more than `UNREAD_WINDOW_MS` ago, so the first run after an upgrade does not light up the whole
 * history. A `viewed` before `idle` means the turn that ended afterwards has not been seen, at any age.
 * `activity-order` deliberately ignores `viewed`, so marking a session read never moves a row.
 *
 * A record without an `outcome` is an older server (or a session that never finished a turn): it reads as `read`
 * rather than inventing a state. `failed` and `unread` are only "new" states; once seen they fall back to `read`.
 *
 * Pure: no client, no DOM, no clock. The caller passes `now`.
 */
import type { SessionInfo } from "./api"
import type { ActivitySets } from "./activity-order"

export type SessionStatus = "waiting" | "running" | "failed" | "unread" | "read"

/** How old a turn may be and still count as new when no client has a `viewed` stamp for its session. */
export const UNREAD_WINDOW_MS = 24 * 60 * 60 * 1000

/** What a status reads from a session record. `time` keeps the server's own field names. */
export type StatusSession = {
  id: string
  time: Pick<SessionInfo["time"], "idle" | "viewed">
  outcome?: SessionInfo["outcome"]
}

/** Lower is more urgent. A project group takes the lowest rank among its sessions. */
export const STATUS_RANK: Record<SessionStatus, number> = { waiting: 0, running: 1, failed: 2, unread: 3, read: 4 }

/**
 * The user has seen the last finished turn: `viewed` is at or after `idle`. A session with no finished turn has
 * nothing to read, so it counts as seen. With no `viewed` stamp at all, a turn older than `UNREAD_WINDOW_MS` counts as
 * seen too: view stamps arrived with this feature, and every older session would otherwise start as "New reply".
 */
export function isSeen(time: Pick<SessionInfo["time"], "idle" | "viewed">, now: number): boolean {
  if (time.idle === undefined) return true
  if (time.viewed === undefined) return now - time.idle > UNREAD_WINDOW_MS
  return time.viewed >= time.idle
}

/** The last turn finished successfully (or was interrupted) and no client has opened the session since. */
export function isUnread(session: StatusSession, now: number): boolean {
  if (session.time.idle === undefined || isSeen(session.time, now)) return false
  return session.outcome === "succeeded" || session.outcome === "interrupted"
}

/** The one status of a root session. Waiting and running come from the live sets the controller publishes. */
export function sessionStatus(session: StatusSession, sets: ActivitySets, now: number): SessionStatus {
  if (sets.waiting.has(session.id)) return "waiting"
  if (sets.running.has(session.id)) return "running"
  if (session.outcome === "failed" && session.time.idle !== undefined && !isSeen(session.time, now)) return "failed"
  if (isUnread(session, now)) return "unread"
  return "read"
}

/** A group's status: the highest of its sessions, `read` when it has none. */
export function combineStatus(statuses: Iterable<SessionStatus>): SessionStatus {
  let status: SessionStatus = "read"
  for (const item of statuses) if (STATUS_RANK[item] < STATUS_RANK[status]) status = item
  return status
}

/** How many sessions a group should flag as new: the `unread` ones (a `failed` row has its own icon). */
export function unreadCount(statuses: Iterable<SessionStatus>): number {
  let count = 0
  for (const status of statuses) if (status === "unread") count++
  return count
}

/** The words behind every icon. Screen readers hear these; the icons themselves are decorative in a labelled row. */
export function statusLabel(status: SessionStatus): string {
  switch (status) {
    case "waiting":
      return "Needs your answer"
    case "running":
      return "Running"
    case "failed":
      return "Failed"
    case "unread":
      return "New reply"
    case "read":
      return "Read"
  }
}

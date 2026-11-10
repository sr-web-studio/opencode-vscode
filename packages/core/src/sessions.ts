import { sessionState } from "./activity-order"
import type { SessionInfo } from "./api"

export type SessionDot = "running" | "waiting" | "none"

export type SessionRow = {
  id: string
  title: string
  updated: number
  dot: SessionDot
  current: boolean
  archived: boolean
}

export type SessionGroupName = "Today" | "Yesterday" | "Last week" | "Older"
export type SessionGroup = { name: SessionGroupName; rows: SessionRow[] }

export const UNTITLED = "Untitled session"
export const DRAFT_TITLE = "New session"

const startOfDay = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function groupName(updated: number, now: number): SessionGroupName {
  const today = startOfDay(now)
  const day = 86_400_000
  if (updated >= today) return "Today"
  if (updated >= today - day) return "Yesterday"
  if (updated >= today - 7 * day) return "Last week"
  return "Older"
}

/** Only root sessions (no parent) belong in the switcher. */
export const isRoot = (s: Pick<SessionInfo, "parentID">) => !s.parentID

export type RowInput = {
  sessions: ReadonlyArray<SessionInfo>
  running: ReadonlySet<string>
  waiting: ReadonlySet<string>
  currentID?: string
}

export function toRows({ sessions, running, waiting, currentID }: RowInput): SessionRow[] {
  const sets = { running, waiting }
  return sessions.filter(isRoot).map((s) => {
    // Waiting for the user outranks running: the turn is blocked on them.
    const state = sessionState(s.id, sets)
    return {
      id: s.id,
      title: s.title?.trim() || UNTITLED,
      updated: s.time.updated,
      dot: state === "idle" ? "none" : state,
      current: s.id === currentID,
      archived: s.time.archived !== undefined,
    }
  })
}

/** Case-insensitive filter by title, newest first, grouped by date. Empty groups are omitted. */
export function groupSessions(rows: ReadonlyArray<SessionRow>, query: string, now: number): SessionGroup[] {
  const q = query.trim().toLowerCase()
  const filtered = rows.filter((r) => !q || r.title.toLowerCase().includes(q)).sort((a, b) => b.updated - a.updated)
  const order: SessionGroupName[] = ["Today", "Yesterday", "Last week", "Older"]
  const buckets = new Map<SessionGroupName, SessionRow[]>(order.map((n) => [n, []]))
  for (const r of filtered) buckets.get(groupName(r.updated, now))!.push(r)
  return order.flatMap((name) => (buckets.get(name)!.length ? [{ name, rows: buckets.get(name)! }] : []))
}

/** Flat id list in display order, for keyboard navigation. */
export const flattenGroups = (groups: ReadonlyArray<SessionGroup>): string[] => groups.flatMap((g) => g.rows.map((r) => r.id))

/** Keep the list consistent with live events without a refetch. */
export function upsertSession(list: ReadonlyArray<SessionInfo>, next: SessionInfo): SessionInfo[] {
  const i = list.findIndex((s) => s.id === next.id)
  return i === -1 ? [next, ...list] : list.map((s, j) => (j === i ? next : s))
}

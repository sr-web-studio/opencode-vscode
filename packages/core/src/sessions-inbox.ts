/**
 * The inbox at the bottom of a multi-project sessions list: the sessions that need the user, then the most recently
 * active ones, drawn from every project at once.
 *
 * The list above it keeps its own shape; the inbox is a shortcut, so a session it shows is still in its project group
 * too. It exists only where there is something to shortcut: two or more projects, no search, at least one session.
 *
 * The contents, in this order:
 *
 *   1. `waiting` — a permission request or a question is open.
 *   2. `running` — a turn is busy or retrying.
 *   3. `unread`  — the last turn finished and the user has not looked at it since.
 *   4. everything else, newest activity first.
 *
 * Groups 1–3 are never cut: a morning with six blocked sessions shows six rows. Only group 4 fills the rest up to
 * `INBOX_ROWS`, so a quiet inbox stays short.
 *
 * Placement is frozen while the pane or drawer is open, exactly like the project list: rows already in the inbox keep
 * their place when a live event makes one urgent, new rows are slotted in by the current order and gone ones disappear.
 * The next open sorts afresh.
 *
 * Pure: no DOM, no clock, no client, and generic over the host's own row shape (the editor's `PaneRow`, the drawer's
 * `OverviewSessionRow`), so both draw the same rule with their own rows.
 */
import type { SessionStatus } from "./session-status"
import { stableOrder } from "./stable-order"

/** How many rows the inbox holds when the urgent groups leave room for the recent ones. */
export const INBOX_ROWS = 5

/** The parts of a row the inbox reads: its identity, its title, its status and when it last changed. */
export type InboxItem = { id: string; title: string; status: SessionStatus; last: number }

/** A project's visible session rows, as the pane or drawer already built them. */
export type InboxGroup<T extends InboxItem = InboxItem> = { name: string; rows: readonly T[] }

/** A session row plus the project it belongs to, because the inbox mixes projects. */
export type InboxRow<T extends InboxItem = InboxItem> = T & { project: string }

/** Every group's rows in one list, each carrying its project's name. */
export function inboxCandidates<T extends InboxItem>(groups: readonly InboxGroup<T>[]): InboxRow<T>[] {
  return groups.flatMap((group) => group.rows.map((row) => ({ ...row, project: group.name })))
}

/** Lower is listed earlier: what needs the user, what runs, what finished unseen, then everything else. */
export function inboxRank(row: Pick<InboxItem, "status">): number {
  const status: SessionStatus = row.status
  if (status === "waiting") return 0
  if (status === "running") return 1
  if (status === "unread") return 2
  return 3
}

/** The inbox's own order: the four groups above, newest activity first inside each, then title and id. */
function compareInbox<T extends InboxItem>(a: InboxRow<T>, b: InboxRow<T>): number {
  const byRank = inboxRank(a) - inboxRank(b)
  if (byRank) return byRank
  if (a.last !== b.last) return b.last - a.last
  const byTitle = a.title.toLowerCase().localeCompare(b.title.toLowerCase())
  if (byTitle) return byTitle
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * The rows the inbox shows. Groups 1–3 all stay; group 4 is cut so the whole list holds `total` rows. A row that is
 * no longer in `rows` (archived, deleted, filtered by the host) is not invented here.
 */
export function buildInbox<T extends InboxItem>(rows: readonly InboxRow<T>[], total = INBOX_ROWS): InboxRow<T>[] {
  const sorted = [...rows].sort(compareInbox)
  const urgent = sorted.filter((row) => inboxRank(row) < 3)
  const rest = sorted.filter((row) => inboxRank(row) === 3)
  const room = Math.max(0, total - urgent.length)
  return [...urgent, ...rest.slice(0, room)]
}

/** Whether the list shows an inbox at all: two or more projects, no active search, and something to show. */
export function showInbox(projectCount: number, query: string, rows: readonly InboxItem[]): boolean {
  return projectCount >= 2 && query.trim() === "" && rows.length > 0
}

/* -------------------------------------------------------------- stable order */

/** The ids the inbox froze when the pane or drawer opened. */
export type FrozenInbox = ReadonlyArray<string>

/** Take the ids of the built inbox, so live updates can be replayed in that order. */
export function freezeInbox(rows: readonly InboxItem[]): string[] {
  return rows.map((row) => row.id)
}

/**
 * The inbox in the frozen order. Titles, states and times stay live; only the sequence is held. A row that appeared
 * after the freeze is placed by the current order, and one that left is dropped.
 */
export function applyInboxOrder<T extends InboxItem>(rows: readonly InboxRow<T>[], frozen: FrozenInbox): InboxRow<T>[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  return stableOrder(
    frozen,
    rows.map((row) => row.id),
  ).flatMap((id) => byId.get(id) ?? [])
}

/* -------------------------------------------------------------- height */

/**
 * The sizes the inbox is measured from. The editor's rows are 28 px; the phone's rows are finger-sized, so it passes
 * its own numbers instead of inheriting the editor's.
 */
export type InboxSizing = {
  /** One row's height, in px. */
  row: number
  /** The section header's height, in px. */
  header: number
  /** The fewest rows the section shows before its content scrolls. */
  minRows: number
  /** The rows the default height fits. */
  rows: number
  /** The project list above keeps at least this much height. */
  projectMin: number
  /** The drag handle's own height, which the section shares the room with. */
  sash: number
}

export const INBOX_SIZING: InboxSizing = { row: 28, header: 30, minRows: 2, rows: 5, projectMin: 120, sash: 6 }

/** One arrow-key step on the inbox's handle, and the larger step while Shift is held. */
export const INBOX_STEP = 16
export const INBOX_STEP_LARGE = 64

/** Enough for the header and five rows: what a double-click on the handle goes back to. */
export function inboxDefaultHeight(sizing: InboxSizing = INBOX_SIZING): number {
  return sizing.header + sizing.rows * sizing.row
}

/** The header plus two rows: the section never gets shorter than that, it scrolls instead. */
export function inboxMinHeight(sizing: InboxSizing = INBOX_SIZING): number {
  return sizing.header + sizing.minRows * sizing.row
}

/** The heights the inbox may take in a list area `view` px tall (project list, handle and inbox together). */
export type InboxHeightRange = { min: number; max: number }

/**
 * At least the minimum, and at most what leaves the project list `projectMin` and the handle their room. In a view too
 * short for both, `max` falls back to `min` so a saved height still comes back usable.
 */
export function inboxHeightRange(view: number, sizing: InboxSizing = INBOX_SIZING): InboxHeightRange {
  const min = inboxMinHeight(sizing)
  const usable = Number.isFinite(view) ? Math.round(view) : 600
  const max = Math.max(min, usable - sizing.sash - sizing.projectMin)
  return { min, max }
}

/** Clamp a wanted height into the range for this view; a height saved on a bigger screen comes back usable here. */
export function clampInboxHeight(height: number, view: number, sizing: InboxSizing = INBOX_SIZING): number {
  const { min, max } = inboxHeightRange(view, sizing)
  const wanted = Number.isFinite(height) ? Math.round(height) : inboxDefaultHeight(sizing)
  return Math.min(max, Math.max(min, wanted))
}

/** One step from the current height: `direction` is 1 for taller (Up) and -1 for shorter (Down). */
export function stepInboxHeight(height: number, direction: number, view: number, large = false, sizing: InboxSizing = INBOX_SIZING): number {
  const step = large ? INBOX_STEP_LARGE : INBOX_STEP
  return clampInboxHeight(height + Math.sign(direction) * step, view, sizing)
}

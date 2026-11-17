/**
 * The session tab strip at the top of the chat: which sessions are open as tabs, in which order, and which of them fit.
 *
 * A tab is a session the user has opened, like the tabs of OpenCode Desktop: opening a session from anywhere (the
 * sessions pane, the drawer, a notification, a link, the strip's own dropdown) adds it, and closing a tab only removes
 * it from the strip. The session itself is never deleted or archived here. The list is pruned only of sessions a
 * complete list proves gone (deleted on the server), never the other way round.
 *
 * Pure: no DOM, no client, no clock. The VS Code chat and the Android app feed it their own session lists.
 */
import { sameDirectory } from "./paths"
import type { AppState } from "./protocol"
import type { PaneLayout } from "./sessions-pane"
import type { SessionStatus } from "./session-status"
import { stableOrder } from "./stable-order"

/** One open tab as it is persisted: the session, the folder that owns it, and what is needed to draw it before the lists load. */
export type SessionTab = {
  id: string
  directory: string
  /** The last title seen, so a restored tab has a name before the session lists arrive. */
  title?: string
  /** The last activity seen (ms since the epoch), so a restored strip keeps its order before the lists arrive. */
  last?: number
}

/** A session as the strip and its dropdown draw it: one row of the pane (VS Code) or of the drawer (phone). */
export type TabSession = {
  id: string
  /** The folder the session opens in (what `openSessionInFolder` / `model.openSession` take). */
  directory: string
  title: string
  /** The project's display name, for the avatar letter and the dropdown. */
  project: string
  status: SessionStatus
  /** Last activity in ms since the epoch: the pane's own activity time. */
  last: number
}

/**
 * A session list that can prove a tab gone. `complete` says the list holds every session of its scope (loaded, and
 * not cut off by a page limit); only then does a missing id mean the session no longer exists. `directory` limits the
 * list to one folder; without it the list covers the whole server (the phone's overview).
 */
export type TabProof = { directory?: string; ids: ReadonlySet<string>; complete: boolean }

/**
 * Everything the strip knows about the sessions of its host: every listed session in the host's own list order (the
 * pane's in VS Code, the drawer's on the phone), the lists that can prove a tab gone, and whether they are still
 * loading.
 */
export type TabCatalog = { sessions: TabSession[]; proofs: TabProof[]; loading: boolean }

/** The most tabs kept. Opening one more drops the tab that was opened longest ago, never the one on screen. */
export const MAX_TABS = 50

/** The page size of the controller's root session list: a list this long may have been cut off, so it proves nothing. */
export const LIST_PAGE = 200

/**
 * The sessions pane's rows as the strip's catalog, in the pane's order. A single-folder window's flat list has no
 * project name of its own, so `project` names it.
 */
export function paneCatalog(layout: PaneLayout, project: string): TabSession[] {
  if (layout.kind === "sessions") return layout.sessions.map((row) => ({ id: row.id, directory: row.directory, title: row.title, project, status: row.status, last: row.updated }))
  if (layout.kind === "projects") {
    return layout.projects.flatMap((group) => group.sessions.map((row) => ({ id: row.id, directory: row.directory, title: row.title, project: group.name, status: row.status, last: row.updated })))
  }
  return []
}

/**
 * The proof the chat's own folder gives: its full root list, archived sessions included (the controller's list carries
 * them, so an archived session never counts as deleted). Only the active folder's list is used in VS Code: the light
 * lists of the other folders leave archived sessions out and would close their tabs.
 */
export function folderProof(state: Pick<AppState, "directory" | "sessions" | "archived" | "sessionsLoaded">): TabProof {
  const ids = new Set<string>()
  for (const session of state.sessions) ids.add(session.id)
  for (const session of state.archived) ids.add(session.id)
  return { directory: state.directory, ids, complete: state.sessionsLoaded && state.sessions.length < LIST_PAGE }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

/** The tab list from storage. Anything malformed is dropped rather than trusted; duplicates keep their first entry. */
export function parseTabs(raw: unknown): SessionTab[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const tabs: SessionTab[] = []
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id || typeof entry.directory !== "string") continue
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    const tab: SessionTab = { id: entry.id, directory: entry.directory }
    if (typeof entry.title === "string" && entry.title) tab.title = entry.title
    if (typeof entry.last === "number" && Number.isFinite(entry.last)) tab.last = entry.last
    tabs.push(tab)
  }
  return tabs.slice(-MAX_TABS)
}

/**
 * Open a session as a tab. A tab that is already open keeps its place and only takes the newer details; a new one is
 * added at the end (the list keeps the order tabs were opened in; the strip sorts by activity on its own).
 */
export function openTab(tabs: readonly SessionTab[], tab: SessionTab): SessionTab[] {
  const at = tabs.findIndex((existing) => existing.id === tab.id)
  if (at >= 0) {
    const existing = tabs[at]!
    const merged: SessionTab = { ...existing, ...definedOnly(tab) }
    if (sameTab(existing, merged)) return tabs as SessionTab[]
    return tabs.map((entry, index) => (index === at ? merged : entry))
  }
  const next = [...tabs, { ...definedOnly(tab) } as SessionTab]
  return next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next
}

/** Close a tab. Only the tab goes; the session stays on the server untouched. */
export function closeTab(tabs: readonly SessionTab[], id: string): SessionTab[] {
  return tabs.some((tab) => tab.id === id) ? tabs.filter((tab) => tab.id !== id) : (tabs as SessionTab[])
}

/**
 * The tab to show after closing `id`, in the order the strip shows them: the next one, else the previous one, else
 * nothing (the chat then starts a new session). The same rule as OpenCode Desktop.
 */
export function nextAfterClose(order: readonly string[], id: string): string | undefined {
  const at = order.indexOf(id)
  if (at < 0) return undefined
  return order[at + 1] ?? order[at - 1]
}

/**
 * Drop the tabs whose session a complete list proves gone. A list that is still loading, that was cut off by a page
 * limit, or that belongs to another folder proves nothing, so those tabs stay. `keep` names tabs that must stay
 * whatever the lists say: the session on screen, and a session opened moments ago that the lists may not carry yet.
 */
export function pruneTabs(tabs: readonly SessionTab[], proofs: readonly TabProof[], keep: ReadonlySet<string> = new Set()): SessionTab[] {
  const gone = (tab: SessionTab): boolean =>
    !keep.has(tab.id) && proofs.some((proof) => proof.complete && (proof.directory === undefined || sameDirectory(proof.directory, tab.directory)) && !proof.ids.has(tab.id))
  const kept = tabs.filter((tab) => !gone(tab))
  return kept.length === tabs.length ? (tabs as SessionTab[]) : kept
}

/**
 * Take the newest titles and activity times into the persisted tabs, so a restored strip reads right before the lists
 * arrive. Returns the same array when nothing changed, so the caller can skip a write.
 */
export function rememberTabs(tabs: readonly SessionTab[], known: (id: string) => Pick<TabSession, "title" | "last"> | undefined): SessionTab[] {
  let changed = false
  const next = tabs.map((tab) => {
    const info = known(tab.id)
    if (!info || (info.title === tab.title && info.last === tab.last)) return tab
    changed = true
    return { ...tab, title: info.title, last: info.last }
  })
  return changed ? next : (tabs as SessionTab[])
}

/**
 * The strip's order: the most recently active session first, by the pane's activity time. A tab whose session no list
 * knows yet falls back to the time it last had; ties go by title and then id, so two redraws never swap neighbours.
 */
export function orderTabs(tabs: readonly SessionTab[], known: (id: string) => Pick<TabSession, "title" | "last"> | undefined): string[] {
  return tabs
    .map((tab) => {
      const info = known(tab.id)
      return { id: tab.id, last: info?.last ?? tab.last ?? 0, title: (info?.title ?? tab.title ?? "").toLowerCase() }
    })
    .sort((a, b) => b.last - a.last || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((entry) => entry.id)
}

/**
 * The order to draw. While the pointer is over the strip (or a finger presses it, or its dropdown is open) the order
 * is held: tabs keep their places, a newly opened one is placed by the live order and a closed one leaves. Otherwise
 * the live order wins.
 */
export function heldOrder(frozen: readonly string[] | undefined, live: readonly string[]): string[] {
  return frozen ? stableOrder(frozen, live) : [...live]
}

/** How the strip splits its tabs: the indexes that are drawn, and the rest that the overflow dropdown lists. */
export type TabFit = { visible: number[]; hidden: number[] }

/** How the strip measures: the space between two tabs, the overflow button, and the narrowest a tab may shrink to. */
export type FitOptions = {
  gap: number
  /** Width of the overflow button, which only appears once a tab is hidden. */
  overflow: number
  /**
   * A tab may shrink to this width (its title ellipsized) before one more tab is hidden: one width for every tab, or
   * one per tab in strip order (the active tab carries its close button, so it needs more). Default: no shrinking.
   */
  min?: number | readonly number[]
  /** The index of the active tab, which is never hidden. */
  active?: number
}

/**
 * Which tabs fit in `available` px. `widths` are the tabs' natural widths (already capped at the tab's maximum) in
 * strip order. Tabs shrink down to `min` before any is hidden, so a narrow strip still shows several. The active tab
 * is always drawn: when it would be hidden, tabs at the end make room for it and it takes the last place. At least
 * one tab is drawn while there are tabs, even when nothing fits (it then shrinks further).
 */
export function fitTabs(widths: readonly number[], available: number, options: FitOptions): TabFit {
  const count = widths.length
  const all = widths.map((_, index) => index)
  if (count === 0) return { visible: [], hidden: [] }
  const floor = (index: number): number | undefined => (typeof options.min === "number" ? options.min : options.min?.[index])
  const size = (index: number): number => {
    const min = floor(index)
    return min === undefined ? widths[index]! : Math.min(widths[index]!, min)
  }
  const span = (indexes: readonly number[]): number => indexes.reduce((sum, index, i) => sum + size(index) + (i > 0 ? options.gap : 0), 0)
  if (span(all) <= available) return { visible: all, hidden: [] }
  const budget = available - options.overflow - options.gap
  let fits = 0
  while (fits < count && span(all.slice(0, fits + 1)) <= budget) fits++
  const active = options.active !== undefined && options.active >= 0 && options.active < count ? options.active : undefined
  let visible: number[]
  if (active === undefined || active < fits) {
    visible = all.slice(0, Math.max(fits, 1))
  } else {
    while (fits > 0 && span([...all.slice(0, fits), active]) > budget) fits--
    visible = [...all.slice(0, fits), active]
  }
  const shown = new Set(visible)
  return { visible, hidden: all.filter((index) => !shown.has(index)) }
}

/** The avatar letter of a project: the first letter or digit of its name, upper-cased. */
export function avatarLetter(name: string): string {
  for (const char of name) if (/[\p{L}\p{N}]/u.test(char)) return char.toLocaleUpperCase()
  return "?"
}

/** The number of avatar colours; `avatarColor` returns an index below it. */
export const AVATAR_COLORS = 8

/**
 * A stable colour for a project: the same folder always gets the same one, in every window and on the phone. The
 * folder path is hashed (FNV-1a) after the separators and a trailing slash are normalised.
 */
export function avatarColor(directory: string): number {
  const key = directory.replace(/\\/g, "/").replace(/(?<=.)\/+$/, "")
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % AVATAR_COLORS
}

/** The dropdown's filter: sessions whose title or project contains the text, case-insensitively, in the given order. */
export function filterTabSessions<T extends Pick<TabSession, "title" | "project">>(sessions: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...sessions]
  return sessions.filter((session) => session.title.toLowerCase().includes(q) || session.project.toLowerCase().includes(q))
}

function definedOnly(tab: SessionTab): SessionTab {
  const out: SessionTab = { id: tab.id, directory: tab.directory }
  if (tab.title !== undefined) out.title = tab.title
  if (tab.last !== undefined) out.last = tab.last
  return out
}

const sameTab = (a: SessionTab, b: SessionTab): boolean => a.id === b.id && a.directory === b.directory && a.title === b.title && a.last === b.last

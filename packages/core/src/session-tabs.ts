/**
 * The session tab strip at the top of the chat: which sessions are open as tabs, in which order, and which of them fit.
 *
 * A tab is a session the user has opened, like the tabs of OpenCode Desktop: opening a session from anywhere (the
 * sessions pane, the drawer, a notification, a link, the strip's own dropdown) adds it, and closing a tab only removes
 * it from the strip. The session itself is never deleted or archived here.
 *
 * A tab leaves on its own only when the server confirms its session is gone: `session.get` answers "not found". A
 * session list never proves that: the lists are capped and filtered (the controller fetches one page of a project's
 * sessions and keeps the folder's), and a session moved to another folder leaves one list without being deleted. A
 * tab missing from every list is only a reason to ask the server (`TabVerifier`).
 *
 * No DOM, no client, no clock of its own: the VS Code chat and the Android app feed it their lists and their lookup.
 */
import type { FolderSessions } from "./protocol"
import { PaneMemo, type PaneLayout, type PaneState } from "./sessions-pane"
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
 * Everything the strip knows about the sessions of its host: every listed session in the host's own list order (the
 * pane's in VS Code, the drawer's on the phone), the ids any of the host's lists carries (archived ones included),
 * and whether the lists are still loading. `listed` is a hint only: a tab outside it is checked with the server,
 * never closed for that alone.
 */
export type TabCatalog = { sessions: TabSession[]; listed: ReadonlySet<string>; loading: boolean }

/**
 * The most tabs kept. Opening one more drops the least recently active tab (by the activity time the tab last saw,
 * then the one opened longest ago), never the one on screen nor the one being opened. The overflow dropdown lists
 * every session anyway, so a dropped tab is one click away.
 */
export const MAX_TABS = 50

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
 * The VS Code chat's catalog: the sessions pane's rows in the pane's order, and every id the window's lists carry
 * (the chat folder's sessions and archive, and every other folder's light list). The same object comes back while
 * none of its inputs changed: a streamed answer patches the chat state many times a second without touching a list,
 * so the strip neither rebuilds its tabs nor measures them again.
 */
export class ChatTabCatalog {
  private memo = new PaneMemo()
  private cache: { key: unknown[]; catalog: TabCatalog } | undefined

  build(state: PaneState, folderSessions: readonly FolderSessions[], now: number): TabCatalog {
    const { folders, layout } = this.memo.build(state, folderSessions, now)
    const loading = !folders.every((folder) => folder.loaded)
    const key = [layout, state.projectName, state.folderName, state.sessions, state.archived, folderSessions, loading]
    if (this.cache && this.cache.key.every((value, i) => value === key[i])) return this.cache.catalog
    const listed = new Set<string>()
    for (const session of state.sessions) listed.add(session.id)
    for (const session of state.archived) listed.add(session.id)
    for (const folder of folderSessions) for (const session of folder.sessions) listed.add(session.id)
    const catalog: TabCatalog = { sessions: paneCatalog(layout, state.projectName?.trim() || state.folderName), listed, loading }
    this.cache = { key, catalog }
    return catalog
  }
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
 * added at the end (the list keeps the order tabs were opened in; the strip sorts by activity on its own). Past
 * `MAX_TABS`, the least recently active tab goes; `current` (the session on screen) and the new tab never do.
 */
export function openTab(tabs: readonly SessionTab[], tab: SessionTab, current?: string): SessionTab[] {
  const at = tabs.findIndex((existing) => existing.id === tab.id)
  if (at >= 0) {
    const existing = tabs[at]!
    const merged: SessionTab = { ...existing, ...definedOnly(tab) }
    if (sameTab(existing, merged)) return tabs as SessionTab[]
    return tabs.map((entry, index) => (index === at ? merged : entry))
  }
  const next = [...tabs, { ...definedOnly(tab) } as SessionTab]
  while (next.length > MAX_TABS) {
    const drop = leastActive(next, new Set([tab.id, ...(current ? [current] : [])]))
    if (drop < 0) break
    next.splice(drop, 1)
  }
  return next
}

/** The index of the tab with the oldest activity among those not in `spare`; the earlier opened wins a tie. */
function leastActive(tabs: readonly SessionTab[], spare: ReadonlySet<string>): number {
  let best = -1
  for (let i = 0; i < tabs.length; i++) {
    if (spare.has(tabs[i]!.id)) continue
    if (best < 0 || (tabs[i]!.last ?? 0) < (tabs[best]!.last ?? 0)) best = i
  }
  return best
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

/** What the server said about a tab's session: deleted, still there (and where it lives now), or no clear answer. */
export type TabLookup = { state: "gone" } | { state: "exists"; directory?: string } | { state: "unknown" }

/**
 * The server's own "this session does not exist" error. Stricter than `isGone`: a bare HTTP 404 may come from a proxy
 * in front of the server, and closing every tab on a misrouted request would be wrong.
 */
export function sessionNotFound(e: unknown): boolean {
  const o = (e ?? {}) as { _tag?: unknown; name?: unknown }
  return o._tag === "SessionNotFoundError" || o.name === "SessionNotFoundError"
}

/**
 * Ask the server about one session (`session.get`). Only its "session not found" answer means gone; a bad request, a
 * network error or a server that is restarting is no answer at all, and the tab stays.
 */
export async function lookupTab(get: () => Promise<{ location?: { directory?: string } }>): Promise<TabLookup> {
  try {
    const info = await get()
    const directory = info?.location?.directory
    return directory ? { state: "exists", directory } : { state: "exists" }
  } catch (e) {
    return sessionNotFound(e) ? { state: "gone" } : { state: "unknown" }
  }
}

/** A tab no list carries is asked about again after this long (a never-listed old session, an unknown answer). */
export const RECHECK_MS = 10 * 60_000
/** At most this many lookups run at once, so restoring fifty unlisted tabs never floods the server. */
export const CHECK_BATCH = 4

/** What a `TabVerifier` learned about one tab: confirmed deleted, or alive (in `directory`, when the server said). */
export type TabVerdict = { id: string; gone: true } | { id: string; gone: false; directory?: string }

/**
 * Closes the tabs whose session the server confirms deleted, and nothing else. A tab that no list carries (deleted,
 * moved to a folder the lists do not cover, older than the lists reach) is only a suspect: it is looked up, at most
 * `CHECK_BATCH` at a time, and closed on a "not found" answer. A tab that leaves the lists is looked up at once; one
 * that stays unlisted is asked again only every `RECHECK_MS`. The session on screen is never looked up.
 */
export class TabVerifier {
  private checked = new Map<string, number>()
  private pending = new Set<string>()
  private tabs: readonly SessionTab[] = []
  private listed: ReadonlySet<string> = new Set()
  private keep: ReadonlySet<string> = new Set()
  private stopped = false

  constructor(
    private readonly lookup: (tab: SessionTab) => Promise<TabLookup>,
    private readonly verdict: (result: TabVerdict) => void,
    private readonly clock: () => number = Date.now,
  ) {}

  /** The strip's tabs and lists changed (or the clock ticked): start the lookups that are due. Returns their ids. */
  update(tabs: readonly SessionTab[], listed: ReadonlySet<string>, keep: ReadonlySet<string>): string[] {
    this.tabs = tabs
    this.listed = listed
    this.keep = keep
    const open = new Set(tabs.map((tab) => tab.id))
    // A listed session exists; forget its last lookup, so leaving the lists later is checked at once.
    for (const id of [...this.checked.keys()]) if (listed.has(id) || !open.has(id)) this.checked.delete(id)
    return this.pump()
  }

  /** No more lookups and no more verdicts (the strip is gone). */
  stop(): void {
    this.stopped = true
  }

  private pump(): string[] {
    if (this.stopped) return []
    const now = this.clock()
    const due = this.tabs.filter((tab) => {
      if (this.listed.has(tab.id) || this.keep.has(tab.id) || this.pending.has(tab.id)) return false
      const at = this.checked.get(tab.id)
      return at === undefined || now - at >= RECHECK_MS
    })
    const started = due.slice(0, Math.max(0, CHECK_BATCH - this.pending.size))
    for (const tab of started) {
      this.pending.add(tab.id)
      this.checked.set(tab.id, now)
      void this.lookup(tab)
        .catch((): TabLookup => ({ state: "unknown" }))
        .then((result) => {
          this.pending.delete(tab.id)
          if (this.stopped) return
          if (result.state === "gone") this.verdict({ id: tab.id, gone: true })
          else if (result.state === "exists") this.verdict({ id: tab.id, gone: false, directory: result.directory })
          // The batch has room again: start the next suspects, if any.
          this.pump()
        })
    }
    return started.map((tab) => tab.id)
  }
}

/** What the strip knows about a session to keep with its tab: the title, the activity time and the folder it lives in. */
export type TabInfo = Pick<TabSession, "title" | "last"> & { directory?: string }

/**
 * Take the newest titles, activity times and folders into the persisted tabs, so a restored strip reads right before
 * the lists arrive and a session moved to another folder opens there. Returns the same array when nothing changed,
 * so the caller can skip a write.
 */
export function rememberTabs(tabs: readonly SessionTab[], known: (id: string) => TabInfo | undefined): SessionTab[] {
  let changed = false
  const next = tabs.map((tab) => {
    const info = known(tab.id)
    if (!info) return tab
    const directory = info.directory || tab.directory
    if (info.title === tab.title && info.last === tab.last && directory === tab.directory) return tab
    changed = true
    return { ...tab, title: info.title, last: info.last, directory }
  })
  return changed ? next : (tabs as SessionTab[])
}

/** Move a tab to the folder its session lives in now (the server's answer for a session no list carries). */
export function moveTab(tabs: readonly SessionTab[], id: string, directory: string): SessionTab[] {
  return tabs.some((tab) => tab.id === id && tab.directory !== directory) ? tabs.map((tab) => (tab.id === id ? { ...tab, directory } : tab)) : (tabs as SessionTab[])
}

/** The chat's own records of its sessions, archived ones included: what the strip shows for a tab no host list carries. */
export function ownSessions(
  sessions: readonly { id: string; title?: string; time: { created: number; updated: number } }[],
  archived: readonly { id: string; title?: string; time: { created: number; updated: number } }[],
): Map<string, Pick<TabSession, "title" | "last">> {
  const out = new Map<string, Pick<TabSession, "title" | "last">>()
  for (const s of [...sessions, ...archived]) if (!out.has(s.id)) out.set(s.id, { title: s.title?.trim() || "", last: Math.max(s.time.updated, s.time.created) })
  return out
}

/**
 * The strip's session for every open tab: the host's row, else the chat's own record, else what the tab remembered.
 * Depends only on the tab list, the host's catalog and the chat's records, so a streamed answer (which replaces the
 * chat state but none of these) rebuilds nothing.
 */
export function tabSessions(
  tabs: readonly SessionTab[],
  byId: ReadonlyMap<string, TabSession>,
  own: ReadonlyMap<string, Pick<TabSession, "title" | "last">>,
  fallback: { untitled: string; project: (directory: string) => string },
): Map<string, TabSession> {
  return new Map(
    tabs.map((tab): [string, TabSession] => {
      const row = byId.get(tab.id)
      if (row) return [tab.id, row]
      const mine = own.get(tab.id)
      return [
        tab.id,
        {
          id: tab.id,
          directory: tab.directory,
          title: mine?.title || tab.title || fallback.untitled,
          project: fallback.project(tab.directory),
          status: "read",
          last: mine?.last ?? tab.last ?? 0,
        },
      ]
    }),
  )
}

/** A status that keeps its own icon beside the close button (running, needs the user, failed). The rest share its slot. */
export const attentionStatus = (status: SessionStatus): boolean => status === "running" || status === "waiting" || status === "failed"

/** One drawn tab, as the strip lists them: the draft's "New session" tab, or a session's. */
export type TabEntry = { kind: "draft" } | { kind: "session"; session: TabSession }

/** Two measurements are the same: lets the strip skip a state write (and a re-fit) when nothing moved. */
export const sameNumbers = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((value, i) => value === b[i])

/**
 * Hands back the same map of the chat's own session records while its lists are the same arrays. A streamed answer
 * replaces the chat state many times a second but keeps `sessions` and `archived` as they were, so nothing that reads
 * the map runs again.
 */
export class OwnSessionsMemo {
  private key: [unknown, unknown] | undefined
  private map = new Map<string, Pick<TabSession, "title" | "last">>()

  get(sessions: Parameters<typeof ownSessions>[0], archived: Parameters<typeof ownSessions>[1]): Map<string, Pick<TabSession, "title" | "last">> {
    if (this.key && this.key[0] === sessions && this.key[1] === archived) return this.map
    this.key = [sessions, archived]
    this.map = ownSessions(sessions, archived)
    return this.map
  }
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

/**
 * How the strip splits its tabs: the indexes that are drawn, the rest that the overflow dropdown lists, and the one
 * width (px) every drawn tab has.
 */
export type TabFit = { visible: number[]; hidden: number[]; width: number }

/** How the strip measures, all in px: the space between two tabs, the overflow button, and the narrowest and widest tab. */
export type FitOptions = {
  gap: number
  /** Width of the overflow button, which only appears once a tab is hidden. */
  overflow: number
  /** No tab is drawn narrower than this (its title stays readable) unless even one tab does not fit. */
  min: number
  /** No tab is drawn wider than this: a wide strip leaves room after the last tab instead. */
  max: number
  /** The index of the active tab, which is never hidden. */
  active?: number
}

/**
 * Which of `count` tabs fit in `available` px, and how wide each is. Every drawn tab has the same width, the active
 * one included: the room shared out evenly, never below `min` and never above `max`. When the tabs do not fit at
 * `min`, the rest go behind the overflow button instead of being squeezed. The active tab is always drawn: when it
 * would be hidden, the tabs at the end make room for it and it takes the last place. At least one tab is drawn while
 * there are tabs; when even one does not fit at `min` it takes all the room there is.
 */
export function fitTabs(count: number, available: number, options: FitOptions): TabFit {
  const all = Array.from({ length: count }, (_, index) => index)
  if (count === 0) return { visible: [], hidden: [], width: options.min }
  const share = (room: number, n: number): number => Math.max(0, (room - options.gap * (n - 1)) / n)
  const size = (room: number, n: number): number => Math.min(options.max, share(room, n))
  if (count === 1 || share(available, count) >= options.min) return { visible: all, hidden: [], width: size(available, count) }
  const budget = available - options.overflow - options.gap
  let fits = 1
  while (fits < count && share(budget, fits + 1) >= options.min) fits++
  const active = options.active !== undefined && options.active >= 0 && options.active < count ? options.active : undefined
  const visible = active === undefined || active < fits ? all.slice(0, fits) : [...all.slice(0, fits - 1), active]
  const shown = new Set(visible)
  return { visible, hidden: all.filter((index) => !shown.has(index)), width: size(budget, visible.length) }
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

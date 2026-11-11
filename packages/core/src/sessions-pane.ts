/**
 * The data model of the sessions pane inside the chat: the workspace folders and their root sessions, turned into
 * the rows the pane draws.
 *
 * Pure (no DOM, no client, no clock), so the layout, the shared order and the stable order are unit-tested directly.
 * The pane is the VS Code counterpart of the app's drawer: one flat list in a single-folder window, one collapsible
 * group per folder in a multi-root window, and the same activity order in both.
 */
import { combineActivity, sessionActivity, sortByActivity, type ActivityState } from "./activity-order"
import { relativeTime } from "./format"
import { sameDirectory } from "./paths"
import type { AppState, FolderSessions } from "./protocol"
import { combineStatus, sessionStatus, unreadCount, type SessionStatus } from "./session-status"
import { UNTITLED } from "./sessions"
import { stableOrder } from "./stable-order"

/** A root session as the pane lists it. Light: no transcript, cost or tokens. */
export type PaneSession = {
  id: string
  title?: string
  parentID?: string
  /** The last turn's result, when the record carries one (the active folder's sessions do). */
  outcome?: "succeeded" | "failed" | "interrupted"
  time: { created: number; updated: number; busy?: number; idle?: number; viewed?: number; archived?: number }
}

/** One workspace folder's live data, as the registry and its controller already hold it. */
export type PaneFolder = {
  directory: string
  /** The workspace folder's name, used when OpenCode has no project name. */
  name: string
  /** OpenCode's name for the folder's project, when it has one. */
  projectName?: string
  /** The folder the chat view shows. */
  active: boolean
  /** Root sessions of the folder. Workers and archived sessions are filtered out here. */
  sessions: readonly PaneSession[]
  running: ReadonlySet<string>
  waiting: ReadonlySet<string>
  /** Root session id → running workers (child sessions). The row's own state stays idle while they run. */
  workers: ReadonlyMap<string, number>
  /** The session the chat shows; only meaningful for the active folder. */
  currentID?: string
  /** The controller has loaded its session list at least once. */
  loaded: boolean
  /** Include this folder's archived sessions too (the active folder, while "Show archived" is on). */
  includeArchived?: boolean
}

/** A session row: title, live state, last activity and the short relative time. */
export type PaneRow = {
  kind: "session"
  id: string
  directory: string
  title: string
  state: ActivityState
  /** What the row's icon says; the order still uses `state`. */
  status: SessionStatus
  /** Workers (child sessions) of this session that run now; the row says so without moving. */
  workers: number
  /** Archived on the server: dimmed, and only listed while "Show archived" is on. */
  archived: boolean
  /** Last activity in ms since the epoch, for the shared order and the tooltip. */
  updated: number
  /** Short relative time after the title (`5m`, `2h`, `3d`). */
  description: string
  /** The chat shows this session. */
  current: boolean
}

/** A project group in a multi-root window. */
export type PaneProject = {
  kind: "project"
  directory: string
  name: string
  state: ActivityState
  /** The highest status among its sessions, for the group's icon. */
  status: SessionStatus
  /** Running workers of all its sessions, for the group's own indicator. */
  workers: number
  /** Sessions the user has not seen the last turn of. */
  unread: number
  /** Newest activity among the project's sessions, in ms since the epoch. */
  last: number
  /** The folder the chat view shows. */
  active: boolean
  /** Expanded by default for the active folder; a project starts collapsed otherwise. */
  expanded: boolean
  sessions: PaneRow[]
}

/** No workspace folder, one flat list, or one group per workspace folder. */
export type PaneLayout = { kind: "empty" } | { kind: "sessions"; sessions: PaneRow[] } | { kind: "projects"; projects: PaneProject[] }

/** The parts of `AppState` the pane reads for the active folder. */
export type PaneState = Pick<
  AppState,
  "folders" | "directory" | "folderName" | "projectName" | "sessions" | "archived" | "showArchived" | "running" | "waiting" | "workerRunning" | "target" | "sessionsLoaded"
>

/**
 * The active folder's controller keeps the server's root list, which carries archived sessions too; the archived page
 * adds the same rows. "Show archived" must still list every session once.
 */
function uniqueSessions(sessions: readonly PaneSession[]): PaneSession[] {
  const seen = new Set<string>()
  return sessions.filter((session) => {
    if (seen.has(session.id)) return false
    seen.add(session.id)
    return true
  })
}

/**
 * The pane's folder inputs from the webview's state: the active folder comes from `AppState` (fresh, with the
 * current session), the other folders of a multi-root window from the light `folderSessions` message.
 */
export function paneFolders(state: PaneState, folderSessions: readonly FolderSessions[]): PaneFolder[] {
  const currentID = state.target.kind === "session" ? state.target.id : undefined
  // "Show archived" is a property of the active folder's controller; other folders keep their light list as posted.
  const activeSessions = state.showArchived ? uniqueSessions([...state.sessions, ...state.archived]) : state.sessions
  const list = state.folders ?? []
  if (list.length <= 1) {
    return [
      {
        directory: state.directory,
        name: state.folderName,
        projectName: state.projectName,
        active: true,
        sessions: activeSessions,
        running: new Set(state.running),
        waiting: new Set(state.waiting),
        workers: new Map(Object.entries(state.workerRunning)),
        currentID,
        loaded: state.sessionsLoaded,
        includeArchived: state.showArchived,
      },
    ]
  }
  return list.map((folder): PaneFolder => {
    if (folder.active) {
      return {
        directory: folder.directory,
        name: folder.name,
        projectName: folder.projectName,
        active: true,
        sessions: activeSessions,
        running: new Set(state.running),
        waiting: new Set(state.waiting),
        workers: new Map(Object.entries(state.workerRunning)),
        currentID,
        loaded: state.sessionsLoaded,
        includeArchived: state.showArchived,
      }
    }
    const light = folderSessions.find((entry) => sameDirectory(entry.directory, folder.directory))
    return {
      directory: folder.directory,
      name: folder.name,
      projectName: folder.projectName,
      active: false,
      sessions: light?.sessions ?? [],
      running: new Set(light?.running ?? []),
      waiting: new Set(light?.waiting ?? []),
      workers: new Map(Object.entries(light?.workerRunning ?? {})),
      loaded: light?.loaded ?? false,
    }
  })
}

/** A session row: title, live state, last activity and the short relative time. */
function sessionRows(folder: PaneFolder, now: number): PaneRow[] {
  const sets = { running: folder.running, waiting: folder.waiting }
  const currentID = folder.active ? folder.currentID : undefined
  const rows = folder.sessions
    // The pane lists root sessions only. Archived ones stay hidden until "Show archived".
    .filter((session) => !session.parentID && (folder.includeArchived || session.time.archived === undefined))
    .map((session): PaneRow => {
      const activity = sessionActivity(session, sets)
      return {
        kind: "session",
        id: session.id,
        directory: folder.directory,
        title: session.title?.trim() || UNTITLED,
        state: activity.state,
        status: sessionStatus(session, sets, now),
        workers: folder.workers.get(session.id) ?? 0,
        archived: session.time.archived !== undefined,
        updated: activity.last,
        description: relativeTime(activity.last, now),
        current: session.id === currentID,
      }
    })
  return sortByActivity(rows, (row) => ({ state: row.state, last: row.updated, title: row.title, id: row.id }))
}

/** A project group: its name, aggregated state and ordered sessions. */
function projectRows(folders: readonly PaneFolder[], now: number): PaneProject[] {
  const projects = folders.map((folder): PaneProject => {
    const sessions = sessionRows(folder, now)
    const activity = combineActivity(sessions.map((session) => ({ state: session.state, last: session.updated })))
    return {
      kind: "project",
      directory: folder.directory,
      name: folder.projectName?.trim() || folder.name || folder.directory,
      state: activity.state,
      status: combineStatus(sessions.map((session) => session.status)),
      workers: sessions.reduce((count, session) => count + session.workers, 0),
      unread: unreadCount(sessions.map((session) => session.status)),
      last: activity.last,
      active: folder.active,
      expanded: folder.active,
      sessions,
    }
  })
  return sortByActivity(projects, (project) => ({ state: project.state, last: project.last, title: project.name, id: project.directory }))
}

/**
 * The whole pane for a window: a message with no folder, a flat list with one, and project groups with several.
 * `now` is passed in so the relative times are deterministic in tests.
 */
export function buildPane(folders: readonly PaneFolder[], now: number): PaneLayout {
  if (folders.length === 0) return { kind: "empty" }
  if (folders.length === 1) return { kind: "sessions", sessions: sessionRows(folders[0]!, now) }
  return { kind: "projects", projects: projectRows(folders, now) }
}

/**
 * The pane's inputs are immutable and shared: a state patch keeps every field the event did not touch, and the light
 * `folderSessions` message is only replaced when it really changed. So comparing those references is enough to know
 * that rebuilding the rows would produce the same rows — and a transcript delta, which replaces none of them, then
 * costs no row objects at all.
 */
export class PaneMemo {
  private key: unknown[] = []
  private folders: PaneFolder[] = []
  private layout: PaneLayout = { kind: "empty" }

  build(state: PaneState, folderSessions: readonly FolderSessions[], now: number): { folders: PaneFolder[]; layout: PaneLayout } {
    const key = [
      state.directory,
      state.folderName,
      state.projectName,
      state.folders,
      state.sessions,
      state.archived,
      state.showArchived,
      state.sessionsLoaded,
      state.running,
      state.waiting,
      state.workerRunning,
      state.target,
      folderSessions,
      now,
    ]
    if (key.length === this.key.length && key.every((value, i) => value === this.key[i])) return { folders: this.folders, layout: this.layout }
    this.key = key
    this.folders = paneFolders(state, folderSessions)
    this.layout = buildPane(this.folders, now)
    return { folders: this.folders, layout: this.layout }
  }
}

/**
 * Keep the rows that match `query`, case-insensitively. A project stays when its name matches (with all its
 * sessions); otherwise only its matching sessions stay. An empty query keeps everything.
 */
export function filterPane(layout: PaneLayout, query: string): PaneLayout {
  const q = query.trim().toLowerCase()
  if (!q || layout.kind === "empty") return layout
  if (layout.kind === "sessions") return { kind: "sessions", sessions: layout.sessions.filter((row) => row.title.toLowerCase().includes(q)) }
  const projects = layout.projects.flatMap((project): PaneProject[] => {
    if (project.name.toLowerCase().includes(q) || project.directory.toLowerCase().includes(q)) return [project]
    const sessions = project.sessions.filter((row) => row.title.toLowerCase().includes(q))
    return sessions.length > 0 ? [{ ...project, sessions }] : []
  })
  return { kind: "projects", projects }
}

/* -------------------------------------------------------------- stable order */

/**
 * The ids the pane froze when it opened: the project order and each project's sessions. The flat single-folder list
 * uses the empty key, so one shape covers both layouts.
 */
export type FrozenPane = {
  projects: ReadonlyArray<string>
  sessions: Readonly<Record<string, ReadonlyArray<string>>>
}

const FLAT = ""

/** The ids of a built layout, so live updates can be replayed in that order. */
export function freezePane(layout: PaneLayout): FrozenPane {
  if (layout.kind === "sessions") return { projects: [], sessions: { [FLAT]: layout.sessions.map((row) => row.id) } }
  if (layout.kind === "projects") {
    return {
      projects: layout.projects.map((project) => project.directory),
      sessions: Object.fromEntries(layout.projects.map((project) => [project.directory, project.sessions.map((row) => row.id)])),
    }
  }
  return { projects: [], sessions: {} }
}

/** Put the rows back into the frozen order. States and titles stay live; only the sequence is held. */
export function applyPaneOrder(layout: PaneLayout, frozen: FrozenPane): PaneLayout {
  if (layout.kind === "sessions") {
    const ids = stableOrder(
      frozen.sessions[FLAT] ?? [],
      layout.sessions.map((row) => row.id),
    )
    const byId = new Map(layout.sessions.map((row) => [row.id, row]))
    return { kind: "sessions", sessions: ids.flatMap((id) => byId.get(id) ?? []) }
  }
  if (layout.kind === "projects") {
    const byDirectory = new Map(layout.projects.map((project) => [project.directory, project]))
    const directories = stableOrder(
      frozen.projects,
      layout.projects.map((project) => project.directory),
    )
    return {
      kind: "projects",
      projects: directories.flatMap((directory) => {
        const project = byDirectory.get(directory)
        if (!project) return []
        const ids = stableOrder(
          frozen.sessions[directory] ?? [],
          project.sessions.map((row) => row.id),
        )
        const byId = new Map(project.sessions.map((row) => [row.id, row]))
        return [{ ...project, sessions: ids.flatMap((id) => byId.get(id) ?? []) }]
      }),
    }
  }
  return layout
}

/* ------------------------------------------------------------------- layout */

/** From this width the pane takes a column of its own; below it, it overlays the chat instead of squeezing it. */
export const PANE_WIDE_MIN = 560
/** The pane's column width when there is room for both. */
export const PANE_WIDTH = 240

export type PaneMode = "wide" | "overlay"

export function paneMode(width: number): PaneMode {
  return width >= PANE_WIDE_MIN ? "wide" : "overlay"
}

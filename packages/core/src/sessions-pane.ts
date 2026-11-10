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
import { UNTITLED } from "./sessions"
import { stableOrder } from "./stable-order"

/** A root session as the pane lists it. Light: no transcript, cost or tokens. */
export type PaneSession = {
  id: string
  title?: string
  parentID?: string
  time: { created: number; updated: number; busy?: number; idle?: number; archived?: number }
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
  /** The session the chat shows; only meaningful for the active folder. */
  currentID?: string
  /** The controller has loaded its session list at least once. */
  loaded: boolean
}

/** A session row: title, live state, last activity and the short relative time. */
export type PaneRow = {
  kind: "session"
  id: string
  directory: string
  title: string
  state: ActivityState
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
export type PaneState = Pick<AppState, "folders" | "directory" | "folderName" | "projectName" | "sessions" | "running" | "waiting" | "target" | "sessionsLoaded">

/**
 * The pane's folder inputs from the webview's state: the active folder comes from `AppState` (fresh, with the
 * current session), the other folders of a multi-root window from the light `folderSessions` message.
 */
export function paneFolders(state: PaneState, folderSessions: readonly FolderSessions[]): PaneFolder[] {
  const currentID = state.target.kind === "session" ? state.target.id : undefined
  const list = state.folders ?? []
  if (list.length <= 1) {
    return [
      {
        directory: state.directory,
        name: state.folderName,
        projectName: state.projectName,
        active: true,
        sessions: state.sessions,
        running: new Set(state.running),
        waiting: new Set(state.waiting),
        currentID,
        loaded: state.sessionsLoaded,
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
        sessions: state.sessions,
        running: new Set(state.running),
        waiting: new Set(state.waiting),
        currentID,
        loaded: state.sessionsLoaded,
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
      loaded: light?.loaded ?? false,
    }
  })
}

/** A session row: title, live state, last activity and the short relative time. */
function sessionRows(folder: PaneFolder, now: number): PaneRow[] {
  const sets = { running: folder.running, waiting: folder.waiting }
  const currentID = folder.active ? folder.currentID : undefined
  const rows = folder.sessions
    // The pane lists root sessions only, and never the archived ones.
    .filter((session) => !session.parentID && session.time.archived === undefined)
    .map((session): PaneRow => {
      const activity = sessionActivity(session, sets)
      return {
        kind: "session",
        id: session.id,
        directory: folder.directory,
        title: session.title?.trim() || UNTITLED,
        state: activity.state,
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

/**
 * The sessions sidebar's data model: folder states plus each folder's root sessions, turned into the nodes the
 * TreeView renders. Pure (no `vscode` import) so the layout and the shared order are unit-tested directly.
 *
 * The order is the one both clients use (`@occ/core/activity-order`): waiting, then running, then the newest activity,
 * with the title and the id as tie-breakers. Projects are placed by the highest state and newest activity of their
 * sessions, so a project and a session read the same way.
 */
import type { SessionInfo } from "@occ/core/api"
import { combineActivity, sessionActivity, sortByActivity, type ActivityState } from "@occ/core/activity-order"
import { relativeTime } from "@occ/core/format"
import { UNTITLED } from "@occ/core/sessions"

/** One folder's live data, as the registry and its controller already hold it. */
export type FolderInput = {
  directory: string
  /** The workspace folder's name, used when OpenCode has no project name. */
  name: string
  /** OpenCode's name for the folder's project, when it has one. */
  projectName?: string
  /** `~`-shortened path for the project row. */
  displayPath: string
  /** The folder the chat view shows. */
  active: boolean
  /** Root sessions of the folder. Workers and archived sessions are filtered out here. */
  sessions: readonly SessionInfo[]
  running: ReadonlySet<string>
  waiting: ReadonlySet<string>
  /** The session the chat shows; only meaningful for the active folder. */
  currentID?: string
  /** The controller has loaded its session list at least once. */
  loaded: boolean
}

export type SessionNode = {
  kind: "session"
  id: string
  directory: string
  title: string
  state: ActivityState
  /** Last activity in ms since the epoch, for the shared order and the tooltip. */
  updated: number
  /** Short relative time under the title (`5m`, `2h`, `3d`). */
  description: string
  /** The chat shows this session. */
  current: boolean
}

export type ProjectNode = {
  kind: "project"
  directory: string
  name: string
  displayPath: string
  state: ActivityState
  /** Newest activity among the project's sessions, in ms since the epoch. */
  last: number
  /** The folder the chat view shows. */
  active: boolean
  /** Expanded by default for the active folder; a project starts collapsed otherwise. */
  expanded: boolean
  sessions: SessionNode[]
}

/** No workspace folder, one flat list, or one node per workspace folder. */
export type TreeLayout = { kind: "empty" } | { kind: "sessions"; sessions: SessionNode[] } | { kind: "projects"; projects: ProjectNode[] }

/** A session row: title, live state, last activity and the short relative time. */
function sessionNodes(folder: FolderInput, now: number): SessionNode[] {
  const sets = { running: folder.running, waiting: folder.waiting }
  const currentID = folder.active ? folder.currentID : undefined
  const nodes = folder.sessions
    // The sidebar lists root sessions only, and never the archived ones.
    .filter((session) => !session.parentID && session.time.archived === undefined)
    .map((session): SessionNode => {
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
  return sortByActivity(nodes, (node) => ({ state: node.state, last: node.updated, title: node.title, id: node.id }))
}

/** A project row: its name, path, aggregated state and ordered sessions. */
function projectNodes(folders: readonly FolderInput[], now: number): ProjectNode[] {
  const projects = folders.map((folder): ProjectNode => {
    const sessions = sessionNodes(folder, now)
    const activity = combineActivity(sessions.map((session) => ({ state: session.state, last: session.updated })))
    return {
      kind: "project",
      directory: folder.directory,
      name: folder.projectName?.trim() || folder.name || folder.directory,
      displayPath: folder.displayPath,
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
 * The whole view for a window: a message with no folder, a flat list with one, and project nodes with several.
 * `now` is passed in so the relative times are deterministic in tests.
 */
export function buildTree(folders: readonly FolderInput[], now: number): TreeLayout {
  if (folders.length === 0) return { kind: "empty" }
  if (folders.length === 1) return { kind: "sessions", sessions: sessionNodes(folders[0]!, now) }
  return { kind: "projects", projects: projectNodes(folders, now) }
}

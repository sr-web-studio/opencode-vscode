/**
 * The server-wide overview behind the app's drawer: every project and its root sessions, in the shared activity order.
 *
 * The phone has no controller for every project (that would be one event stream each), so this module works on the
 * plain lists the server answers: `project.list`, `session.list({ parentID: null })` and `session.active()`, plus the
 * pending permission/form requests per folder. Live events are folded into the same state.
 *
 * Pure: no client, no DOM, no clock. The reactive store in `overview.svelte.ts` owns the requests and the stream; this
 * module owns the rules (grouping, ordering, filtering and event application), so they are tested without a server.
 */
import { combineActivity, sessionActivity, sortByActivity, type Activity, type ActivityState } from "@occ/core/activity-order"
import type { EventEnvelope, SessionInfo } from "@occ/core/api"
import { folderName, sameDirectory, shortenHome } from "@occ/core/paths"
import { UNTITLED } from "@occ/core/sessions"
import { guessHome, projectRows, type ProjectLike, type ProjectRow } from "./projects"

/** The root session fields the drawer needs; `time` keeps the same names as the server's record. */
export type OverviewSession = {
  id: string
  title: string
  directory: string
  archived: boolean
  time: {
    created: number
    updated: number
    busy?: number
    idle?: number
  }
}

/** Everything the drawer derives its rows from, kept as plain data so it is easy to copy and test. */
export type OverviewData = {
  projects: ProjectLike[]
  sessions: OverviewSession[]
  /** Ids of turns running now, from `session.active()` and the execution events. */
  running: string[]
  /** Session id → ids of its open permission requests. */
  permissions: Record<string, string[]>
  /** Session id → ids of its open forms (questions). */
  forms: Record<string, string[]>
}

export type OverviewSessionRow = OverviewSession & { title: string; state: ActivityState; last: number }

export type OverviewGroup = {
  directory: string
  title: string
  path: string
  projectName?: string
  /** Newest activity of the project's sessions and of its own record. */
  last: number
  /** The highest state among its sessions. */
  state: ActivityState
  sessions: OverviewSessionRow[]
}

export type OverviewNames = {
  /** Folder → the project id `location.get` returned (the Projects screen's map). */
  resolved?: ReadonlyMap<string, string>
  /** Folder → the name OpenCode has for it, `undefined` when it has none. */
  titles?: ReadonlyMap<string, string | undefined>
}

const trimSlash = (p: string): string => (p.length > 1 ? p.replace(/[\\/]+$/, "") : p)

export const emptyOverview = (): OverviewData => ({ projects: [], sessions: [], running: [], permissions: {}, forms: {} })

/** One root session as the drawer keeps it. */
export function toOverviewSession(session: SessionInfo): OverviewSession {
  return {
    id: session.id,
    title: session.title?.trim() ?? "",
    directory: trimSlash(session.location?.directory ?? ""),
    archived: session.time?.archived !== undefined,
    time: {
      created: session.time?.created ?? 0,
      updated: session.time?.updated ?? 0,
      busy: session.time?.busy,
      idle: session.time?.idle,
    },
  }
}

/** Ids whose turn is blocked on the user: an open permission request or an open form. */
export function waitingSessions(data: Pick<OverviewData, "permissions" | "forms">): Set<string> {
  const out = new Set<string>()
  for (const [id, requests] of Object.entries(data.permissions)) if (requests.length > 0) out.add(id)
  for (const [id, forms] of Object.entries(data.forms)) if (forms.length > 0) out.add(id)
  return out
}

/** The live sets the shared order reads. */
export function overviewSets(data: Pick<OverviewData, "running" | "permissions" | "forms">): { running: Set<string>; waiting: Set<string> } {
  return { running: new Set(data.running), waiting: waitingSessions(data) }
}

/**
 * One row per project folder, in the shared order. A session belongs to the first project folder with the same path
 * (`sameDirectory`, so spelling and trailing slashes do not split a folder); a session whose folder is not a known
 * project still gets a group named after that folder, so nothing disappears from the drawer.
 */
export function buildOverview(data: OverviewData, names: OverviewNames = {}): OverviewGroup[] {
  const rows = projectRows(data.projects, "", names.resolved)
  const home = guessHome(data.projects.map((p) => p.canonical))
  const sets = overviewSets(data)
  const byFolder = new Map<string, OverviewSession[]>()
  const rowOf = (directory: string): ProjectRow | undefined => rows.find((row) => sameDirectory(row.directory, directory))
  const folderOf = (directory: string): string => rowOf(directory)?.directory ?? trimSlash(directory)

  for (const session of data.sessions) {
    if (session.archived || !session.directory) continue
    const folder = folderOf(session.directory)
    const list = byFolder.get(folder)
    if (list) list.push(session)
    else byFolder.set(folder, [session])
  }

  const groups: OverviewGroup[] = []
  const seen = new Set<string>()
  const add = (directory: string, row: ProjectRow | undefined, sessions: OverviewSession[]): void => {
    if (seen.has(directory)) return
    seen.add(directory)
    const ordered = sortByActivity(
      sessions.map((session) => {
        const activity = sessionActivity({ id: session.id, time: session.time }, sets)
        return { ...session, title: session.title.trim() || UNTITLED, state: activity.state, last: activity.last }
      }),
      (session) => ({ state: session.state, last: session.last, title: session.title, id: session.id }),
    )
    const own = row?.last ?? 0
    const combined = combineActivity(
      ordered.map((session) => ({ state: session.state, last: session.last })),
      own,
    )
    const title = names.titles?.has(directory) ? (names.titles.get(directory) ?? folderName(directory)) : (row?.title ?? folderName(directory))
    groups.push({
      directory,
      title,
      path: row?.path ?? shortenHome(directory, home),
      projectName: row?.projectName,
      last: combined.last,
      state: combined.state,
      sessions: ordered,
    })
  }

  // Known projects first (even with no session), then folders only sessions know about.
  for (const row of rows) add(row.directory, row, byFolder.get(row.directory) ?? [])
  for (const [folder, sessions] of byFolder) add(folder, rowOf(folder), sessions)

  return sortByActivity(groups, (group) => ({ state: group.state, last: group.last, title: group.title, id: group.directory }))
}

/** Keep the projects (or just the sessions) that match `query`, case-insensitively. Empty query keeps everything. */
export function filterOverview(groups: ReadonlyArray<OverviewGroup>, query: string): OverviewGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...groups]
  const out: OverviewGroup[] = []
  for (const group of groups) {
    const projectHit = group.title.toLowerCase().includes(q) || group.path.toLowerCase().includes(q)
    const sessions = projectHit ? group.sessions : group.sessions.filter((session) => session.title.toLowerCase().includes(q))
    if (projectHit || sessions.length > 0) out.push({ ...group, sessions })
  }
  return out
}

/* ------------------------------------------------------------- live events */

export type OverviewEventResult = { state: OverviewData; refetch?: boolean }

const addId = (map: Record<string, string[]>, sessionID: string, id: string): Record<string, string[]> => {
  const current = map[sessionID] ?? []
  if (current.includes(id)) return map
  return { ...map, [sessionID]: [...current, id] }
}

const removeId = (map: Record<string, string[]>, sessionID: string, id: string): Record<string, string[]> => {
  const current = map[sessionID]
  if (!current?.includes(id)) return map
  const next = current.filter((entry) => entry !== id)
  const copy = { ...map }
  if (next.length > 0) copy[sessionID] = next
  else delete copy[sessionID]
  return copy
}

const touch = (sessions: OverviewSession[], id: string, at: number | undefined, patch: Partial<OverviewSession["time"]> = {}): OverviewSession[] => {
  if (!at) return sessions
  return sessions.map((session) => (session.id === id ? { ...session, time: { ...session.time, ...patch, updated: Math.max(session.time.updated, at) } } : session))
}

const without = (list: string[], id: string): string[] => (list.includes(id) ? list.filter((entry) => entry !== id) : list)
const withId = (list: string[], id: string): string[] => (list.includes(id) ? list : [...list, id])

const withoutSession = (map: Record<string, string[]>, sessionID: string): Record<string, string[]> => {
  if (!(sessionID in map)) return map
  const copy = { ...map }
  delete copy[sessionID]
  return copy
}

const eventDirectory = (ev: EventEnvelope): string => trimSlash(ev.data?.location?.directory ?? ev.location?.directory ?? "")

/**
 * Fold one server event into the overview. Unknown events return the same object, so the store can skip a redraw.
 * `refetch` asks the store for a fresh snapshot when an event alone cannot tell the whole story (a reconnect, or a
 * session coming back from the archive that the initial list never carried).
 */
export function applyOverviewEvent(data: OverviewData, ev: EventEnvelope): OverviewEventResult {
  const d = ev.data ?? {}
  const sessionID = typeof d.sessionID === "string" ? d.sessionID : typeof d.form?.sessionID === "string" ? d.form.sessionID : undefined
  switch (ev.type) {
    case "server.connected":
      return { state: data, refetch: true }
    case "session.created":
    case "session.forked": {
      // Children are workers, not drawer rows.
      if (d.parentID || !sessionID) return { state: data }
      if (data.sessions.some((session) => session.id === sessionID)) return { state: data }
      const directory = eventDirectory(ev)
      if (!directory) return { state: data }
      const at = ev.created ?? 0
      const session: OverviewSession = {
        id: sessionID,
        title: typeof d.title === "string" ? d.title.trim() : "",
        directory,
        archived: false,
        time: { created: at, updated: at },
      }
      return { state: { ...data, sessions: [...data.sessions, session] } }
    }
    case "session.renamed": {
      if (!sessionID || typeof d.title !== "string") return { state: data }
      const title = d.title.trim()
      return { state: { ...data, sessions: data.sessions.map((session) => (session.id === sessionID ? { ...session, title } : session)) } }
    }
    case "session.deleted": {
      if (!sessionID) return { state: data }
      return {
        state: {
          ...data,
          sessions: data.sessions.filter((session) => session.id !== sessionID),
          running: without(data.running, sessionID),
          permissions: withoutSession(data.permissions, sessionID),
          forms: withoutSession(data.forms, sessionID),
        },
      }
    }
    case "session.archived": {
      if (!sessionID) return { state: data }
      return { state: { ...data, sessions: data.sessions.map((session) => (session.id === sessionID ? { ...session, archived: true } : session)) } }
    }
    case "session.unarchived": {
      if (!sessionID) return { state: data }
      const known = data.sessions.some((session) => session.id === sessionID)
      if (!known) return { state: data, refetch: true }
      return { state: { ...data, sessions: data.sessions.map((session) => (session.id === sessionID ? { ...session, archived: false } : session)) } }
    }
    case "session.execution.started": {
      if (!sessionID) return { state: data }
      return { state: { ...data, running: withId(data.running, sessionID), sessions: touch(data.sessions, sessionID, ev.created, { busy: ev.created }) } }
    }
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted": {
      if (!sessionID) return { state: data }
      return { state: { ...data, running: without(data.running, sessionID), sessions: touch(data.sessions, sessionID, ev.created, { idle: ev.created, busy: undefined }) } }
    }
    case "session.status": {
      if (!sessionID) return { state: data }
      const status = d.status?.type
      if (status === "busy" || status === "retry") return { state: { ...data, running: withId(data.running, sessionID), sessions: touch(data.sessions, sessionID, ev.created, { busy: ev.created }) } }
      if (status === "idle") return { state: { ...data, running: without(data.running, sessionID), sessions: touch(data.sessions, sessionID, ev.created, { idle: ev.created, busy: undefined }) } }
      return { state: data }
    }
    case "session.idle": {
      if (!sessionID) return { state: data }
      return { state: { ...data, running: without(data.running, sessionID), sessions: touch(data.sessions, sessionID, ev.created, { idle: ev.created, busy: undefined }) } }
    }
    case "permission.asked": {
      if (!sessionID || typeof d.id !== "string") return { state: data }
      return { state: { ...data, permissions: addId(data.permissions, sessionID, d.id) } }
    }
    case "permission.replied": {
      if (!sessionID || typeof d.requestID !== "string") return { state: data }
      return { state: { ...data, permissions: removeId(data.permissions, sessionID, d.requestID) } }
    }
    case "form.created": {
      const form = d.form
      if (!form || typeof form.id !== "string" || typeof form.sessionID !== "string") return { state: data }
      return { state: { ...data, forms: addId(data.forms, form.sessionID, form.id) } }
    }
    case "form.replied":
    case "form.cancelled": {
      if (!sessionID || typeof d.id !== "string") return { state: data }
      return { state: { ...data, forms: removeId(data.forms, sessionID, d.id) } }
    }
    case "project.updated": {
      if (typeof d.id !== "string" || !d.id) return { state: data }
      const projects = data.projects.some((project) => project.id === d.id)
        ? data.projects.map((project) => (project.id === d.id ? { ...project, ...d } : project))
        : [...data.projects, d as ProjectLike]
      return { state: { ...data, projects } }
    }
    case "session.moved": {
      if (!sessionID) return { state: data }
      const directory = eventDirectory(ev)
      if (!directory) return { state: data }
      return { state: { ...data, sessions: data.sessions.map((session) => (session.id === sessionID ? { ...session, directory } : session)) } }
    }
    default:
      return { state: data }
  }
}

/** The activity of a group as the shared order reads it (exported for the tests and for a caller that re-sorts). */
export const groupActivity = (group: OverviewGroup): Activity => ({ state: group.state, last: group.last })

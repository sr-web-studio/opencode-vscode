/**
 * The project list: what `project.list` returns, turned into rows. The server can hold several project records for one
 * folder (a git worktree, a re-created project, a different id after a move, a `global` record), so rows are grouped by
 * folder. The row title is the name of the folder's *authoritative* project — the one `location.get` names — because
 * another record of the same folder can carry a different, older name.
 * Pure: no client, no DOM.
 */
import { normalizeProjectName } from "@occ/core/project-names"
import { folderName, shortenHome } from "@occ/core/paths"

/** The part of `Project` this screen reads. */
export type ProjectLike = {
  id: string
  canonical: string
  name?: string
  time: { created: number; updated: number; active: number }
}

export type ProjectRow = {
  /** The folder, used as the key and as the controller's directory. */
  directory: string
  /** The name OpenCode shows for the folder's authoritative project, else the folder name. */
  title: string
  /** The project's own name, when OpenCode has one. */
  projectName?: string
  /** `~`-shortened folder for display. */
  path: string
  /** Last activity (ms): the newest of `updated` and `active` over every record of the folder. */
  last: number
  /** Project ids that share the folder. */
  ids: string[]
  /** The folder's authoritative project, once `location.get` has named it. */
  projectID?: string
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/[\\/]+$/, "") : p)

/** `/home/<user>` or `/Users/<user>` from the folders we see, so `~` can be shown. Undefined when no folder tells. */
export function guessHome(directories: ReadonlyArray<string>): string | undefined {
  for (const d of directories) {
    const m = /^(\/home\/[^/]+|\/Users\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?:[\\/]|$)/.exec(d)
    if (m) return m[1]
  }
  return undefined
}

/** Every folder the list holds, once each, without a trailing slash. The folders `location.get` is asked about. */
export function projectFolders(projects: ReadonlyArray<ProjectLike>): string[] {
  return [...new Set(projects.map((p) => trimSlash(p.canonical)))]
}

/**
 * One row per folder, newest activity first.
 *
 * `resolved` maps a folder to the project id `location.get` returned. With it the row shows that record's name only
 * (an authoritative project without a name shows the folder name: another record's name is not this folder's name).
 * Until a folder is resolved — or when `location.get` failed — the row falls back to the most recently updated record
 * of the folder that has a name, which is stable for a given list.
 */
export function projectRows(projects: ReadonlyArray<ProjectLike>, query = "", resolved?: ReadonlyMap<string, string>): ProjectRow[] {
  const home = guessHome(projects.map((p) => p.canonical))
  const byId = new Map(projects.map((p) => [p.id, p]))
  const byDir = new Map<string, ProjectRow>()
  /** The fallback name per folder: the newest named record (`time.updated`), ties broken by id. */
  const fallback = new Map<string, { name: string; updated: number; id: string }>()
  for (const p of projects) {
    const directory = trimSlash(p.canonical)
    const last = Math.max(p.time.updated, p.time.active)
    const name = normalizeProjectName(p.name)
    const row = byDir.get(directory)
    if (!row) byDir.set(directory, { directory, title: "", path: shortenHome(directory, home), last, ids: [p.id] })
    else {
      row.ids.push(p.id)
      if (last > row.last) row.last = last
    }
    if (!name) continue
    const best = fallback.get(directory)
    if (!best || p.time.updated > best.updated || (p.time.updated === best.updated && p.id < best.id)) fallback.set(directory, { name, updated: p.time.updated, id: p.id })
  }
  for (const row of byDir.values()) {
    const projectID = resolved?.get(row.directory)
    // A resolved folder takes its own project's name; only an unresolved folder uses the deterministic fallback.
    const name = projectID ? normalizeProjectName(byId.get(projectID)?.name) : fallback.get(row.directory)?.name
    row.projectID = projectID
    row.projectName = name
    row.title = name ?? folderName(row.directory)
  }
  const q = query.trim().toLowerCase()
  return [...byDir.values()].filter((r) => !q || r.title.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)).sort((a, b) => b.last - a.last || a.directory.localeCompare(b.directory))
}

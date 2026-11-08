/**
 * The project list: what `project.list` returns, turned into rows. The server can hold several project records for one
 * folder (a git worktree, a re-created project, a different id after a move), so rows are grouped by folder.
 * Pure: no client, no DOM.
 */
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
  /** The project's own name when it has one, else the folder name. */
  title: string
  /** `~`-shortened folder for display. */
  path: string
  /** Last activity (ms): the newest of `updated` and `active` over every record of the folder. */
  last: number
  /** Project ids that share the folder. */
  ids: string[]
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

/** One row per folder, newest activity first. A name from any record of the folder wins over the folder name. */
export function projectRows(projects: ReadonlyArray<ProjectLike>, query = ""): ProjectRow[] {
  const home = guessHome(projects.map((p) => p.canonical))
  const byDir = new Map<string, ProjectRow>()
  for (const p of projects) {
    const directory = trimSlash(p.canonical)
    const last = Math.max(p.time.updated, p.time.active)
    const name = p.name?.trim()
    const row = byDir.get(directory)
    if (!row) {
      byDir.set(directory, { directory, title: name || folderName(directory), path: shortenHome(directory, home), last, ids: [p.id] })
      continue
    }
    row.ids.push(p.id)
    if (last > row.last) row.last = last
    if (name && row.title === folderName(directory)) row.title = name
  }
  const q = query.trim().toLowerCase()
  return [...byDir.values()]
    .filter((r) => !q || r.title.toLowerCase().includes(q) || r.path.toLowerCase().includes(q))
    .sort((a, b) => b.last - a.last || a.directory.localeCompare(b.directory))
}

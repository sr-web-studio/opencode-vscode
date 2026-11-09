import type { EventEnvelope, OpenCodeClient } from "@occ/core/api"
import { errorMessage } from "@occ/core/errors"
import { applyProjectUpdated, normalizeProjectName, projectNameOf, type ProjectNameRecord } from "@occ/core/project-names"

/** Where the names go: the folder registry, which the chat view reads. */
export type ProjectNameSink = { setProjectName(directory: string, name: string | undefined): void }

type Known = { projectID: string; name?: string }

/**
 * OpenCode's project names for this window's folders.
 *
 * The authoritative project id of a folder comes from `location.get`, not from `project.list`: the server can hold
 * several project records for one canonical path, and only one of them is the folder's project. Names then come from
 * `project.list` by that id. A `project.updated` event (a rename in the browser UI or on the phone) updates the name
 * live, and a reconnect refetches everything.
 *
 * No `vscode` import, so the lookup rules are unit-tested with a small fake client.
 */
export class ProjectNames {
  private readonly known = new Map<string, Known>()
  /** Project id → name, for `project.updated` payloads that arrive before a folder is known. */
  private readonly names = new Map<string, string>()

  constructor(
    private readonly sink: ProjectNameSink,
    private readonly log?: (line: string) => void,
  ) {}

  /** Refetch every folder's project id and name. Failures keep the names already shown. */
  async refresh(client: OpenCodeClient, directories: readonly string[]): Promise<void> {
    let projects: ProjectNameRecord[]
    try {
      projects = (await client.project.list({})).map((project) => ({ id: project.id, canonical: project.canonical, name: project.name }))
    } catch (e) {
      this.log?.(`project.list failed: ${errorMessage(e)}. Keeping the project names already shown.`)
      return
    }
    for (const project of projects) {
      const name = normalizeProjectName(project.name)
      if (name) this.names.set(project.id, name)
      else this.names.delete(project.id)
    }
    const located = await Promise.all(
      directories.map(async (directory) => {
        try {
          const info = await client.location.get({ location: { directory } })
          const projectID = typeof info?.project?.id === "string" && info.project.id ? info.project.id : undefined
          return { directory, projectID }
        } catch (e) {
          this.log?.(`location.get failed for ${directory}: ${errorMessage(e)}. Using the name already shown.`)
          return { directory, projectID: this.known.get(directory)?.projectID }
        }
      }),
    )
    for (const { directory, projectID } of located) {
      const name = projectID ? this.names.get(projectID) : undefined
      if (projectID) this.known.set(directory, { projectID, name })
      else this.known.delete(directory)
      this.sink.setProjectName(directory, name)
    }
  }

  /** A `project.updated` event carries the whole project; apply it to the folder that uses that project id. */
  apply(ev: EventEnvelope): void {
    if (ev.type !== "project.updated") return
    const project = ev.data as ProjectNameRecord | undefined
    if (!project || typeof project.id !== "string" || !project.id) return
    const next = applyProjectUpdated(this.names, project)
    this.names.clear()
    for (const [id, name] of next) this.names.set(id, name)
    const name = normalizeProjectName(project.name)
    for (const [directory, known] of [...this.known]) {
      if (known.projectID !== project.id) continue
      this.known.set(directory, { projectID: known.projectID, name })
      this.sink.setProjectName(directory, name)
    }
  }

  /** The project of one folder, fetched when the folder was added after the last refresh. */
  async resolve(client: OpenCodeClient, directory: string): Promise<Known | undefined> {
    const known = this.known.get(directory)
    if (known?.name) return known
    if (known) {
      // The id is known but the name may not have been fetched yet (a failed refresh): ask the list once.
      try {
        const name = projectNameOf(known.projectID, await client.project.list({}))
        this.known.set(directory, { projectID: known.projectID, name })
        this.sink.setProjectName(directory, name)
        return { projectID: known.projectID, name }
      } catch (e) {
        this.log?.(`project.list failed for ${directory}: ${errorMessage(e)}`)
        return known
      }
    }
    try {
      const info = await client.location.get({ location: { directory } })
      const projectID = typeof info?.project?.id === "string" && info.project.id ? info.project.id : undefined
      if (!projectID) return undefined
      let name: string | undefined
      try {
        name = projectNameOf(projectID, await client.project.list({}))
      } catch (e) {
        this.log?.(`project.list failed for ${directory}: ${errorMessage(e)}`)
      }
      this.known.set(directory, { projectID, name })
      this.sink.setProjectName(directory, name)
      return { projectID, name }
    } catch (e) {
      this.log?.(`location.get failed for ${directory}: ${errorMessage(e)}`)
      return undefined
    }
  }

  /** Remember a name this window just saved, before the server's `project.updated` event arrives. */
  set(directory: string, projectID: string, name: string | undefined): void {
    const next = normalizeProjectName(name)
    this.known.set(directory, { projectID, name: next })
    if (next) this.names.set(projectID, next)
    else this.names.delete(projectID)
    this.sink.setProjectName(directory, next)
  }
}

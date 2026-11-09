/**
 * OpenCode's project names for the folders the phone shows.
 *
 * `project.list` can hold several records for one folder and a `global` record, so a folder's authoritative project is
 * the id `location.get` returns; names then come from `project.list` by that id. Resolving 30 folders one after another
 * takes seconds (the live server answers each in about 80 ms), so a few are asked in parallel and the rows keep a
 * deterministic fallback until each answer arrives. A `project.updated` event carries the whole project and updates the
 * name live wherever a controller's event stream is open.
 *
 * Pure apart from the client calls: the sink is the screen's state, so the rules are tested with a fake client.
 */
import type { EventEnvelope, OpenCodeClient } from "@occ/core/api"
import { errorMessage } from "@occ/core/errors"
import { applyProjectUpdated, normalizeProjectName, type ProjectNameRecord } from "@occ/core/project-names"

/** Where a resolved project goes. `projectID`/`name` are undefined when the folder has no project or no name. */
export type ProjectNameSink = { setProject(directory: string, projectID: string | undefined, name: string | undefined): void }

/**
 * `location.get` calls in flight at once. Measured on the live server with 32 folders: 4.3 s one after another, 135 ms
 * with four at a time, 190 ms with eight (the first time) — four keeps the burst small and the wait short.
 */
export const LOCATE_CONCURRENCY = 4

export class ProjectNames {
  /** The authoritative project of each folder. */
  private readonly ids = new Map<string, string>()
  /** Project id → name, from `project.list` and `project.updated`. */
  private readonly names = new Map<string, string>()
  /** Folders being resolved right now, so two screens asking do not send two requests. */
  private readonly pending = new Map<string, Promise<string | undefined>>()

  constructor(
    private readonly sink: ProjectNameSink,
    private readonly log?: (line: string) => void,
  ) {}

  /** Fold `project.list` into the name map; folders already resolved are told again (a reload may carry a rename). */
  applyList(projects: ReadonlyArray<ProjectNameRecord>): void {
    for (const project of projects) {
      const name = normalizeProjectName(project.name)
      if (name) this.names.set(project.id, name)
      else this.names.delete(project.id)
    }
    for (const [directory, projectID] of this.ids) this.sink.setProject(directory, projectID, this.names.get(projectID))
  }

  /** The folder's authoritative project id, from the cache or `location.get`. Failures keep what is known. */
  resolve(client: OpenCodeClient, directory: string): Promise<string | undefined> {
    const cached = this.ids.get(directory)
    if (cached) return Promise.resolve(cached)
    const running = this.pending.get(directory)
    if (running) return running
    const request = this.locate(client, directory).finally(() => this.pending.delete(directory))
    this.pending.set(directory, request)
    return request
  }

  /** Resolve many folders a few at a time; each answer reaches the sink as it arrives. Never throws. */
  async resolveAll(client: OpenCodeClient, directories: ReadonlyArray<string>): Promise<void> {
    const queue = [...new Set(directories)].filter((directory) => !this.ids.has(directory))
    let next = 0
    const run = async (): Promise<void> => {
      while (next < queue.length) await this.resolve(client, queue[next++]!)
    }
    await Promise.all(Array.from({ length: Math.min(LOCATE_CONCURRENCY, queue.length) }, run))
  }

  /** A `project.updated` event carries the whole project: apply it to every folder that uses that id. */
  apply(ev: EventEnvelope): void {
    if (ev.type !== "project.updated") return
    const project = ev.data as ProjectNameRecord | undefined
    if (!project || typeof project.id !== "string" || !project.id) return
    const next = applyProjectUpdated(this.names, project)
    this.names.clear()
    for (const [id, name] of next) this.names.set(id, name)
    const name = normalizeProjectName(project.name)
    for (const [directory, projectID] of this.ids) if (projectID === project.id) this.sink.setProject(directory, projectID, name)
  }

  /** Remember a name this phone just saved, before the server's `project.updated` event arrives. */
  set(directory: string, projectID: string, name: string | undefined): void {
    this.ids.set(directory, projectID)
    const next = normalizeProjectName(name)
    if (next) this.names.set(projectID, next)
    else this.names.delete(projectID)
    this.sink.setProject(directory, projectID, next)
  }

  /** The authoritative project id of a folder, when it is known. */
  idOf(directory: string): string | undefined {
    return this.ids.get(directory)
  }

  /** The name OpenCode has for a folder's project, when it has one. */
  nameOf(directory: string): string | undefined {
    const projectID = this.ids.get(directory)
    return projectID ? this.names.get(projectID) : undefined
  }

  private async locate(client: OpenCodeClient, directory: string): Promise<string | undefined> {
    try {
      const info = await client.location.get({ location: { directory } })
      const projectID = typeof info?.project?.id === "string" && info.project.id ? info.project.id : undefined
      if (!projectID) {
        this.sink.setProject(directory, undefined, undefined)
        return undefined
      }
      this.ids.set(directory, projectID)
      this.sink.setProject(directory, projectID, this.names.get(projectID))
      return projectID
    } catch (e) {
      // A folder that no longer exists (`LocationNotFoundError`) keeps the fallback name the list already gives it.
      this.log?.(`location.get failed for ${directory}: ${errorMessage(e)}. Using the list's name.`)
      return undefined
    }
  }
}

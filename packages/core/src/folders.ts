import type { OpenCodeClient } from "./api"
import { sameDirectory } from "./paths"
import { defaultViewSettings, type Action, type AppState, type ConnectionState, type FolderInfo, type ViewSettings } from "./protocol"

/**
 * One project folder's controller, as far as the registry needs to know it. `Controller` satisfies this structurally;
 * tests use a small fake.
 */
export type FolderController = {
  /** The server's spelling of the folder, which can differ from the workspace path (e.g. `d:` vs `D:`). */
  readonly directory: string
  /** The workspace path, stable across server syncs: map keys use this, never `directory`. */
  readonly folderPath: string
  readonly currentSessionID: string | undefined
  attach(client: OpenCodeClient): void
  detach(): void
  setConnection(connection: ConnectionState): void
  setSettings(settings: ViewSettings): void
  setVoice(voice: AppState["voice"]): void
  setFolderInfo(folderName: string, displayPath: string): void
  snapshot(): AppState
  listsSession(id: string): boolean
  /** A session this folder lists is executing (cheap: no snapshot). */
  isBusy(): boolean
  /** A session this folder lists waits for the user (cheap: no snapshot). */
  isWaiting(): boolean
  open(id: string): Promise<void>
  dispatch(action: Action): Promise<void>
  /** The chat view shows this folder (or not): only the folder on screen loads its transcript at startup. */
  setActive(active: boolean): void
}

/** A workspace folder the view can show. */
export type FolderEntry = { directory: string; folderName: string; displayPath: string }

export type FolderRegistryOptions<C extends FolderController> = {
  /** Create a controller for one folder. `primary` is the first folder, whose stored state keeps the old keys. */
  make(entry: FolderEntry & { primary: boolean }): C
  /** Remember the folder the user was last looking at (VS Code: workspaceState). */
  remember?: { get(): string | undefined; set(directory: string): void }
}

/** With no workspace folder the view still needs a controller: it shows "Open a folder to use OpenCode." */
const PLACEHOLDER: FolderEntry = { directory: "", folderName: "", displayPath: "" }

/**
 * Storage key for one folder. The first folder keeps the existing keys, so a single-folder window (and the first folder
 * of a multi-root window) finds the state it saved before multi-root support. Other folders get their own namespace.
 */
export function folderStorageKey(base: string, directory: string, primary: boolean): string {
  return primary || !directory ? base : `${base}:${directory}`
}

/**
 * The controllers of a multi-root window: one per workspace folder, all attached to the same server connection, with
 * exactly one bound to the chat view. Notifications, workers and background sessions of every folder keep running.
 *
 * No `vscode` import, so the add/remove/active/persist logic is unit-tested directly.
 */
export class FolderRegistry<C extends FolderController> {
  private readonly byDirectory = new Map<string, C>()
  /** OpenCode's name for each folder's project, keyed by the workspace path. Absent: the folder name shows. */
  private readonly projectNames = new Map<string, string>()
  private entries: FolderEntry[] = []
  private activeDirectory = ""
  private client?: OpenCodeClient
  private connectionState: ConnectionState = { status: "connecting" }
  private settings: ViewSettings = defaultViewSettings
  private voice?: AppState["voice"]
  private readonly activeListeners = new Set<() => void>()
  private readonly changeListeners = new Set<() => void>()
  private readonly nameListeners = new Set<() => void>()

  constructor(private readonly opts: FolderRegistryOptions<C>) {}

  /** The folder list changed: add controllers for new folders, drop the ones that left, pick a sane active folder. */
  sync(folders: readonly FolderEntry[]): void {
    const list = folders.length ? folders.map(({ directory, folderName, displayPath }) => ({ directory, folderName, displayPath })) : [PLACEHOLDER]
    const wanted = new Map(list.map((entry, index) => [entry.directory, { ...entry, primary: index === 0 }]))
    const nextEntries = folders.map(({ directory, folderName, displayPath }) => ({ directory, folderName, displayPath }))
    const entriesChanged = !sameEntries(this.entries, nextEntries)
    let controllersChanged = false

    for (const [directory, controller] of [...this.byDirectory]) {
      if (wanted.has(directory)) continue
      controller.detach()
      this.byDirectory.delete(directory)
      controllersChanged = true
    }
    this.entries = nextEntries
    const open = new Set(nextEntries.map((entry) => entry.directory))
    for (const directory of [...this.projectNames.keys()]) if (!open.has(directory)) this.projectNames.delete(directory)

    for (const [directory, entry] of wanted) {
      const existing = this.byDirectory.get(directory)
      if (existing) {
        // A rename or a different `~` shortening: same folder, same controller.
        existing.setFolderInfo(entry.folderName, entry.displayPath)
        continue
      }
      const controller = this.opts.make(entry)
      this.byDirectory.set(directory, controller)
      controller.setConnection(this.connection)
      controller.setSettings(this.settings)
      if (this.voice) controller.setVoice(this.voice)
      if (this.client) controller.attach(this.client)
      controllersChanged = true
    }

    const remembered = folders.length ? this.opts.remember?.get() : undefined
    const keep = new Set(wanted.keys())
    const next = folders.length === 0 ? "" : keep.has(this.activeDirectory) && this.activeDirectory ? this.activeDirectory : remembered && keep.has(remembered) ? remembered : list[0]!.directory
    const activeChanged = this.setActiveDirectory(next)
    if (activeChanged && next) this.opts.remember?.set(next)
    // Also for a folder that just joined: a new controller does not know yet whether it is the one on screen.
    this.applyActive()

    if (controllersChanged || entriesChanged) for (const listener of this.changeListeners) listener()
    if (activeChanged) for (const listener of this.activeListeners) listener()
  }

  /** The controller the chat view shows. Before `sync` this throws: the host always syncs first. */
  get active(): C {
    const controller = this.byDirectory.get(this.activeDirectory) ?? this.byDirectory.values().next().value
    if (!controller) throw new Error("The folder registry is empty; call sync() first.")
    return controller
  }

  /** The folder the view shows, or `""` when the window has no folder. */
  get activeDirectoryName(): string {
    return this.activeDirectory
  }

  /** Every controller, including the placeholder of a window without folders. */
  controllers(): C[] {
    return [...this.byDirectory.values()]
  }

  /** The workspace folders, without the no-folder placeholder. */
  directories(): string[] {
    return this.entries.map((entry) => entry.directory)
  }

  /** Switch the view to a folder. Returns false for an unknown folder. */
  setActive(directory: string): boolean {
    const key = this.resolve(directory)
    if (!key) return false
    const changed = this.setActiveDirectory(key)
    if (changed && key) this.opts.remember?.set(key)
    if (changed) {
      this.applyActive()
      for (const listener of this.activeListeners) listener()
    }
    return changed
  }

  /** The controller of one folder, or undefined when the window no longer shows it. */
  controllerAt(directory: string): C | undefined {
    const key = this.resolve(directory)
    return key ? this.byDirectory.get(key) : undefined
  }

  /**
   * The controller that lists a session. Used for notifications and links from another folder: the session's owner,
   * whatever folder the view shows now. With nested roots the deepest folder wins. Unknown sessions fall back to the
   * active folder.
   */
  forSession(id: string): C {
    let owner: C | undefined
    for (const controller of this.byDirectory.values()) {
      if (!controller.folderPath || !controller.listsSession(id)) continue
      if (!owner || controller.folderPath.length > owner.folderPath.length) owner = controller
    }
    return owner ?? this.active
  }

  /**
   * Show the folder that owns a session, then return its controller (a notification click switches folders). The
   * notice's `directory` is trusted first: a worker session this window has not listed yet still opens in its folder.
   */
  activateForSession(id: string, directory?: string): C {
    const controller = this.controllerAt(directory ?? "") ?? this.forSession(id)
    if (controller.folderPath) this.setActive(controller.folderPath)
    return controller
  }

  /**
   * The name OpenCode has for one folder's project. Empty or undefined falls back to the workspace folder name.
   * Listeners hear about it, so a rename in the browser UI or on the phone shows here without a reload.
   */
  setProjectName(directory: string, name: string | undefined): void {
    const key = this.resolve(directory)
    if (!key) return
    const next = name?.trim() || undefined
    const previous = this.projectNames.get(key)
    if (previous === next) return
    if (next) this.projectNames.set(key, next)
    else this.projectNames.delete(key)
    for (const listener of this.nameListeners) listener()
  }

  /** OpenCode's name for a folder's project, or undefined when it has none. */
  projectName(directory: string): string | undefined {
    const key = this.resolve(directory)
    return key ? this.projectNames.get(key) : undefined
  }

  /** The folder list for the UI. Empty for a window without folders; the dropdown only appears with two or more. */
  foldersState(): FolderInfo[] {
    return this.entries.map((entry) => {
      const controller = this.byDirectory.get(entry.directory)
      return {
        directory: entry.directory,
        name: entry.folderName,
        projectName: this.projectNames.get(entry.directory),
        displayPath: entry.displayPath,
        active: entry.directory === this.activeDirectory,
        busy: controller?.isBusy() ?? false,
        attention: controller?.isWaiting() ?? false,
      }
    })
  }

  /** One server connection serves every folder: attach the same client to all of them. */
  attach(client: OpenCodeClient): void {
    this.client = client
    for (const controller of this.byDirectory.values()) controller.attach(client)
  }

  /** Drop the connection everywhere. The controllers stay, so a reconnect reuses them. */
  detach(): void {
    this.client = undefined
    for (const controller of this.byDirectory.values()) controller.detach()
  }

  get connection(): ConnectionState {
    return this.connectionState
  }

  get connectedClient(): OpenCodeClient | undefined {
    return this.client
  }

  /** Connection state is a property of the window, not of one folder: every folder's controller shows the same. */
  setConnection(connection: ConnectionState): void {
    this.connectionState = connection
    for (const controller of this.byDirectory.values()) controller.setConnection(connection)
  }

  setSettings(settings: ViewSettings): void {
    this.settings = settings
    for (const controller of this.byDirectory.values()) controller.setSettings(settings)
  }

  setVoice(voice: AppState["voice"]): void {
    this.voice = voice
    for (const controller of this.byDirectory.values()) controller.setVoice(voice)
  }

  /** The folder list or the set of controllers changed (terminals follow new folders). */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  /** The view was switched to another folder. */
  onActive(listener: () => void): () => void {
    this.activeListeners.add(listener)
    return () => this.activeListeners.delete(listener)
  }

  /** A folder's OpenCode project name was set, cleared or changed. */
  onProjectNames(listener: () => void): () => void {
    this.nameListeners.add(listener)
    return () => this.nameListeners.delete(listener)
  }

  dispose(): void {
    this.detach()
    this.byDirectory.clear()
    this.projectNames.clear()
    this.entries = []
    this.activeDirectory = ""
    this.activeListeners.clear()
    this.changeListeners.clear()
    this.nameListeners.clear()
  }

  private setActiveDirectory(directory: string): boolean {
    if (directory === this.activeDirectory) return false
    this.activeDirectory = directory
    return true
  }

  /** Tell every controller whether it is the folder on screen. */
  private applyActive(): void {
    for (const [directory, controller] of this.byDirectory) controller.setActive(directory === this.activeDirectory)
  }

  /**
   * The stored key for a folder path, matching the server's spelling too (`sameDirectory`). With nested roots the
   * deepest folder wins, so `…/app/packages/ui` does not resolve to `…/app`.
   */
  private resolve(directory: string): string | undefined {
    if (!directory) return undefined
    if (this.byDirectory.has(directory)) return directory
    let best: string | undefined
    for (const candidate of this.byDirectory.keys()) {
      if (!candidate || !sameDirectory(candidate, directory)) continue
      if (!best || candidate.length > best.length) best = candidate
    }
    return best
  }
}

/** The folder list is unchanged: same paths and the same labels, in the same order. */
function sameEntries(a: readonly FolderEntry[], b: readonly FolderEntry[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry.directory === b[i]!.directory && entry.folderName === b[i]!.folderName && entry.displayPath === b[i]!.displayPath)
}

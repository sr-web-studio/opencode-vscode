/**
 * The open projects of one connected server: one live controller per project, created when a screen of the project
 * opens and disposed when the last one closes. Generic over the controller type so tests use a fake.
 */
import type { OpenCodeClient } from "@occ/core/api"

export type ProjectInfo = { directory: string; folderName: string; displayPath: string }

export type Lifecycle = {
  attach(client: OpenCodeClient): void
  detach(): void
  reconnect(opts?: { quiet?: boolean }): void
  /** The project's chat is on screen (or is not): a turn that ends while it is on screen is seen as it lands. */
  setVisible(visible: boolean): void
}

export class Workspace<C extends Lifecycle> {
  private readonly open = new Map<string, C>()
  private disposed = false

  constructor(
    readonly client: OpenCodeClient,
    private readonly make: (project: ProjectInfo) => C,
  ) {}

  /** The project's controller, created and attached on first use. */
  acquire(project: ProjectInfo): C {
    if (this.disposed) throw new Error("This server connection is closed.")
    let c = this.open.get(project.directory)
    if (!c) {
      c = this.make(project)
      this.open.set(project.directory, c)
      c.attach(this.client)
    }
    return c
  }

  get(directory: string): C | undefined {
    return this.open.get(directory)
  }

  get directories(): string[] {
    return [...this.open.keys()]
  }

  /** Dispose every controller whose folder is not in `keep`. Returns the folders that were closed. */
  keepOnly(keep: ReadonlySet<string>): string[] {
    const closed: string[] = []
    for (const [dir, c] of this.open) {
      if (keep.has(dir)) continue
      c.detach()
      this.open.delete(dir)
      closed.push(dir)
    }
    return closed
  }

  /**
   * The app is in the foreground again: every open project reconnects its event stream and resyncs. Quietly: the
   * stream was suspended in the background, so the drop is expected and the screens keep showing the last state for a
   * few seconds instead of "Connection lost".
   */
  resume(): void {
    for (const c of this.open.values()) c.reconnect({ quiet: true })
  }

  /**
   * Only one chat can be on screen: `directory` names it, or undefined when no chat is (the drawer, another screen,
   * the app in the background). Every other project is told it is off screen, so a turn ending there stays unread.
   */
  showOnScreen(directory: string | undefined): void {
    for (const [dir, c] of this.open) c.setVisible(dir === directory)
  }

  dispose(): void {
    this.disposed = true
    for (const c of this.open.values()) c.detach()
    this.open.clear()
  }
}

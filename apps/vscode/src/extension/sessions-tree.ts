import * as vscode from "vscode"
import type { Controller } from "@occ/core/controller"
import type { ActivityState } from "@occ/core/activity-order"
import type { FolderRegistry } from "@occ/core/folders"
import { buildTree, type FolderInput, type ProjectNode, type SessionNode, type TreeLayout } from "./sessions-tree-model"

/** The primary-sidebar view. `opencode.chat` is the secondary-sidebar webview; this one lists sessions. */
export const SESSIONS_VIEW_ID = "opencode.sessions"

/** Busy folders can emit many times a second; the tree only needs a few redraws per second. */
const THROTTLE_MS = 200

export type SessionsNode = ProjectNode | SessionNode

/** What a session row's command needs: the session and the folder that owns it. */
export type SessionTarget = { sessionID: string; directory?: string }

/**
 * A tree item element, or the explicit `{ sessionID, directory }` argument a command can receive. A context-menu
 * command gets the node itself; the row's click passes the plain target.
 */
export function sessionTarget(arg: unknown): SessionTarget | undefined {
  if (!arg || typeof arg !== "object") return undefined
  const value = arg as { sessionID?: unknown; id?: unknown; kind?: unknown; directory?: unknown }
  const sessionID = typeof value.sessionID === "string" ? value.sessionID : value.kind === "session" && typeof value.id === "string" ? value.id : undefined
  if (!sessionID) return undefined
  return { sessionID, directory: typeof value.directory === "string" ? value.directory : undefined }
}

/** The folder a project node (or an explicit path) names, for commands that act on one folder. */
export function directoryArg(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg || undefined
  if (!arg || typeof arg !== "object") return undefined
  const value = arg as { directory?: unknown }
  return typeof value.directory === "string" && value.directory ? value.directory : undefined
}

/**
 * The sessions sidebar: one flat list in a single-folder window, one node per folder in a multi-root window.
 *
 * It reads only the registry and the controllers the extension already keeps attached, so opening or refreshing the
 * view never calls the server. Every controller's `subscribe` (throttled) redraws the tree; the active session of the
 * active folder is revealed without taking focus when the view is on screen.
 */
export class SessionsTreeProvider implements vscode.TreeDataProvider<SessionsNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<SessionsNode | undefined>()
  readonly onDidChangeTreeData = this.changed.event
  /** One state stream per folder, keyed by the stable workspace path. */
  private readonly subscriptions = new Map<string, () => void>()
  private timer?: ReturnType<typeof setTimeout>
  private model?: TreeLayout
  private inputs: FolderInput[] = []
  private view?: vscode.TreeView<SessionsNode>
  /** The user's own expand/collapse choice per project, so a redraw does not reopen what they closed. */
  private readonly expanded = new Map<string, boolean>()
  private viewSubscriptions: vscode.Disposable[] = []
  /** The session the chat showed last, so a reveal only happens on a real change. */
  private lastCurrent?: string
  private pendingReveal?: string
  private readonly offActive: () => void
  private readonly offChange: () => void
  private readonly offNames: () => void

  constructor(private readonly folders: FolderRegistry<Controller>) {
    this.offActive = folders.onActive(() => this.activeChanged())
    this.offChange = folders.onChange(() => {
      this.watch()
      this.schedule()
    })
    this.offNames = folders.onProjectNames(() => this.schedule())
    this.watch()
  }

  /** The extension gives the provider the view it drives (message, reveal, visibility). */
  attach(view: vscode.TreeView<SessionsNode>): void {
    this.view = view
    this.lastCurrent = this.folders.active.currentSessionID
    this.viewSubscriptions = [
      view.onDidExpandElement((event) => {
        if (event.element.kind === "project") this.expanded.set(event.element.directory, true)
      }),
      view.onDidCollapseElement((event) => {
        if (event.element.kind === "project") this.expanded.set(event.element.directory, false)
      }),
    ]
  }

  /** `OpenCode: Refresh Sessions`: redraw from the state already in memory, never a server call. */
  refresh(): void {
    this.watch()
    this.fire()
  }

  getChildren(element?: SessionsNode): SessionsNode[] {
    const layout = this.layout()
    if (!element) {
      if (layout.kind === "sessions") return layout.sessions
      if (layout.kind === "projects") return layout.projects
      return []
    }
    if (element.kind === "project" && layout.kind === "projects") {
      return layout.projects.find((project) => project.directory === element.directory)?.sessions ?? element.sessions
    }
    return []
  }

  getParent(element: SessionsNode): SessionsNode | undefined {
    if (element.kind === "project") return undefined
    const layout = this.layout()
    if (layout.kind !== "projects") return undefined
    return layout.projects.find((project) => project.directory === element.directory)
  }

  getTreeItem(element: SessionsNode): vscode.TreeItem {
    return element.kind === "session" ? this.sessionItem(element) : this.projectItem(element)
  }

  /** The line under the tree when there is nothing to show, or a reason it is empty. */
  message(): string | undefined {
    const layout = this.layout()
    if (layout.kind === "empty") return "Open a folder to see its OpenCode sessions."
    const connection = this.folders.connection
    if (connection.status === "connecting") return "Connecting to OpenCode…"
    if (connection.status === "setup") return connection.message ?? "OpenCode needs setup."
    if (connection.status === "error" || connection.status === "disconnected") return "OpenCode is not reachable. Run OpenCode: Reconnect when the server is back."
    const empty = layout.kind === "sessions" ? layout.sessions.length === 0 : layout.kind === "projects" ? layout.projects.every((project) => project.sessions.length === 0) : true
    if (!empty) return undefined
    if (this.inputs.some((input) => !input.loaded)) return "Loading sessions…"
    return "No sessions yet. Start one with +."
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    for (const off of this.subscriptions.values()) off()
    this.subscriptions.clear()
    for (const disposable of this.viewSubscriptions) disposable.dispose()
    this.viewSubscriptions = []
    this.offActive()
    this.offChange()
    this.offNames()
    this.changed.dispose()
  }

  private sessionItem(element: SessionNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.None)
    item.id = `session:${element.id}`
    item.description = element.current ? `● ${element.description}` : element.description
    item.tooltip = [element.title, STATE_LABEL[element.state], fullTime(element.updated), element.current ? "Current session" : undefined].filter(Boolean).join("\n")
    item.iconPath = statusIcon(element.state, "session")
    item.contextValue = "session"
    item.accessibilityInformation = {
      label: [element.title, STATE_LABEL[element.state], element.description, element.current ? "current session" : undefined].filter(Boolean).join(", "),
    }
    item.command = { command: "opencode.sessions.open", title: "Open Session", arguments: [{ sessionID: element.id, directory: element.directory }] }
    return item
  }

  private projectItem(element: ProjectNode): vscode.TreeItem {
    const expanded = this.expanded.get(element.directory) ?? element.expanded
    const item = new vscode.TreeItem(element.name, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
    item.id = `project:${element.directory}`
    item.description = element.displayPath
    const last = element.last ? fullTime(element.last) : undefined
    item.tooltip = [element.name, element.displayPath, STATE_LABEL[element.state], last].filter(Boolean).join("\n")
    item.iconPath = statusIcon(element.state, "project")
    item.contextValue = "project"
    item.accessibilityInformation = { label: [element.name, element.displayPath, STATE_LABEL[element.state]].filter(Boolean).join(", ") }
    return item
  }

  /** Keep exactly one state stream per open folder. */
  private watch(): void {
    const open = new Set<string>()
    for (const controller of this.folders.controllers()) {
      const path = controller.folderPath
      if (!path) continue
      open.add(path)
      if (this.subscriptions.has(path)) continue
      this.subscriptions.set(
        path,
        controller.subscribe(() => this.controllerChanged(controller)),
      )
    }
    for (const [path, off] of [...this.subscriptions]) {
      if (open.has(path)) continue
      off()
      this.subscriptions.delete(path)
    }
  }

  private controllerChanged(controller: Controller): void {
    this.schedule()
    if (controller.folderPath !== this.folders.active.folderPath) return
    const id = controller.currentSessionID
    if (!id || id === this.lastCurrent) return
    this.lastCurrent = id
    if (this.view?.visible) this.pendingReveal = id
  }

  private activeChanged(): void {
    const id = this.folders.active.currentSessionID
    this.lastCurrent = id
    if (id && this.view?.visible) this.pendingReveal = id
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.fire()
    }, THROTTLE_MS)
  }

  private fire(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.model = undefined
    this.changed.fire(undefined)
    const id = this.pendingReveal
    this.pendingReveal = undefined
    if (id) void this.reveal(id)
  }

  private async reveal(sessionID: string): Promise<void> {
    const view = this.view
    if (!view?.visible) return
    const layout = this.layout()
    const nodes = layout.kind === "sessions" ? layout.sessions : layout.kind === "projects" ? layout.projects.flatMap((project) => project.sessions) : []
    const node = nodes.find((session) => session.id === sessionID)
    if (!node) return
    try {
      await view.reveal(node, { select: true, focus: false })
    } catch {
      // The row can be gone by the time the redraw lands; the next change reveals it.
    }
  }

  private layout(): TreeLayout {
    if (this.model) return this.model
    this.inputs = this.folders.foldersState().map((folder): FolderInput => {
      const controller = this.folders.controllerAt(folder.directory)
      const state = controller?.snapshot()
      return {
        directory: folder.directory,
        name: folder.name,
        projectName: folder.projectName,
        displayPath: folder.displayPath,
        active: folder.active,
        sessions: state?.sessions ?? [],
        running: new Set(state?.running ?? []),
        waiting: new Set(state?.waiting ?? []),
        currentID: controller?.currentSessionID,
        loaded: state?.sessionsLoaded ?? false,
      }
    })
    this.model = buildTree(this.inputs, Date.now())
    return this.model
  }
}

const STATE_LABEL: Record<ActivityState, string> = { waiting: "Waiting for you", running: "Running", idle: "Idle" }

/** Status is readable without color: the tooltip and the accessibility label both name the state. */
function statusIcon(state: ActivityState, kind: "session" | "project"): vscode.ThemeIcon {
  if (state === "waiting") return new vscode.ThemeIcon("bell-dot", new vscode.ThemeColor("notificationsWarningIcon.foreground"))
  if (state === "running") return new vscode.ThemeIcon("loading~spin")
  return new vscode.ThemeIcon(kind === "project" ? "folder" : "comment-discussion")
}

function fullTime(ms: number): string {
  return new Date(ms).toLocaleString()
}

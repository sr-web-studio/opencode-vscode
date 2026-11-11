import * as vscode from "vscode"
import type { Controller } from "@occ/core/controller"
import type { FolderRegistry } from "@occ/core/folders"
import type { AppState, FolderSessions, ToHost, ToWebview, WebviewMetrics } from "@occ/core/protocol"
import { diffState } from "@occ/core/state-post"
import type { HostActions, Surface } from "./host"
import type { MinWidth } from "./min-width"
import { webviewHtml } from "./html"

export const VIEW_ID = "opencode.chat"

/** Non-active folders can emit at ~33 Hz; the dropdown only needs a few updates per second. */
const FOLDERS_THROTTLE_MS = 200
/** The sessions pane's dots and rows do not need 5 Hz: its per-folder lists are recomputed at most twice a second. */
const SESSIONS_THROTTLE_MS = 500

/**
 * The chat panel. It follows the active workspace folder's controller and forwards state to the webview; a
 * `switchFolder` action rebinds it to another folder. Every folder's controller keeps running in the background.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView
  private unsubscribe?: () => void
  /** State streams of the folders the view is not showing, so the dropdown's busy/attention dots stay live. */
  private readonly others = new Map<string, () => void>()
  private foldersTimer?: ReturnType<typeof setTimeout>
  /** The sessions pane's per-folder list is throttled on its own, so a busy folder cannot flood the webview. */
  private sessionsTimer?: ReturnType<typeof setTimeout>
  /** The last state posted to the webview, so the next one can be a patch instead of the whole thing. */
  private lastState?: AppState
  private readonly subs: vscode.Disposable[] = []
  private readonly offActive: () => void
  private readonly offChange: () => void
  private readonly offNames: () => void

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly folders: FolderRegistry<Controller>,
    private readonly host: HostActions,
    private readonly minWidth: MinWidth,
  ) {
    this.offActive = folders.onActive(() => this.bind())
    this.offChange = folders.onChange(() => this.bind())
    // A project name changed (our own rename, the browser UI or the phone): only the labels change, no rebind.
    this.offNames = folders.onProjectNames(() => this.postState())
  }

  /** True when the panel is on screen. Used for notification suppression. */
  get visible(): boolean {
    return this.view?.visible === true
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    this.minWidth.noteVisible(view.visible)
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")] }
    view.webview.html = webviewHtml(view.webview, this.extensionUri)

    this.bind()
    this.subs.push(
      view.webview.onDidReceiveMessage((m: ToHost | WebviewMetrics) => void this.onMessage(m)),
      view.onDidChangeVisibility(() => {
        this.minWidth.noteVisible(view.visible)
        this.syncVisible()
        // A view that was hidden has no live DOM: resend state when it comes back.
        if (view.visible) void this.folders.active.dispatch({ type: "ready" })
      }),
      view.onDidDispose(() => {
        this.minWidth.noteVisible(false)
        this.unsubscribe?.()
        this.unsubscribe = undefined
        this.clearOthers()
        this.view = undefined
        // No view: no folder is on screen, so no turn ends "seen".
        this.syncVisible()
      }),
    )
  }

  post(message: ToWebview): void {
    void this.view?.webview.postMessage(message)
  }

  /** `+` from the view title or command palette. The webview knows whether its draft has text. */
  newSession(): void {
    if (this.view) this.post({ type: "command", name: "newSession" })
    else this.folders.active.newDraft(false)
  }

  /** The title-bar button: the webview owns whether its pane is open and remembers it. */
  toggleSessions(): void {
    if (this.view) this.post({ type: "command", name: "toggleSessions" })
  }

  private bind(): void {
    this.unsubscribe?.()
    // Another folder's state is not a continuation of the one on screen: the first post after a switch is a full one.
    this.lastState = undefined
    this.unsubscribe = this.folders.active.subscribe((state) => {
      this.postState(state)
      this.scheduleFolderSessions()
    })
    this.watchOthers()
    // The pane's per-folder lists are not part of the click: the transcript request goes first, the pane fills after.
    this.scheduleFolderSessions()
    this.syncVisible()
  }

  /**
   * Tell the controllers which of them is on screen. Only the active folder's chat can be looked at; a turn that ends
   * in a background folder stays "New reply" until the user switches there or opens it.
   */
  private syncVisible(): void {
    const active = this.folders.active
    // A hidden view keeps no live DOM: the next state it gets must be a full one.
    if (!this.visible) this.lastState = undefined
    for (const controller of this.folders.controllers()) controller.setVisible(controller === active && this.visible)
  }

  /** Every folder but the active one: a change there only refreshes the dropdown (busy/attention dots). */
  private watchOthers(): void {
    const active = this.folders.active.folderPath
    const open = new Set(this.folders.directories())
    for (const [path, off] of [...this.others]) {
      if (open.has(path) && path !== active) continue
      off()
      this.others.delete(path)
    }
    for (const controller of this.folders.controllers()) {
      // The workspace path, not `controller.directory`: a server sync can respell the latter and duplicate the stream.
      const path = controller.folderPath
      if (!path || path === active || this.others.has(path)) continue
      this.others.set(
        path,
        controller.subscribe(() => {
          this.postFolders()
          this.scheduleFolderSessions()
        }),
      )
    }
  }

  /** A light folder-list update: no controller snapshots, throttled so a busy background folder cannot flood the view. */
  private postFolders(): void {
    if (!this.visible) return
    if (this.foldersTimer) return
    this.foldersTimer = setTimeout(() => {
      this.foldersTimer = undefined
      const list = this.folders.foldersState()
      if (list.length > 1) this.post({ type: "folders", folders: list })
    }, FOLDERS_THROTTLE_MS)
  }

  private scheduleFolderSessions(): void {
    if (this.sessionsTimer) return
    this.sessionsTimer = setTimeout(() => {
      this.sessionsTimer = undefined
      this.postFolderSessions()
    }, SESSIONS_THROTTLE_MS)
  }

  /**
   * The sessions pane needs every folder's root sessions, not only the active one's `AppState`. It is a separate,
   * light message so the main state stays small; the controllers already hold the lists, so this never asks the server.
   */
  private postFolderSessions(): void {
    if (!this.visible) return
    const list = this.folders.foldersState()
    if (list.length <= 1) return
    const folders: FolderSessions[] = list.map((folder) => {
      const controller = this.folders.controllerAt(folder.directory)
      // The light summary, not the whole snapshot: this runs for every folder on every refresh.
      const summary = controller?.folderSessions()
      return {
        directory: folder.directory,
        sessions: summary?.sessions ?? [],
        running: summary?.running ?? [],
        waiting: summary?.waiting ?? [],
        workerRunning: summary?.workerRunning ?? {},
        loaded: summary?.loaded ?? false,
      }
    })
    this.post({ type: "folderSessions", folders })
  }

  /**
   * The folder list is a property of the window, so it is added here to whichever controller's state is posted.
   * Only what changed since the last post is sent: a streaming delta is a few kilobytes, not the whole state.
   */
  private postState(state: AppState = this.folders.active.snapshot()): void {
    // A hidden view has no live DOM, so a post would only queue up work for nothing. Coming back resends everything.
    if (!this.visible) {
      this.lastState = undefined
      return
    }
    const decorated = this.decorate(state)
    const prev = this.lastState
    this.lastState = decorated
    if (!prev) {
      this.post({ type: "state", state: decorated })
      return
    }
    const patch = diffState(prev, decorated)
    if (patch) this.post({ type: "statePatch", patch })
  }

  /** Add the window-level parts of the state (the folder list and the active folder's project name). */
  private decorate(state: AppState): AppState {
    const list = this.folders.foldersState()
    const projectName = this.folders.projectName(this.folders.active.folderPath)
    const decorated: AppState = list.length > 1 ? { ...state, folders: list } : state
    return projectName ? { ...decorated, projectName } : decorated
  }

  private async onMessage(m: ToHost | WebviewMetrics): Promise<void> {
    if (m.type === "viewMetrics") {
      this.minWidth.metrics(m)
      return
    }
    if (m.type === "action") {
      // The registry owns the folder switch; a Controller knows nothing about the window's other folders.
      if (m.action.type === "switchFolder") this.folders.setActive(m.action.directory)
      else {
        // `ready`: the webview has no state (a fresh or reloaded view) or lost track of it, so the next post is full.
        if (m.action.type === "ready") this.lastState = undefined
        await this.folders.active.dispatch(m.action)
      }
      return
    }
    // The sessions pane's refresh: re-post what the controllers already hold, never a server call.
    if (m.request.type === "refreshSessions") {
      this.postState()
      this.postFolderSessions()
      return
    }
    // A session of any folder: switch the chat to its folder first, like a notification click does.
    if (m.request.type === "openSessionInFolder") {
      const controller = this.folders.activateForSession(m.request.sessionID, m.request.directory)
      await controller.open(m.request.sessionID)
      return
    }
    // A session row's pencil: rename it where it lives, so a row that moved folders meanwhile cannot rename another
    // session (the old switch-then-rename pair could land on whatever the chat had opened in the meantime).
    if (m.request.type === "renameSession") {
      const controller = this.folders.controllerAt(m.request.directory) ?? this.folders.forSession(m.request.sessionID)
      await controller.dispatch({ type: "rename", id: m.request.sessionID, title: m.request.title })
      return
    }
    // A project header's `+`: show that folder first, so the new draft lands there and not in the folder the chat had.
    if (m.request.type === "newSessionIn") {
      const controller = this.folders.controllerAt(m.request.directory)
      if (controller) {
        this.folders.setActive(controller.folderPath)
        await controller.dispatch({ type: "newDraft", hasText: false })
      }
      return
    }
    await this.host.handle(m.request, this.surfaceFor(this.folders.active))
  }

  /** Bind the host's effects to the controller that was active when the request arrived (a modal can outlive a switch). */
  private surfaceFor(controller: Controller): Surface {
    return {
      post: (message) => this.post(message),
      act: (action) => void controller.dispatch(action),
      sessionID: () => controller.currentSessionID,
      directory: () => controller.directory,
    }
  }

  dispose(): void {
    this.unsubscribe?.()
    this.clearOthers()
    if (this.foldersTimer) clearTimeout(this.foldersTimer)
    this.foldersTimer = undefined
    if (this.sessionsTimer) clearTimeout(this.sessionsTimer)
    this.sessionsTimer = undefined
    this.offActive()
    this.offChange()
    this.offNames()
    for (const d of this.subs) d.dispose()
  }

  private clearOthers(): void {
    for (const off of this.others.values()) off()
    this.others.clear()
  }
}

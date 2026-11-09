import * as vscode from "vscode"
import type { Controller } from "@occ/core/controller"
import type { FolderRegistry } from "@occ/core/folders"
import type { AppState, ToHost, ToWebview, WebviewMetrics } from "@occ/core/protocol"
import type { HostActions, Surface } from "./host"
import type { MinWidth } from "./min-width"
import { webviewHtml } from "./html"

export const VIEW_ID = "opencode.chat"

/** Non-active folders can emit at ~33 Hz; the dropdown only needs a few updates per second. */
const FOLDERS_THROTTLE_MS = 200

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
        // A view that was hidden has no live DOM: resend state when it comes back.
        if (view.visible) void this.folders.active.dispatch({ type: "ready" })
      }),
      view.onDidDispose(() => {
        this.minWidth.noteVisible(false)
        this.unsubscribe?.()
        this.unsubscribe = undefined
        this.clearOthers()
        this.view = undefined
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

  private bind(): void {
    this.unsubscribe?.()
    this.unsubscribe = this.folders.active.subscribe((state) => this.postState(state))
    this.watchOthers()
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
        controller.subscribe(() => this.postFolders()),
      )
    }
  }

  /** A light folder-list update: no controller snapshots, throttled so a busy background folder cannot flood the view. */
  private postFolders(): void {
    if (this.foldersTimer) return
    this.foldersTimer = setTimeout(() => {
      this.foldersTimer = undefined
      const list = this.folders.foldersState()
      if (list.length > 1) this.post({ type: "folders", folders: list })
    }, FOLDERS_THROTTLE_MS)
  }

  /** The folder list is a property of the window, so it is added here to whichever controller's state is posted. */
  private postState(state: AppState = this.folders.active.snapshot()): void {
    const list = this.folders.foldersState()
    const projectName = this.folders.projectName(this.folders.active.folderPath)
    const decorated: AppState = list.length > 1 ? { ...state, folders: list } : state
    this.post({ type: "state", state: projectName ? { ...decorated, projectName } : decorated })
  }

  private async onMessage(m: ToHost | WebviewMetrics): Promise<void> {
    if (m.type === "viewMetrics") {
      this.minWidth.metrics(m)
      return
    }
    if (m.type === "action") {
      // The registry owns the folder switch; a Controller knows nothing about the window's other folders.
      if (m.action.type === "switchFolder") this.folders.setActive(m.action.directory)
      else await this.folders.active.dispatch(m.action)
    } else await this.host.handle(m.request, this.surfaceFor(this.folders.active))
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

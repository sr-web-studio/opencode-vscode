import * as vscode from "vscode"
import type { Controller } from "@occ/core/controller"
import type { FolderRegistry } from "@occ/core/folders"
import type { AppState, ToHost, ToWebview } from "@occ/core/protocol"
import type { HostActions, Surface } from "./host"
import { webviewHtml } from "./html"

export const VIEW_ID = "opencode.chat"

/**
 * The chat panel. It follows the active workspace folder's controller and forwards state to the webview; a
 * `switchFolder` action rebinds it to another folder. Every folder's controller keeps running in the background.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView
  private unsubscribe?: () => void
  /** State streams of the folders the view is not showing, so the dropdown's busy/attention dots stay live. */
  private readonly others = new Map<string, () => void>()
  private readonly subs: vscode.Disposable[] = []
  private readonly offActive: () => void
  private readonly offChange: () => void

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly folders: FolderRegistry<Controller>,
    private readonly host: HostActions,
  ) {
    this.offActive = folders.onActive(() => this.bind())
    this.offChange = folders.onChange(() => this.bind())
  }

  /** True when the panel is on screen. Used for notification suppression. */
  get visible(): boolean {
    return this.view?.visible === true
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")] }
    view.webview.html = webviewHtml(view.webview, this.extensionUri)

    this.bind()
    this.subs.push(
      view.webview.onDidReceiveMessage((m: ToHost) => void this.onMessage(m)),
      view.onDidChangeVisibility(() => {
        // A view that was hidden has no live DOM: resend state when it comes back.
        if (view.visible) void this.folders.active.dispatch({ type: "ready" })
      }),
      view.onDidDispose(() => {
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
    const active = this.folders.active.directory
    const open = new Set(this.folders.directories())
    for (const [directory, off] of [...this.others]) {
      if (open.has(directory) && directory !== active) continue
      off()
      this.others.delete(directory)
    }
    for (const controller of this.folders.controllers()) {
      if (!controller.directory || controller.directory === active || this.others.has(controller.directory)) continue
      this.others.set(
        controller.directory,
        controller.subscribe(() => this.postState()),
      )
    }
  }

  /** The folder list is a property of the window, so it is added here to whichever controller's state is posted. */
  private postState(state: AppState = this.folders.active.snapshot()): void {
    const list = this.folders.foldersState()
    this.post({ type: "state", state: list.length > 1 ? { ...state, folders: list } : state })
  }

  private async onMessage(m: ToHost): Promise<void> {
    if (m.type === "action") {
      // The registry owns the folder switch; a Controller knows nothing about the window's other folders.
      if (m.action.type === "switchFolder") this.folders.setActive(m.action.directory)
      else await this.folders.active.dispatch(m.action)
    } else await this.host.handle(m.request, this.surface)
  }

  private readonly surface: Surface = {
    post: (message) => this.post(message),
    act: (action) => void this.folders.active.dispatch(action),
    sessionID: () => this.folders.active.currentSessionID,
    directory: () => this.folders.active.directory,
  }

  dispose(): void {
    this.unsubscribe?.()
    this.clearOthers()
    this.offActive()
    this.offChange()
    for (const d of this.subs) d.dispose()
  }

  private clearOthers(): void {
    for (const off of this.others.values()) off()
    this.others.clear()
  }
}

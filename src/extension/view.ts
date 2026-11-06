import * as vscode from "vscode"
import type { Controller } from "../core/controller"
import type { ToHost, ToWebview } from "../core/protocol"
import type { HostActions } from "./host"
import { webviewHtml } from "./html"

export const VIEW_ID = "opencode.chat"

/** The chat panel. It forwards state to the webview and user actions back to the controller. */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView
  private unsubscribe?: () => void
  private readonly subs: vscode.Disposable[] = []

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: Controller,
    private readonly host: HostActions,
  ) {}

  /** True when the panel is on screen. Used for notification suppression. */
  get visible(): boolean {
    return this.view?.visible === true
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")] }
    view.webview.html = webviewHtml(view.webview, this.extensionUri)

    this.unsubscribe?.()
    this.unsubscribe = this.controller.subscribe((state) => this.post({ type: "state", state }))

    this.subs.push(
      view.webview.onDidReceiveMessage((m: ToHost) => void this.onMessage(m)),
      view.onDidChangeVisibility(() => {
        // A view that was hidden has no live DOM: resend state when it comes back.
        if (view.visible) void this.controller.dispatch({ type: "ready" })
      }),
      view.onDidDispose(() => {
        this.unsubscribe?.()
        this.unsubscribe = undefined
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
    else this.controller.newDraft(false)
  }

  private async onMessage(m: ToHost): Promise<void> {
    if (m.type === "action") await this.controller.dispatch(m.action)
    else if (m.type === "host") await this.host.handle(m.request)
  }

  dispose(): void {
    this.unsubscribe?.()
    for (const d of this.subs) d.dispose()
  }
}

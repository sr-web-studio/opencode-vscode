import * as vscode from "vscode"
import type { Controller } from "@occ/core/controller"
import type { Action, ToHost, ToWebview } from "@occ/core/protocol"
import { WorkerTab } from "@occ/core/worker-tab"
import type { HostActions } from "./host"
import { webviewHtml } from "./html"

type Open = { tab: WorkerTab; panel: vscode.WebviewPanel }

/**
 * Worker tabs: a child session opened as a read-only editor tab (`openSession(id, { readOnly: true })`).
 * Opening the same worker again reveals its tab. Creating a tab never takes focus from the editor you are typing in
 * beyond what opening a tab means: it is always the result of a click.
 */
export class WorkerPanels implements vscode.Disposable {
  private readonly open_ = new Map<string, Open>()

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: Controller,
    private readonly host: () => HostActions,
  ) {}

  async open(sessionID: string, readOnly: boolean): Promise<void> {
    if (!readOnly) {
      // Writable sessions open in the chat view.
      await this.controller.open(sessionID)
      return
    }
    const existing = this.open_.get(sessionID)
    if (existing) {
      existing.panel.reveal(undefined, false)
      return
    }
    const tab = new WorkerTab(this.controller, sessionID)
    const panel = vscode.window.createWebviewPanel("opencode.worker", "Worker", this.column(), {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
    })
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "opencode.svg")
    panel.webview.html = webviewHtml(panel.webview, this.extensionUri)
    const post = (message: ToWebview) => void panel.webview.postMessage(message)

    const off = tab.subscribe((state) => {
      post({ type: "state", state })
      if (panel.title !== tab.title) panel.title = tab.title
    })
    const sub = panel.webview.onDidReceiveMessage(async (m: ToHost) => {
      if (m.type === "action") await tab.dispatch(m.action as Action)
      else if (m.type === "host") await this.host().handle(m.request, { post, act: () => undefined, sessionID: () => sessionID })
    })
    panel.onDidDispose(() => {
      off()
      sub.dispose()
      tab.dispose()
      this.open_.delete(sessionID)
    })
    this.open_.set(sessionID, { tab, panel })
    await tab.start()
  }

  /**
   * Worker tabs share one editor group: the group of the most recently opened worker tab that is still open, so a new
   * worker becomes another tab there instead of splitting the editor again. The first one opens beside the editor.
   */
  private column(): vscode.ViewColumn {
    const open = [...this.open_.values()].reverse()
    return open.find((o) => o.panel.viewColumn !== undefined)?.panel.viewColumn ?? vscode.ViewColumn.Beside
  }

  dispose(): void {
    for (const { panel } of [...this.open_.values()]) panel.dispose()
    this.open_.clear()
  }
}

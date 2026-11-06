import * as vscode from "vscode"
import { mimeFromName } from "../core/attachments"
import { isAbsolutePath } from "../core/paths"
import type { HostRequest, PickedFile, ToWebview } from "../core/protocol"
import type { WorkerPanels } from "./workers"
import type { ShellTerminals } from "./terminal"
import type { ImagePreviews } from "./images"
import type { DiffViews } from "./diffs"

const REVERT_PROMPT =
  "Revert to before this prompt? Messages after it are hidden, and files changed by later steps are restored. Shell side effects (git, databases, other files) are not undone."

/** What a webview (the chat view or a worker tab) lets the host do on its behalf. */
export type Surface = {
  /** Tell the webview something (picked files). */
  post(message: ToWebview): void
  /** Run a chat action (confirmed revert). Worker tabs ignore it. */
  act(action: { type: "revert"; messageID: string }): void
  /** The session the surface shows, for shell location lookups. */
  sessionID(): string | undefined
}

/** Host-side effects the webview asks for. Everything here needs `vscode`, so it cannot live in core/ or ui/. */
export class HostActions {
  constructor(
    private readonly directory: string,
    private readonly terminals: () => ShellTerminals,
    private readonly workers: () => WorkerPanels,
    private readonly images: () => ImagePreviews,
    private readonly diffs: () => DiffViews,
  ) {}

  /** Used by the diff views to find a file of the project. */
  resolvePath = (path: string): vscode.Uri => this.resolve(path)

  /** Run a request from a webview. A failure is shown to the user; it never disappears silently. */
  async handle(req: HostRequest, surface: Surface): Promise<void> {
    try {
      await this.run(req, surface)
    } catch (e) {
      const what =
        req.type === "openSession" ? "Could not open the worker" : req.type === "showTerminal" ? "Could not show the terminal" : req.type === "openImage" ? "Could not open the image" : req.type === "openDiff" || req.type === "openChanges" ? "Could not open the diff" : "OpenCode could not do that"
      void vscode.window.showErrorMessage(`${what}: ${e instanceof Error ? e.message : "unknown error"}`)
    }
  }

  private async run(req: HostRequest, surface: Surface): Promise<void> {
    switch (req.type) {
      case "openFile":
        return this.openFile(req.path, req.line)
      case "imageData": {
        const dataUri = await this.images().thumbnail(surface.sessionID(), req.ref).catch(() => undefined)
        surface.post({ type: "image", requestID: req.requestID, dataUri })
        return
      }
      case "openImage":
        return this.images().open(surface.sessionID(), req.ref, req.name)
      case "openDiff":
        return this.diffs().open(req.file, req.patches)
      case "openChanges":
        return this.diffs().changes(req.files, req.title ?? "OpenCode changes")
      case "showTerminal":
        return this.terminals().show(req.shellID, req.sessionID ?? surface.sessionID())
      case "openSession":
        return this.workers().open(req.id, req.readOnly)
      case "pickFiles":
        return this.pickFiles(req.requestID, surface)
      case "confirmRevert":
        return this.confirmRevert(req.messageID, surface)
      case "openExternal": {
        // Only web links leave VS Code; anything else (file:, command:) is ignored.
        if (/^https?:\/\//i.test(req.url)) await vscode.env.openExternal(vscode.Uri.parse(req.url))
        return
      }
      case "voice":
        return void (await vscode.commands.executeCommand("opencode.voice.toggle"))
      case "setCliPath":
        return void (await vscode.commands.executeCommand("opencode.setCliPath"))
      case "reconnect":
        return void (await vscode.commands.executeCommand("opencode.reconnect"))
      case "notify": {
        const show = req.level === "error" ? vscode.window.showErrorMessage : req.level === "warning" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage
        void show(req.message)
        return
      }
    }
  }

  /** Relative paths resolve against the project directory. */
  private resolve(path: string): vscode.Uri {
    if (/^file:\/\//i.test(path)) return vscode.Uri.parse(path)
    return isAbsolutePath(path) ? vscode.Uri.file(path) : vscode.Uri.joinPath(vscode.Uri.file(this.directory), ...path.split(/[\\/]+/).filter(Boolean))
  }

  /**
   * `vscode.open` picks the right editor for the file: text, image preview, PDF, notebook, or a custom editor.
   * `openTextDocument` only handles text and fails on images and other binary files.
   */
  private async openFile(path: string, line?: number): Promise<void> {
    const uri = this.resolve(path)
    try {
      await vscode.workspace.fs.stat(uri)
    } catch {
      void vscode.window.showWarningMessage(`File not found: ${path}`)
      return
    }
    try {
      const at = line && line > 0 ? new vscode.Position(line - 1, 0) : undefined
      const options: vscode.TextDocumentShowOptions = { preview: true, selection: at ? new vscode.Range(at, at) : undefined }
      await vscode.commands.executeCommand("vscode.open", uri, options)
    } catch (e) {
      void vscode.window.showWarningMessage(`Could not open ${path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** The paperclip: a native file dialog. The URI is exactly `Uri.file(path).toString()`, so Windows paths are right. */
  private async pickFiles(requestID: string, surface: Surface): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      openLabel: "Attach",
      defaultUri: vscode.Uri.file(this.directory),
    })
    if (!picked || picked.length === 0) return
    const files: PickedFile[] = picked.map((uri) => {
      const name = uri.path.split("/").pop() ?? "file"
      return { uri: uri.toString(), name, mime: mimeFromName(name) }
    })
    surface.post({ type: "picked", requestID, files })
  }

  private async confirmRevert(messageID: string, surface: Surface): Promise<void> {
    const revert = "Revert"
    const pick = await vscode.window.showWarningMessage(REVERT_PROMPT, { modal: true }, revert)
    if (pick === revert) surface.act({ type: "revert", messageID })
  }
}

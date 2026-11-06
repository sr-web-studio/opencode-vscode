import * as vscode from "vscode"
import { isAbsolutePath } from "../core/paths"
import type { Controller } from "../core/controller"
import type { HostRequest } from "../core/protocol"

/** Host-side effects the webview asks for. Everything here needs `vscode`, so it cannot live in core/ or ui/. */
export class HostActions {
  constructor(private readonly controller: Controller, private readonly directory: string) {}

  async handle(req: HostRequest): Promise<void> {
    switch (req.type) {
      case "openFile":
        return this.openFile(req.path, req.line)
      case "openDiff":
        return this.openDiff(req.file, req.patch)
      case "showTerminal":
        return this.showTerminal(req.shellID, req.title)
      case "openExternal": {
        // Only web links leave VS Code; anything else (file:, command:) is ignored.
        if (/^https?:\/\//i.test(req.url)) await vscode.env.openExternal(vscode.Uri.parse(req.url))
        return
      }
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
    return vscode.Uri.file(isAbsolutePath(path) ? path : `${this.directory}/${path}`)
  }

  private async openFile(path: string, line?: number): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(this.resolve(path))
      const at = line && line > 0 ? new vscode.Position(line - 1, 0) : undefined
      await vscode.window.showTextDocument(doc, { preview: true, selection: at ? new vscode.Range(at, at) : undefined })
    } catch {
      void vscode.window.showWarningMessage(`Could not open ${path}`)
    }
  }

  private async openDiff(file: string, patch: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({ language: "diff", content: patch || `No changes recorded for ${file}` })
    await vscode.window.showTextDocument(doc, { preview: true })
  }

  /** Background shells run on the server. The terminal shows their captured output (read-only). */
  private async showTerminal(shellID: string, title?: string): Promise<void> {
    let output: string
    try {
      output = await this.controller.shellOutput(shellID)
    } catch {
      void vscode.window.showWarningMessage("The shell output is no longer available.")
      return
    }
    const write = new vscode.EventEmitter<string>()
    const pty: vscode.Pseudoterminal = {
      onDidWrite: write.event,
      open: () => write.fire(output.replace(/\r?\n/g, "\r\n")),
      close: () => write.dispose(),
    }
    vscode.window.createTerminal({ name: title ? `OpenCode: ${title}` : "OpenCode shell", pty }).show()
  }
}

import * as vscode from "vscode"
import { checkSonioxKey } from "../core/voice"

const KEY = "opencode.voice.sonioxKey"

/**
 * The user's own Soniox key (bring-your-own-key, free). Kept only in VS Code SecretStorage: never in settings, OpenCode
 * config, logs or the webview. Recording itself needs the companion extension (M4); until then `capture` is false.
 */
export class VoiceKeys implements vscode.Disposable {
  private keySet = false
  private checking = false
  private readonly sub: vscode.Disposable

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly publish: (v: { keySet: boolean; capture: boolean }) => void,
  ) {
    // Another window saved or cleared the key: follow it.
    this.sub = secrets.onDidChange((e) => {
      if (e.key === KEY) void this.refresh()
    })
  }

  async refresh(): Promise<void> {
    this.keySet = !!(await this.secrets.get(KEY))
    this.publish({ keySet: this.keySet, capture: false })
  }

  /** The mic button: no key → ask and check; with a key → record (needs the companion). */
  async click(): Promise<void> {
    if (!this.keySet) return this.setKey()
    void vscode.window.showInformationMessage(
      "Voice input is ready. Recording in VS Code arrives with the OpenCode companion extension (laptop side), coming next.",
    )
  }

  /** Ask for a key, check it with Soniox, and save it only when Soniox accepts it. */
  async setKey(): Promise<void> {
    if (this.checking) return
    const value = await vscode.window.showInputBox({
      title: "OpenCode voice input",
      prompt: "Your own Soniox API key (console.soniox.com). Stored in VS Code's secret storage on this machine; you pay Soniox directly.",
      placeHolder: "Soniox API key",
      password: true,
      ignoreFocusOut: true,
    })
    if (value === undefined) return
    this.checking = true
    let result
    try {
      result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Checking the Soniox key…" },
        () => checkSonioxKey((url, init) => fetch(url, init), value),
      )
      if (result.ok) {
        await this.secrets.store(KEY, value.trim())
        await this.refresh()
      }
    } finally {
      this.checking = false
    }
    if (result.ok) {
      void vscode.window.showInformationMessage("Soniox key saved. Voice input is enabled.")
      return
    }
    // Nothing saved: the button keeps its previous state.
    const pick = await vscode.window.showErrorMessage(`Voice key not saved. ${result.reason}`, "Try again")
    if (pick === "Try again") await this.setKey()
  }

  async clearKey(): Promise<void> {
    await this.secrets.delete(KEY)
    await this.refresh()
    void vscode.window.showInformationMessage("Soniox key removed. Voice input is off.")
  }

  dispose(): void {
    this.sub.dispose()
  }
}

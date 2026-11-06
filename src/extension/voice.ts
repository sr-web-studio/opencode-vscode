import * as vscode from "vscode"
import { COMPANION, DEFAULT_LANGUAGES, SONIOX_MODEL, spokenText, type CompanionInfo, type VoiceFeed, type VoiceFix } from "../core/dictation"
import type { AppState, ToWebview } from "../core/protocol"
import { checkSonioxKey, mintSonioxTempKey } from "../core/voice"

const KEY = "opencode.voice.sonioxKey"
const COMPANION_ID = "sr-web-studio.opencode-voice"

type VoiceState = AppState["voice"]

/**
 * Voice input, bring-your-own-key (Soniox).
 *
 * - The user's own key lives only in VS Code SecretStorage of this extension: never in settings, OpenCode config, logs,
 *   the webview or the companion.
 * - Recording happens in the companion extension (`opencode-voice`, `extensionKind: ["ui"]`), which runs on the
 *   machine with the microphone, also when this extension runs on a remote host over SSH. For each recording this
 *   extension mints a short-lived Soniox key and hands it to the companion. The companion streams audio to Soniox and
 *   sends the heard text back through `opencode.voice.feed`; the text goes to the prompt box (never sent by itself).
 */
export class Voice implements vscode.Disposable {
  private keySet = false
  private capture = false
  private recording: VoiceState["recording"] = "off"
  private current?: string
  private checking = false
  private installing?: Promise<CompanionInfo | undefined>
  private readonly sub: vscode.Disposable

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly publish: (v: VoiceState) => void,
    private readonly post: (m: ToWebview) => void,
    private readonly log: (line: string) => void,
    /** The companion vsix shipped inside this extension, and the version it must have (this extension's). */
    private readonly bundled: { vsix: vscode.Uri; version: string },
  ) {
    // Another window saved or cleared the key: follow it.
    this.sub = secrets.onDidChange((e) => {
      if (e.key === KEY) void this.refresh()
    })
  }

  private emit(): void {
    this.publish({ keySet: this.keySet, capture: this.capture, recording: this.recording })
  }

  async refresh(): Promise<void> {
    this.keySet = !!(await this.secrets.get(KEY))
    this.capture = !!(await this.companion())
    this.emit()
  }

  private async companion(): Promise<CompanionInfo | undefined> {
    try {
      const info = await vscode.commands.executeCommand<CompanionInfo>(COMPANION.ping)
      return info && typeof info === "object" ? info : undefined
    } catch {
      return undefined
    }
  }

  /** The mic button (and `OpenCode: Voice Input`): ask for a key, or start/stop dictation. */
  async click(): Promise<void> {
    if (!this.keySet) return this.setKey()
    if (this.recording !== "off") return this.stop()
    await this.start()
  }

  /**
   * Make sure the companion runs on the user's computer, in this extension's version. It is shipped inside this
   * extension and installed from there: VS Code puts a `ui` extension on the local machine also when this window is
   * remote (the vsix is fetched over the remote connection). Runs at activation and before each recording; installs at
   * most once per window.
   */
  async ensureCompanion(interactive: boolean): Promise<CompanionInfo | undefined> {
    const info = await this.companion()
    if (info && info.version === this.bundled.version) return info
    this.installing ??= this.installCompanion(info)
    const result = await this.installing
    // A failed install may be retried by the next mic click.
    if (!result) this.installing = undefined
    return result ?? (interactive ? await this.offerManualInstall() : undefined)
  }

  private async installCompanion(old: CompanionInfo | undefined): Promise<CompanionInfo | undefined> {
    this.log(`Voice: ${old ? `updating OpenCode Voice ${old.version} → ${this.bundled.version}` : `installing OpenCode Voice ${this.bundled.version}`} on this computer`)
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Installing OpenCode Voice…" }, () =>
        Promise.resolve(vscode.commands.executeCommand("workbench.extensions.installExtension", this.bundled.vsix)),
      )
    } catch (e) {
      this.log(`Voice: installing OpenCode Voice failed: ${e instanceof Error ? e.message : e}`)
      return undefined
    }
    // A new extension starts at once; an update of a running one needs the window to restart its extensions.
    for (let i = 0; i < 20; i++) {
      const info = await this.companion()
      if (info?.version === this.bundled.version) {
        await this.refresh()
        return info
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    if (old) {
      void vscode.window
        .showInformationMessage("OpenCode Voice was updated. Reload the window to use the new version.", "Reload Window")
        .then((pick) => pick && vscode.commands.executeCommand("workbench.action.reloadWindow"))
      return old
    }
    await this.refresh()
    return this.companion()
  }

  private async offerManualInstall(): Promise<undefined> {
    this.emit()
    const pick = await vscode.window.showErrorMessage(
      "Voice input needs OpenCode Voice on this computer, and installing it automatically did not work. Install opencode-voice.vsix by hand, then click the mic again.",
      "Install from VSIX…",
      "Show Log",
    )
    if (pick === "Install from VSIX…") await vscode.commands.executeCommand("workbench.extensions.action.installVSIX")
    if (pick === "Show Log") await vscode.commands.executeCommand("workbench.action.output.show")
    return undefined
  }

  private async start(): Promise<void> {
    const id = `dict_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.current = id
    this.recording = "starting"
    this.emit()
    const info = await this.ensureCompanion(true)
    if (this.current !== id) return
    this.capture = !!info
    if (!info) return this.finish(id)
    if (!info.capture) return this.failed(id, info.problem ?? "Voice recording is not available on this computer.")
    const key = await this.secrets.get(KEY)
    if (!key) {
      this.finish(id)
      return this.setKey()
    }
    const temp = await mintSonioxTempKey((url, init) => fetch(url, init), key)
    if (this.current !== id) return
    if (!temp.ok) return this.failed(id, temp.reason)
    const cfg = vscode.workspace.getConfiguration("opencode.voice")
    const languages = cfg.get<string[]>("languages", DEFAULT_LANGUAGES).filter((l) => typeof l === "string" && l.trim())
    try {
      const ok = await vscode.commands.executeCommand<boolean>(COMPANION.start, {
        id,
        key: temp.key,
        model: cfg.get<string>("model", SONIOX_MODEL) || SONIOX_MODEL,
        languages: languages.length ? languages : DEFAULT_LANGUAGES,
      })
      if (ok === false) this.failed(id, "The companion could not start recording.")
    } catch (e) {
      this.failed(id, `The companion could not start recording: ${e instanceof Error ? e.message : e}`)
    }
  }

  async stop(): Promise<void> {
    const id = this.current
    if (!id) {
      this.recording = "off"
      return this.emit()
    }
    this.recording = "stopping"
    this.emit()
    // The companion ends a recording within ~8 s (it kills its recorder process); never stay in "stopping" if it vanished.
    setTimeout(() => this.finish(id), 12_000)
    try {
      await vscode.commands.executeCommand(COMPANION.stop, id)
    } catch {
      this.finish(id)
    }
  }

  /** Updates from the companion (`opencode.voice.feed`). Updates of an older recording are ignored. */
  feed(u: VoiceFeed): void {
    if (!u || u.id !== this.current) return
    if (u.kind === "listening") {
      if (this.recording === "starting") this.recording = "on"
      this.log(`Voice: listening${u.device ? ` (${u.device})` : ""}`)
      return this.emit()
    }
    if (u.kind === "heard") {
      if (this.recording === "starting") this.recording = "on"
      this.post({ type: "dictation", id: u.id, text: spokenText({ final: u.final, partial: u.partial, finished: false }), done: false })
      return this.emit()
    }
    const st = u.stats
    if (st) this.log(`Voice: ended after ${(st.frames / 10).toFixed(1)} s on ${st.device ?? "the default microphone"}, peak level ${st.peak}/32767, ${st.answers} answers from Soniox, ${u.final.length} characters`)
    this.post({ type: "dictation", id: u.id, text: spokenText({ final: u.final, partial: "", finished: true }), done: true })
    if (u.error) return this.failed(u.id, u.error, u.fix)
    this.finish(u.id)
  }

  private failed(id: string, reason: string, fix?: VoiceFix): void {
    this.log(`Voice: ${reason}`)
    this.finish(id)
    const actions =
      fix === "micSettings" ? ["Open Microphone Settings", "Choose Microphone"]
      : fix === "chooseMicrophone" ? ["Choose Microphone"]
      : []
    void vscode.window.showErrorMessage(`Voice input: ${reason}`, ...actions).then((pick) => {
      if (pick === "Open Microphone Settings") void vscode.commands.executeCommand(COMPANION.micSettings)
      if (pick === "Choose Microphone") void vscode.commands.executeCommand(COMPANION.chooseMicrophone)
    })
  }

  private finish(id: string): void {
    if (this.current !== id) return
    this.current = undefined
    this.recording = "off"
    this.emit()
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
    if (this.recording !== "off") await this.stop()
    await this.secrets.delete(KEY)
    await this.refresh()
    void vscode.window.showInformationMessage("Soniox key removed. Voice input is off.")
  }

  /** Watch for the companion being installed or removed while this window is open. */
  watchCompanion(): vscode.Disposable {
    return vscode.extensions.onDidChange(() => void this.refresh())
  }

  static readonly companionID = COMPANION_ID

  dispose(): void {
    if (this.current) void vscode.commands.executeCommand(COMPANION.stop, this.current).then(undefined, () => undefined)
    this.sub.dispose()
  }
}

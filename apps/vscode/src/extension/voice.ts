import * as vscode from "vscode"
import { COMPANION, DEFAULT_LANGUAGES, SONIOX_MODEL, isNewerVersion, normalizeEngine, spokenText, type CompanionInfo, type VoiceEngine, type VoiceFeed, type VoiceFix } from "@occ/core/dictation"
import { startArgs, voiceReady } from "@occ/core/local-voice"
import { applyPick, clampMaxLanguages, cycleLanguages, displayName, languageById, languageItems, normalizeLanguages, withCurrent } from "@occ/core/voice-catalog"
import type { AppState, ToWebview } from "@occ/core/protocol"
import { checkSonioxKey, mintSonioxTempKey } from "@occ/core/voice"

const KEY = "opencode.voice.sonioxKey"
const COMPANION_ID = "sr-web-studio.opencode-voice"

type VoiceState = AppState["voice"]

/**
 * Voice input. Two engines (setting `opencode.voice.engine`):
 * - `local` (default): free, offline, runs in the companion on the user's computer. The user keeps a short list of
 *   active spoken languages (`opencode.voice.localLanguages`, at most `opencode.voice.maxLanguages`, default 2); the
 *   FIRST is the one that records, one model runs at a time. "Choose Voice Language" edits the list, "Switch Voice
 *   Language" (and the label next to the mic) rotates it. Only the pack that serves the current language is downloaded.
 * - `soniox`: cloud, bring-your-own-key.
 *
 * Soniox:
 * - The user's own key lives only in VS Code SecretStorage of this extension: never in settings, OpenCode config, logs,
 *   the webview or the companion.
 * - Recording happens in the companion extension (`opencode-voice`, `extensionKind: ["ui"]`), which runs on the
 *   machine with the microphone, also when this extension runs on a remote host over SSH. For each recording this
 *   extension mints a short-lived Soniox key and hands it to the companion. The companion streams audio to Soniox and
 *   sends the heard text back through `opencode.voice.feed`; the text goes to the prompt box (never sent by itself).
 */
export class Voice implements vscode.Disposable {
  private keySet = false
  private engine: VoiceEngine = "local"
  private languages: string[] = normalizeLanguages(undefined)
  private info?: CompanionInfo
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
    this.publish({ engine: this.engine, ready: voiceReady(this.engine, this.keySet, this.info), capture: this.capture, recording: this.recording, languages: this.languages })
  }

  private readEngine(): VoiceEngine {
    return normalizeEngine(vscode.workspace.getConfiguration("opencode.voice").get("engine"))
  }

  /**
   * The active languages, first = current. `localLanguages` wins once the user set it; until then the old single
   * `localLanguage` (`en` / `bn`) is the list, so nobody has to migrate by hand. Writing the list (picker, switch)
   * is what retires the old setting.
   */
  private readLanguages(): string[] {
    const cfg = vscode.workspace.getConfiguration("opencode.voice")
    const set = cfg.inspect<string[]>("localLanguages")
    const user = set?.workspaceFolderValue ?? set?.workspaceValue ?? set?.globalValue
    return normalizeLanguages(user, { max: cfg.get("maxLanguages"), legacy: cfg.get("localLanguage") })
  }

  /** Save the list where the user has it (workspace if set there, else user settings), then publish. */
  private async saveLanguages(list: string[]): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("opencode.voice")
    const set = cfg.inspect<string[]>("localLanguages")
    const target = set?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder : set?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
    await cfg.update("localLanguages", list, target)
    this.languages = list
    this.emit()
  }

  /** A setting changed (`localLanguages`, `localLanguage`, `maxLanguages`): re-read and publish. */
  syncLanguages(): void {
    this.languages = this.readLanguages()
    this.emit()
  }

  async refresh(): Promise<void> {
    this.engine = this.readEngine()
    this.languages = this.readLanguages()
    this.keySet = !!(await this.secrets.get(KEY))
    this.info = await this.companion()
    this.capture = !!this.info
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

  /** The mic button (and `OpenCode: Voice Input`): (soniox without a key) ask for a key, or start/stop dictation. */
  async click(): Promise<void> {
    this.engine = this.readEngine()
    if (this.engine === "soniox" && !this.keySet) return this.setKey()
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
    // Only ever upgrade: an equal or newer companion (e.g. installed by another copy of this extension) is kept.
    if (info && !isNewerVersion(this.bundled.version, info.version)) return info
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
    this.info = info
    const cfg = vscode.workspace.getConfiguration("opencode.voice")
    const engine = this.engine
    const languages = cfg.get<string[]>("languages", DEFAULT_LANGUAGES).filter((l) => typeof l === "string" && l.trim())
    let soniox: { key: string; model: string } | undefined
    if (engine === "soniox") {
      const key = await this.secrets.get(KEY)
      if (!key) {
        this.finish(id)
        return this.setKey()
      }
      const temp = await mintSonioxTempKey((url, init) => fetch(url, init), key)
      if (this.current !== id) return
      if (!temp.ok) return this.failed(id, temp.reason)
      soniox = { key: temp.key, model: cfg.get<string>("model", SONIOX_MODEL) || SONIOX_MODEL }
    } else if (info.local === false) {
      return this.failed(id, info.localProblem ?? "The on-device engine is not available on this computer.")
    }
    this.log(`Voice: engine ${engine}`)
    try {
      const ok = await vscode.commands.executeCommand<boolean>(
        COMPANION.start,
        startArgs({ id, engine, languages: languages.length ? languages : DEFAULT_LANGUAGES, localLanguage: this.readLanguages()[0], threads: cfg.get<number>("localThreads"), soniox }),
      )
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
    if (st) this.log(`Voice: ended after ${(st.frames / 10).toFixed(1)} s on ${st.device ?? "the default microphone"}, peak level ${st.peak}/32767, ${st.answers} ${this.engine === "local" ? "segments" : "answers from Soniox"}, ${u.final.length} characters`)
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
      : fix === "showLog" ? ["Show Log"]
      : []
    void vscode.window.showErrorMessage(`Voice input: ${reason}`, ...actions).then((pick) => {
      if (pick === "Open Microphone Settings") void vscode.commands.executeCommand(COMPANION.micSettings)
      if (pick === "Choose Microphone") void vscode.commands.executeCommand(COMPANION.chooseMicrophone)
      if (pick === "Show Log") void vscode.commands.executeCommand(COMPANION.showLog)
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

  /**
   * "OpenCode: Choose Voice Language": tick the languages you speak (at most `maxLanguages`), grouped by download.
   * Packs already on this computer are marked (the companion reports them; an older companion does not, then none is
   * marked). The first ticked language that was already active stays current. Nothing is downloaded here: the first
   * recording in a language downloads its pack.
   */
  async chooseLanguage(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("opencode.voice")
    const max = clampMaxLanguages(cfg.get("maxLanguages"))
    const active = this.readLanguages()
    const info = await this.companion()
    type Item = vscode.QuickPickItem & { id?: string }
    for (;;) {
      const items: Item[] = []
      let group = ""
      for (const i of languageItems({ installed: info?.installedLanguages, active })) {
        if (i.group !== group) items.push({ label: i.group, kind: vscode.QuickPickItemKind.Separator })
        group = i.group
        items.push({ label: i.label, description: i.description, detail: i.detail, picked: i.picked, id: i.id })
      }
      const picks = await vscode.window.showQuickPick(items, {
        title: `OpenCode: voice languages (on-device, up to ${max})`,
        placeHolder: max === 1 ? "Which language will you speak?" : `Tick the languages you speak (up to ${max}; change the limit in opencode.voice.maxLanguages)`,
        canPickMany: true,
        matchOnDescription: true,
      })
      if (!picks) return
      const ids = picks.map((p) => p.id).filter((id): id is string => !!id)
      if (ids.length === 0) {
        void vscode.window.showInformationMessage("Voice language: pick at least one language.")
        continue
      }
      const { list, dropped } = applyPick(active, ids, max)
      if (dropped.length) {
        const names = dropped.map((id) => displayName(languageById(id) ?? { name: id, native: id })).join(", ")
        const pick = await vscode.window.showWarningMessage(`You can have ${max} active voice language${max === 1 ? "" : "s"}. Keeping ${list.map((id) => languageById(id)?.name ?? id).join(", ")}; not added: ${names}.`, "Keep This", "Choose Again")
        if (pick !== "Keep This") continue
      }
      await this.saveLanguages(list)
      const engineNote = this.readEngine() === "soniox" ? " The on-device engine is not selected now (setting opencode.voice.engine); Soniox uses opencode.voice.languages." : ""
      void vscode.window.showInformationMessage(`Voice language${list.length > 1 ? "s" : ""}: ${list.map((id) => languageById(id)?.name ?? id).join(", ")}. Now speaking: ${languageById(list[0]!)?.name ?? list[0]}.${engineNote}`)
      return
    }
  }

  /**
   * "OpenCode: Switch Voice Language" (`choose`: with 3 or more active languages it asks which) and the label next to
   * the mic (always the next one): the chosen active language becomes the current one.
   */
  async switchLanguage(choose = false): Promise<void> {
    if (this.recording !== "off") return void vscode.window.setStatusBarMessage("Stop the recording first, then switch the voice language.", 4000)
    const list = this.readLanguages()
    if (list.length < 2) {
      const pick = await vscode.window.showInformationMessage("Only one voice language is active. Add another to switch between them.", "Choose Languages")
      if (pick) await this.chooseLanguage()
      return
    }
    let next = cycleLanguages(list)
    if (choose && list.length > 2) {
      const pick = await vscode.window.showQuickPick(
        list.map((id, i) => ({ label: displayName(languageById(id) ?? { name: id, native: id }), description: i === 0 ? "current" : "", id })),
        { title: "OpenCode: switch voice language", placeHolder: "Which language will you speak now?" },
      )
      if (!pick) return
      next = withCurrent(list, pick.id, list.length)
    }
    await this.saveLanguages(next)
    const l = languageById(next[0]!)
    vscode.window.setStatusBarMessage(`Voice language: ${l?.name ?? next[0]}`, 3000)
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

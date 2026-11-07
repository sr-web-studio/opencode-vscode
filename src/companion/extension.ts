import * as vscode from "vscode"
import { execFile, fork, spawn, type ChildProcess } from "node:child_process"
import { join } from "node:path"
import { COMPANION, VOICE_FEED_COMMAND, type CompanionInfo, type VoiceFeed, type VoiceFix, type VoiceStartArgs } from "../core/dictation"
import { SHERPA_PLATFORMS, clampThreads, sherpaTarget, type LocalPaths } from "../core/local-voice"
import { CATALOG, downloadDetail, downloadPrompt, languageFor, megabytes, packBytes, packFor, type LanguagePack } from "../core/voice-catalog"
import { IntegrityError, ensureLocal, installedLanguages, isInstalled, localState, missingBytes, removeLanguages, removeUnknownModels } from "./local-install"
import { envWithNative } from "./sherpa"
import { WINDOWS_QUERIES, deniedMessage, micSettingsTarget, windowsMicPermission, type MicPermission } from "./privacy"
import { SILENT_PEAK, type SessionUpdate } from "./session"
import { identityOf, normalizeRequest, type AttentionRequest } from "../core/attention"
import { WindowsHelper, askForAttention, type AttentionResult } from "./attention"

/**
 * OpenCode Voice: the laptop side of voice input. It runs where VS Code's window runs (`extensionKind: ["ui"]`), also
 * when the workspace is on a remote machine over SSH, because only there is the microphone. The OpenCode extension
 * starts and stops it through commands and receives the text through `opencode.voice.feed`.
 *
 * It never sees the user's Soniox key: each recording gets a short-lived key from the OpenCode extension.
 */

const DEVICE_KEY = "opencode.voice.device"
const FIRST_USE_KEY = "opencode.voice.firstUseShown"
/** Palette command of the companion (contributed, so VS Code activates the companion for it). */
const REMOVE_LANGUAGES_COMMAND = "opencode.companion.voice.removeLanguages"
/** The OpenCode extension's language picker (it owns the setting). */
const CHOOSE_LANGUAGE_COMMAND = "opencode.voice.chooseLanguage"

const SUPPORTED = new Set(["win32/x64", "win32/arm64", "darwin/x64", "darwin/arm64", "linux/x64"])

let current: { id: string; child: ChildProcess; done: boolean } | undefined
let log: vscode.LogOutputChannel
let attentionHelper: WindowsHelper | undefined

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel("OpenCode Voice", { log: true })
  const version = String(context.extension.packageJSON.version ?? "")
  const platform = `${process.platform}/${process.arch}`
  const capture = SUPPORTED.has(platform)

  context.subscriptions.push(
    log,
    vscode.commands.registerCommand(COMPANION.ping, async (): Promise<CompanionInfo> => {
      const local = !!sherpaTarget(process.platform, process.arch)
      let installed: string[] | undefined
      if (local) {
        try {
          installed = installedLanguages(await localState(storageOptions(context)))
        } catch (e) {
          log.warn(`Could not list the downloaded languages: ${e instanceof Error ? e.message : e}`)
        }
      }
      return {
        version,
        capture,
        platform: process.platform,
        problem: capture ? undefined : `Voice recording is not available on ${platform}.`,
        local,
        attention: true,
        installedLanguages: installed,
        localProblem: local ? undefined : `The on-device engine is not available on ${platform}${capture ? " (the microphone works: use the Soniox engine)" : ""}. It runs on: ${SHERPA_PLATFORMS.join(", ")}.`,
      }
    }),
    vscode.commands.registerCommand(REMOVE_LANGUAGES_COMMAND, () => removeDownloadedLanguages(context)),
    vscode.commands.registerCommand(COMPANION.showLog, () => log.show(true)),
    vscode.commands.registerCommand(COMPANION.micSettings, () => openMicSettings()),
    vscode.commands.registerCommand(COMPANION.start, (args: VoiceStartArgs) => start(context, args)),
    vscode.commands.registerCommand(COMPANION.stop, (id?: string) => stop(id)),
    vscode.commands.registerCommand(COMPANION.chooseMicrophone, () => chooseMicrophone(context)),
    vscode.commands.registerCommand(COMPANION.attention, (raw?: unknown) => attention(normalizeRequest(raw))),
    vscode.commands.registerCommand(COMPANION.testAttention, () => testAttention()),
    { dispose: () => kill() },
    { dispose: () => disposeAttention() },
  )
}

export function deactivate(): void {
  kill()
  disposeAttention()
}

/* ------------------------------------------------------------ window attention */

/** What this window's title bar shows, as far as this (UI) host can tell. Remote windows may or may not carry ` [SSH: host]`. */
function windowIdentity() {
  return identityOf({
    workspaceName: vscode.workspace.name,
    appName: vscode.env.appName,
    remoteName: vscode.env.remoteName,
    authority: vscode.workspace.workspaceFolders?.[0]?.uri.authority,
  })
}

function disposeAttention(): void {
  attentionHelper?.dispose()
  attentionHelper = undefined
}

function describeResult(r: AttentionResult): string {
  const chosen = r.chosen.length ? ` chosen: ${r.chosen.map((t) => JSON.stringify(t)).join(", ")};` : ""
  return `${r.ok ? "ok" : "failed"} via ${r.method} in ${r.ms} ms;${chosen}${r.problem ? ` ${r.problem};` : ""} candidates: ${r.candidates.map((t) => JSON.stringify(t)).join(", ") || "-"}`
}

/** Ask the operating system to draw attention to this window. Does nothing when the window is focused. */
async function attention(req: AttentionRequest, force = false): Promise<AttentionResult | undefined> {
  try {
    if (!force && vscode.window.state.focused) return undefined
    attentionHelper ??= new WindowsHelper({ log: (l) => log.info(l) })
    const who = windowIdentity()
    log.info(`Attention (${req.kind}): asking for it; window ${JSON.stringify({ root: who.rootName, app: who.appName, remote: who.remoteName, host: who.remoteHost })}`)
    const result = await askForAttention(attentionHelper, who, req, (l) => log.info(l))
    if (result.ok) log.info(`Attention: ${describeResult(result)}`)
    else log.warn(`Attention: ${describeResult(result)}`)
    return result
  } catch (e) {
    log.warn(`Attention failed: ${e instanceof Error ? e.message : e}`)
    return undefined
  }
}

/** The palette command: lets the user check the whole path from another window. */
async function testAttention(): Promise<void> {
  void vscode.window.showInformationMessage("OpenCode Voice: switch to another window now. This VS Code window will ask for attention in 5 seconds.")
  await new Promise((resolve) => setTimeout(resolve, 5000))
  const result = await attention({ kind: "completed", title: "OpenCode", body: "Test: this window asked for attention." })
  if (!result) {
    const message = vscode.window.state.focused
      ? "OpenCode Voice: this window is in front, so it did not ask for attention. Switch to another window during the 5 seconds and try again."
      : "OpenCode Voice: asking for attention failed."
    void vscode.window.showWarningMessage(message, "Show Log").then((pick) => pick && log.show(true))
    return
  }
  if (!result.ok) {
    void vscode.window.showWarningMessage(`OpenCode Voice: could not ask for attention (${result.problem ?? "unknown reason"}).`, "Show Log").then((pick) => pick && log.show(true))
  }
}

function feed(update: VoiceFeed): void {
  void vscode.commands.executeCommand(VOICE_FEED_COMMAND, update).then(undefined, (e) => log.warn(`feed failed: ${e instanceof Error ? e.message : e}`))
}

/* ------------------------------------------------------------ permission */

/** Windows: read the three privacy switches (no admin needed). Elsewhere: unknown (macOS asks by itself). */
function micPermission(): Promise<MicPermission> {
  if (process.platform !== "win32") return Promise.resolve({ state: "unknown" })
  const query = (hive: string, key: string) =>
    new Promise<string | undefined>((resolve) =>
      execFile("reg.exe", ["query", `${hive}\\${key}`, "/v", "Value"], { timeout: 5000, windowsHide: true }, (err, out) => resolve(err ? undefined : out)),
    )
  return Promise.all(WINDOWS_QUERIES.map((q) => query(q.hive, q.key))).then(windowsMicPermission)
}

function openMicSettings(): void {
  const target = micSettingsTarget(process.platform)
  if (!target) {
    void vscode.window.showInformationMessage("Check that the microphone is not muted in your system's sound settings.")
    return
  }
  try {
    spawn(target.command, target.args, { detached: true, stdio: "ignore", windowsHide: true }).unref()
  } catch (e) {
    log.warn(`Could not open the microphone settings: ${e instanceof Error ? e.message : e}`)
  }
}

/**
 * Before recording: if the system blocks the microphone, say so and offer its settings page instead of recording
 * silence. On first use explain what macOS is about to ask.
 */
async function permissionProblem(context: vscode.ExtensionContext): Promise<string | undefined> {
  const p = await micPermission()
  log.info(`Microphone permission: ${p.state}${p.state === "denied" ? ` (${p.switches.join(", ")})` : ""}`)
  if (p.state === "denied") return deniedMessage(p.switches)
  if (!context.globalState.get(FIRST_USE_KEY)) {
    await context.globalState.update(FIRST_USE_KEY, true)
    if (process.platform === "darwin") {
      void vscode.window.showInformationMessage("macOS will ask whether VS Code may use the microphone. Click Allow so voice input can hear you.")
    }
  }
  return undefined
}

/** What the user can do about a failed recording, from what the recording measured. */
function fixFor(u: Extract<SessionUpdate, { kind: "done" }>): VoiceFix | undefined {
  if (!u.error || u.final) return undefined
  if (u.fix) return u.fix
  const st = u.stats
  if (!st) return u.error.startsWith("Could not open the microphone") ? "chooseMicrophone" : undefined
  if (st.frames > 0 && st.peak < SILENT_PEAK) return "chooseMicrophone"
  if (st.frames === 0 || /No words were heard/.test(u.error)) return "chooseMicrophone"
  return undefined
}

/* ------------------------------------------------------------ devices */

/** List the microphones in a short-lived recorder process (the native library never loads in the extension host). */
function listDevices(context: vscode.ExtensionContext): Promise<{ devices: string[]; error?: string }> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = fork(join(context.extensionPath, "dist", "recorder.js"), [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "ignore", "pipe", "ipc"] })
    } catch (e) {
      return resolve({ devices: [], error: e instanceof Error ? e.message : String(e) })
    }
    let stderr = ""
    child.stderr?.on("data", (b: Buffer) => (stderr = (stderr + b.toString()).slice(-1000)))
    const timer = setTimeout(() => child.kill(), 10_000)
    child.on("message", (m: { kind?: string; devices?: string[]; error?: string }) => {
      if (m?.kind === "devices") resolve({ devices: m.devices ?? [], error: m.error })
    })
    child.on("exit", () => {
      clearTimeout(timer)
      resolve({ devices: [], error: stderr.trim().split("\n").pop() || "the recorder process ended" })
    })
    child.send({ type: "devices" })
  })
}

type SavedDevice = { name: string } | undefined

async function chooseMicrophone(context: vscode.ExtensionContext): Promise<void> {
  const { devices, error } = await listDevices(context)
  if (error || devices.length === 0) {
    void vscode.window.showErrorMessage(`OpenCode Voice: no microphone found${error ? ` (${error})` : ""}.`)
    return
  }
  const saved = context.globalState.get<SavedDevice>(DEVICE_KEY)
  const items: Array<vscode.QuickPickItem & { name?: string }> = [
    { label: "System default", description: !saved ? "current" : undefined },
    ...devices.map((name) => ({ label: name, name, description: saved?.name === name ? "current" : undefined })),
  ]
  const pick = await vscode.window.showQuickPick(items, { title: "OpenCode Voice: microphone", placeHolder: "Which microphone should voice input use?" })
  if (!pick) return
  await context.globalState.update(DEVICE_KEY, pick.name ? { name: pick.name } : undefined)
  log.info(`Microphone: ${pick.name ?? "system default"}`)
}

/** The chosen microphone's index now (indexes change when devices are plugged in); -1 = system default. */
async function deviceIndex(context: vscode.ExtensionContext): Promise<number> {
  const saved = context.globalState.get<SavedDevice>(DEVICE_KEY)
  if (!saved) return -1
  const { devices } = await listDevices(context)
  const i = devices.indexOf(saved.name)
  if (i < 0) log.warn(`Microphone “${saved.name}” is not connected; using the system default.`)
  return i
}

const storageOptions = (context: vscode.ExtensionContext) => ({ storage: context.globalStorageUri.fsPath, platform: process.platform, arch: process.arch })

/** Ask once, in a notification, before the on-device download of a language. Returns what the user chose. */
async function askDownload(pack: LanguagePack, bytes: number, engineMissing: boolean): Promise<"download" | "soniox" | "language" | "cancel"> {
  const pick = await vscode.window.showInformationMessage(
    downloadPrompt(pack, bytes, engineMissing),
    { detail: downloadDetail(pack) },
    "Download",
    "Choose Language",
    "Use Soniox instead",
  )
  return pick === "Download" ? "download" : pick === "Use Soniox instead" ? "soniox" : pick === "Choose Language" ? "language" : "cancel"
}

let cleaned = false

/**
 * Once per window, after the engine for the chosen language is ready: delete model folders the catalog no longer lists
 * (the English Zipformer + Moonshine of earlier versions, ~200 MB). Only our own folders under `models/`; see
 * `removeUnknownModels`. Never blocks or fails a recording.
 */
async function cleanOldModels(context: vscode.ExtensionContext): Promise<void> {
  if (cleaned) return
  cleaned = true
  try {
    const removed = await removeUnknownModels(storageOptions(context))
    if (removed.length) log.info(`Removed model folders the catalog no longer uses: ${removed.join(", ")}`)
  } catch (e) {
    log.warn(`Could not remove old model folders: ${e instanceof Error ? e.message : e}`)
  }
}

/** Download what the local engine needs for one language (with progress). Returns undefined when cancelled or failed (already reported). */
async function prepareLocal(context: vscode.ExtensionContext, language: string): Promise<LocalPaths | undefined | "soniox"> {
  const pack = packFor(language)
  const opts = storageOptions(context)
  const state = await localState(opts)
  if (!state.target) {
    void vscode.window.showErrorMessage(`On-device voice is not available on ${process.platform}/${process.arch}. Use the Soniox engine (opencode.voice.engine).`)
    return undefined
  }
  if (!isInstalled(state, pack)) {
    const choice = await askDownload(pack, missingBytes(state, pack), !state.native)
    if (choice === "soniox") return "soniox"
    if (choice === "language") {
      // The picker lives in the OpenCode extension (it owns the setting); the user clicks the mic again afterwards.
      void vscode.commands.executeCommand(CHOOSE_LANGUAGE_COMMAND).then(undefined, (e) => log.warn(`Choose Voice Language failed: ${e instanceof Error ? e.message : e}`))
      return undefined
    }
    if (choice === "cancel") return undefined
  }
  const ctl = new AbortController()
  try {
    const ready = isInstalled(state, pack)
    const paths = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: ready ? "OpenCode Voice: loading the on-device engine" : `OpenCode Voice: downloading the on-device engine (${pack.name})`, cancellable: !ready },
      (progress, token) => {
        token.onCancellationRequested(() => ctl.abort())
        let last = 0
        return ensureLocal({
          ...opts,
          language,
          signal: ctl.signal,
          log: (l) => log.info(l),
          onProgress: (p) => {
            const pct = (100 * p.done) / Math.max(1, p.total)
            if (pct - last < 0.5 && p.done < p.total) return
            progress.report({ increment: pct - last, message: `${megabytes(p.done)} of ${megabytes(p.total)} MB (${p.label})` })
            last = pct
          },
        })
      },
    )
    void cleanOldModels(context)
    return paths
  } catch (e) {
    if (ctl.signal.aborted) {
      log.info("On-device engine download cancelled")
      return undefined
    }
    const msg = e instanceof Error ? e.message : String(e)
    log.error(`On-device engine download failed: ${e instanceof Error ? (e.stack ?? msg) : msg}`)
    const what = e instanceof IntegrityError ? "A downloaded file did not match its checksum, so it was thrown away." : `The download failed: ${msg}`
    void vscode.window.showErrorMessage(`OpenCode Voice: ${what}`, "Show Log").then((pick) => pick && log.show(true))
    return undefined
  }
}

async function start(context: vscode.ExtensionContext, args: VoiceStartArgs): Promise<boolean> {
  if (!args?.id) return false
  const engine = args.engine === "local" ? "local" : "soniox"
  if (engine === "soniox" && !args.key) return false
  if (current && !current.done) stop(current.id)
  const blocked = await permissionProblem(context)
  if (blocked) {
    feed({ id: args.id, kind: "done", final: "", error: blocked, fix: "micSettings" })
    return true
  }
  let paths: LocalPaths | undefined
  if (engine === "local") {
    const language = languageFor(args.localLanguage)
    log.info(`Voice engine: local, language ${language.id} (pack ${language.pack}; ${process.platform}/${process.arch}; Electron ${process.versions.electron ?? "-"}, Node ${process.versions.node}, v8 ${process.versions.v8}, modules ${process.versions.modules})`)
    const prepared = await prepareLocal(context, language.id)
    if (prepared === "soniox") {
      void vscode.workspace.getConfiguration("opencode.voice").update("engine", "soniox", vscode.ConfigurationTarget.Global)
      feed({ id: args.id, kind: "done", final: "", error: "Switched to the Soniox engine. Add your Soniox key with “OpenCode: Set Voice API Key (Soniox)”, then click the mic again." })
      return true
    }
    if (!prepared) {
      feed({ id: args.id, kind: "done", final: "" })
      return true
    }
    paths = prepared
  }
  const device = await deviceIndex(context)
  const script = join(context.extensionPath, "dist", "recorder.js")
  let child: ChildProcess
  try {
    const base = { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
    child = fork(script, [], {
      env: paths ? envWithNative(base, paths.nativeDir, process.platform) : base,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    })
  } catch (e) {
    feed({ id: args.id, kind: "done", final: "", error: `Could not start the recorder: ${e instanceof Error ? e.message : e}` })
    return false
  }
  const run = { id: args.id, child, done: false }
  current = run
  let stderr = ""
  child.stderr?.on("data", (b: Buffer) => (stderr = (stderr + b.toString()).slice(-2000)))
  child.on("message", (u: SessionUpdate | { kind: "log"; line: string }) => {
    if (u.kind === "log") return void log.info(u.line)
    if (u.kind === "done") run.done = true
    if (u.kind === "listening") log.info(`Listening${u.device ? ` on ${u.device}` : ""}`)
    if (u.kind === "done") {
      const st = u.stats
      if (st) log.info(`Recording ended: ${st.frames} frames (${(st.frames / 10).toFixed(1)} s), peak level ${st.peak}/32767, ${st.answers} ${engine === "local" ? "segments" : "answers from Soniox"}, ${u.final.length} characters heard`)
      if (u.error) log.warn(u.error)
    }
    feed({ id: run.id, ...u, ...(u.kind === "done" ? { fix: fixFor(u) } : {}) } as VoiceFeed)
  })
  child.on("exit", (code, signal) => {
    if (current === run) current = undefined
    if (run.done) return
    run.done = true
    if (stderr.trim()) log.error(stderr.trim())
    const why = stderr.trim().split("\n").filter(Boolean).pop() ?? `exit ${code ?? signal}`
    feed({ id: run.id, kind: "done", final: "", error: `The recorder stopped unexpectedly (${why.slice(0, 200)}).`, fix: engine === "local" ? "showLog" : undefined })
  })
  child.send(
    engine === "local"
      ? { type: "start", engine: "local", paths, threads: clampThreads(args.threads), deviceIndex: device }
      : { type: "start", engine: "soniox", key: args.key, model: args.model, languages: args.languages, deviceIndex: device },
  )
  return true
}

/** Palette command: delete the models of languages the user no longer needs (never one another downloaded language still uses). */
async function removeDownloadedLanguages(context: vscode.ExtensionContext): Promise<void> {
  const opts = storageOptions(context)
  const state = await localState(opts)
  const have = installedLanguages(state)
  if (!state.target || have.length === 0) {
    void vscode.window.showInformationMessage("OpenCode Voice: no on-device language is downloaded on this computer.")
    return
  }
  // One entry per downloaded pack (a pack serves several languages), with the languages it serves.
  const items = CATALOG.packs
    .filter((p) => have.includes(p.id))
    .map((p) => {
      const names = CATALOG.languages.filter((l) => l.pack === p.id && l.id !== "auto").map((l) => l.name)
      return { label: p.name, description: `${megabytes(packBytes(p))} MB`, detail: names.length > 6 ? `${names.slice(0, 6).join(", ")} and ${names.length - 6} more languages` : names.join(", "), id: p.id }
    })
  const picked = await vscode.window.showQuickPick(items, { title: "OpenCode Voice: remove downloaded models", placeHolder: "Select the models to delete from this computer", canPickMany: true })
  if (!picked || picked.length === 0) return
  const removed = await removeLanguages(opts, picked.map((p) => p.id))
  log.info(`Removed packs ${picked.map((p) => p.id).join(", ")} (models deleted: ${removed.join(", ") || "none"})`)
  void vscode.window.showInformationMessage(`OpenCode Voice: removed ${picked.map((p) => p.label).join(", ")} from this computer. It is downloaded again if you use it.`)
}

function stop(id?: string): void {
  const run = current
  if (!run || (id && run.id !== id)) return
  if (run.child.connected) run.child.send({ type: "stop" })
  // The recording process ends itself after Soniox's last words; make sure it does.
  setTimeout(() => {
    if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill()
  }, 8000)
}

function kill(): void {
  const run = current
  current = undefined
  if (run && run.child.exitCode === null) run.child.kill()
}

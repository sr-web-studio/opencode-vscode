import * as vscode from "vscode"
import { execFile, fork, spawn, type ChildProcess } from "node:child_process"
import { join } from "node:path"
import { COMPANION, VOICE_FEED_COMMAND, type CompanionInfo, type VoiceFeed, type VoiceFix, type VoiceStartArgs } from "../core/dictation"
import { SHERPA_PLATFORMS, clampThreads, localUnderstands, megabytes, sherpaTarget, type LocalPaths } from "../core/local-voice"
import { IntegrityError, ensureLocal, isInstalled, localState, missingBytes } from "./local-install"
import { envWithNative } from "./sherpa"
import { WINDOWS_QUERIES, deniedMessage, micSettingsTarget, windowsMicPermission, type MicPermission } from "./privacy"
import { SILENT_PEAK, type SessionUpdate } from "./session"

/**
 * OpenCode Voice: the laptop side of voice input. It runs where VS Code's window runs (`extensionKind: ["ui"]`), also
 * when the workspace is on a remote machine over SSH, because only there is the microphone. The OpenCode extension
 * starts and stops it through commands and receives the text through `opencode.voice.feed`.
 *
 * It never sees the user's Soniox key: each recording gets a short-lived key from the OpenCode extension.
 */

const DEVICE_KEY = "opencode.voice.device"
const FIRST_USE_KEY = "opencode.voice.firstUseShown"
const BANGLA_NOTE_KEY = "opencode.voice.localBanglaNoteShown"

const SUPPORTED = new Set(["win32/x64", "win32/arm64", "darwin/x64", "darwin/arm64", "linux/x64"])

let current: { id: string; child: ChildProcess; done: boolean } | undefined
let log: vscode.LogOutputChannel

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel("OpenCode Voice", { log: true })
  const version = String(context.extension.packageJSON.version ?? "")
  const platform = `${process.platform}/${process.arch}`
  const capture = SUPPORTED.has(platform)

  context.subscriptions.push(
    log,
    vscode.commands.registerCommand(COMPANION.ping, (): CompanionInfo => {
      const local = !!sherpaTarget(process.platform, process.arch)
      return {
        version,
        capture,
        platform: process.platform,
        problem: capture ? undefined : `Voice recording is not available on ${platform}.`,
        local,
        localProblem: local ? undefined : `The on-device engine is not available on ${platform}${capture ? " (the microphone works: use the Soniox engine)" : ""}. It runs on: ${SHERPA_PLATFORMS.join(", ")}.`,
      }
    }),
    vscode.commands.registerCommand(COMPANION.showLog, () => log.show(true)),
    vscode.commands.registerCommand(COMPANION.micSettings, () => openMicSettings()),
    vscode.commands.registerCommand(COMPANION.start, (args: VoiceStartArgs) => start(context, args)),
    vscode.commands.registerCommand(COMPANION.stop, (id?: string) => stop(id)),
    vscode.commands.registerCommand(COMPANION.chooseMicrophone, () => chooseMicrophone(context)),
    { dispose: () => kill() },
  )
}

export function deactivate(): void {
  kill()
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

/** Ask once, in a notification, before the first on-device download. Returns what the user chose. */
async function askDownload(bytes: number): Promise<"download" | "soniox" | "cancel"> {
  const pick = await vscode.window.showInformationMessage(
    `On-device voice needs a one-time download of about ${megabytes(bytes)} MB (speech engine + Bangla models). Download now?`,
    {
      detail:
        "Free and offline after that. The speech engine is sherpa-onnx (Apache-2.0). The models are Vosk Bangla (Apache-2.0) and Sayed Shaun's bangla-zipformer (CC BY-SA 4.0, https://huggingface.co/SayedShaun/bangla-zipformer-onnx).",
    },
    "Download",
    "Use Soniox instead",
  )
  return pick === "Download" ? "download" : pick === "Use Soniox instead" ? "soniox" : "cancel"
}

/** Download what the local engine needs (with progress). Returns undefined when cancelled or failed (already reported). */
async function prepareLocal(context: vscode.ExtensionContext): Promise<LocalPaths | undefined | "soniox"> {
  const opts = { storage: context.globalStorageUri.fsPath, platform: process.platform, arch: process.arch }
  const state = await localState(opts)
  if (!state.target) {
    void vscode.window.showErrorMessage(`On-device voice is not available on ${process.platform}/${process.arch}. Use the Soniox engine (opencode.voice.engine).`)
    return undefined
  }
  if (!isInstalled(state)) {
    const choice = await askDownload(missingBytes(state))
    if (choice === "soniox") return "soniox"
    if (choice === "cancel") return undefined
  }
  const ctl = new AbortController()
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "OpenCode Voice: downloading the on-device engine", cancellable: true },
      (progress, token) => {
        token.onCancellationRequested(() => ctl.abort())
        let last = 0
        return ensureLocal({
          ...opts,
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
    log.info(`Voice engine: local (${process.platform}/${process.arch}; Electron ${process.versions.electron ?? "-"}, Node ${process.versions.node}, v8 ${process.versions.v8}, modules ${process.versions.modules})`)
    if (!localUnderstands(args.languages ?? [])) void noteBanglaOnly(context)
    const prepared = await prepareLocal(context)
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

/** Once: the on-device engine understands Bangla only. */
async function noteBanglaOnly(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get(BANGLA_NOTE_KEY)) return
  await context.globalState.update(BANGLA_NOTE_KEY, true)
  void vscode.window.showInformationMessage("On-device voice currently understands Bangla only. For other languages use the Soniox engine (setting opencode.voice.engine).")
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

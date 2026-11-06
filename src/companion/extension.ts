import * as vscode from "vscode"
import { execFile, fork, spawn, type ChildProcess } from "node:child_process"
import { join } from "node:path"
import { COMPANION, VOICE_FEED_COMMAND, type CompanionInfo, type VoiceFeed, type VoiceFix, type VoiceStartArgs } from "../core/dictation"
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
    vscode.commands.registerCommand(COMPANION.ping, (): CompanionInfo => ({ version, capture, platform: process.platform, problem: capture ? undefined : `Voice recording is not available on ${platform}.` })),
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

async function start(context: vscode.ExtensionContext, args: VoiceStartArgs): Promise<boolean> {
  if (!args?.id || !args.key) return false
  if (current && !current.done) stop(current.id)
  const blocked = await permissionProblem(context)
  if (blocked) {
    feed({ id: args.id, kind: "done", final: "", error: blocked, fix: "micSettings" })
    return true
  }
  const device = await deviceIndex(context)
  const script = join(context.extensionPath, "dist", "recorder.js")
  let child: ChildProcess
  try {
    child = fork(script, [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
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
  child.on("message", (u: SessionUpdate) => {
    if (u.kind === "done") run.done = true
    if (u.kind === "listening") log.info(`Listening${u.device ? ` on ${u.device}` : ""}`)
    if (u.kind === "done") {
      const st = u.stats
      if (st) log.info(`Recording ended: ${st.frames} frames (${(st.frames / 10).toFixed(1)} s), peak level ${st.peak}/32767, ${st.answers} answers from Soniox, ${u.final.length} characters heard`)
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
    feed({ id: run.id, kind: "done", final: "", error: `The recorder stopped unexpectedly (${why.slice(0, 200)}).` })
  })
  child.send({ type: "start", key: args.key, model: args.model, languages: args.languages, deviceIndex: device })
  return true
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

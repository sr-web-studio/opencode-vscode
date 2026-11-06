import * as vscode from "vscode"
import { fork, type ChildProcess } from "node:child_process"
import { join } from "node:path"
import { COMPANION, VOICE_FEED_COMMAND, type CompanionInfo, type VoiceFeed, type VoiceStartArgs } from "../core/dictation"
import type { SessionUpdate } from "./session"

/**
 * OpenCode Voice: the laptop side of voice input. It runs where VS Code's window runs (`extensionKind: ["ui"]`), also
 * when the workspace is on a remote machine over SSH, because only there is the microphone. The OpenCode extension
 * starts and stops it through commands and receives the text through `opencode.voice.feed`.
 *
 * It never sees the user's Soniox key: each recording gets a short-lived key from the OpenCode extension.
 */

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
    vscode.commands.registerCommand(COMPANION.ping, (): CompanionInfo => ({ version, capture, problem: capture ? undefined : `Voice recording is not available on ${platform}.` })),
    vscode.commands.registerCommand(COMPANION.start, (args: VoiceStartArgs) => start(context, args)),
    vscode.commands.registerCommand(COMPANION.stop, (id?: string) => stop(id)),
    { dispose: () => kill() },
  )
}

export function deactivate(): void {
  kill()
}

function feed(update: VoiceFeed): void {
  void vscode.commands.executeCommand(VOICE_FEED_COMMAND, update).then(undefined, (e) => log.warn(`feed failed: ${e instanceof Error ? e.message : e}`))
}

function start(context: vscode.ExtensionContext, args: VoiceStartArgs): boolean {
  if (!args?.id || !args.key) return false
  if (current && !current.done) stop(current.id)
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
    if (u.kind === "done" && u.error) log.warn(u.error)
    feed({ id: run.id, ...u } as VoiceFeed)
  })
  child.on("exit", (code, signal) => {
    if (current === run) current = undefined
    if (run.done) return
    run.done = true
    if (stderr.trim()) log.error(stderr.trim())
    const why = stderr.trim().split("\n").filter(Boolean).pop() ?? `exit ${code ?? signal}`
    feed({ id: run.id, kind: "done", final: "", error: `The recorder stopped unexpectedly (${why.slice(0, 200)}).` })
  })
  child.send({ type: "start", key: args.key, model: args.model, languages: args.languages })
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

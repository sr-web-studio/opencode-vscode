import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import {
  LineBuffer,
  decodeLine,
  encodeRequest,
  notifySendArgs,
  osascriptArgs,
  parseWmctrl,
  pickWindows,
  wmctrlAttentionArgs,
  type AttentionRequest,
  type HelperRequest,
  type HelperResponse,
  type WindowCandidate,
  type WindowIdentity,
} from "../core/attention"
import { helperArgs } from "./windows-script"

/**
 * Ask the operating system to draw attention to this VS Code window, from the user's own computer (this code runs in
 * the UI extension host). Never raises or focuses a window. Never throws: the answer says what happened.
 *
 * - Windows: `FlashWindowEx` through one long-lived PowerShell process (see windows-script.ts).
 * - Linux: `wmctrl` demand-attention on the matching X11 window, else `notify-send`.
 * - macOS: a notification (another process cannot bounce VS Code's dock icon).
 */

export type AttentionResult = {
  ok: boolean
  /** What was done: `flash`, `x11`, `notification`, or `none`. */
  method: "flash" | "x11" | "notification" | "none"
  /** Titles of the windows that were candidates. */
  candidates: string[]
  /** Titles of the windows that were asked for attention. */
  chosen: string[]
  reason?: string
  /** Why it did not work, in words for the log. */
  problem?: string
  ms: number
}

export type Log = (line: string) => void

/* ------------------------------------------------------------ the Windows helper */

export type SpawnFn = (command: string, args: string[], options: { windowsHide: true; stdio: ["pipe", "pipe", "pipe"] }) => ChildProcessWithoutNullStreams

export type HelperOptions = {
  spawn?: SpawnFn
  log?: Log
  /** Stop the process after this long without a request (default 10 minutes). */
  idleMs?: number
  /** Time for PowerShell to start and compile the class (default 30 s). */
  startMs?: number
  /** Time for one request (default 10 s). */
  requestMs?: number
}

type Pending = { resolve: (r: HelperResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

/** One persistent PowerShell process, started on first use, restarted after it died, stopped when idle or disposed. */
export class WindowsHelper {
  private child?: ChildProcessWithoutNullStreams
  private ready?: Promise<void>
  private pending = new Map<number, Pending>()
  private nextId = 1
  private idleTimer?: ReturnType<typeof setTimeout>
  private readonly o: Required<Omit<HelperOptions, "log" | "spawn">> & { log: Log; spawn: SpawnFn }

  constructor(options: HelperOptions = {}) {
    this.o = {
      spawn: options.spawn ?? ((c, a, opts) => spawn(c, a, opts)),
      log: options.log ?? (() => undefined),
      idleMs: options.idleMs ?? 10 * 60_000,
      startMs: options.startMs ?? 30_000,
      requestMs: options.requestMs ?? 10_000,
    }
  }

  get running(): boolean {
    return !!this.child
  }

  async call(req: DistributiveOmit<HelperRequest, "id">): Promise<HelperResponse> {
    await this.start()
    const child = this.child
    if (!child) throw new Error("the PowerShell helper is not running")
    this.touch()
    const id = this.nextId++
    return new Promise<HelperResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`the PowerShell helper did not answer within ${this.o.requestMs / 1000} s`))
        this.stop() // a stuck helper is replaced on the next call
      }, this.o.requestMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        child.stdin.write(encodeRequest({ ...req, id } as HelperRequest) + "\n")
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  dispose(): void {
    const child = this.child
    if (child && child.stdin.writable) {
      try {
        child.stdin.write(encodeRequest({ id: 0, op: "quit" }) + "\n")
      } catch {
        // killed below
      }
    }
    this.stop()
  }

  /* ---- internals */

  private start(): Promise<void> {
    if (this.child && this.ready) return this.ready
    const started = Date.now()
    this.o.log("Windows helper: starting PowerShell")
    let child: ChildProcessWithoutNullStreams
    try {
      child = this.o.spawn("powershell.exe", helperArgs(), { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)))
    }
    this.child = child
    const lines = new LineBuffer()
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (s: string) => (stderr = (stderr + s).slice(-1500)))
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`PowerShell did not become ready within ${this.o.startMs / 1000} s`))
        this.stop()
      }, this.o.startMs)
      const settle = (err?: Error) => {
        clearTimeout(timer)
        if (err) reject(err)
        else resolve()
      }
      child.stdout.on("data", (chunk: string) => {
        for (const line of lines.push(chunk)) {
          const got = decodeLine(line)
          if (!got) continue
          if (got.kind === "ready") {
            this.o.log(`Windows helper: ready after ${Date.now() - started} ms`)
            settle()
          } else {
            const p = this.pending.get(got.response.id)
            if (!p) continue
            clearTimeout(p.timer)
            this.pending.delete(got.response.id)
            p.resolve(got.response)
          }
        }
      })
      const ended = (why: string) => {
        const detail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" | ")
        const err = new Error(`PowerShell ${why}${detail ? `: ${detail.slice(0, 400)}` : ""}`)
        if (this.child === child) this.child = undefined
        this.ready = undefined
        this.clearIdle()
        settle(err)
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer)
          p.reject(err)
          this.pending.delete(id)
        }
      }
      child.on("error", (e) => ended(`could not start (${e.message})`))
      child.on("exit", (code, signal) => ended(`stopped (${code ?? signal})`))
    })
    // Without this a failed start that nobody awaits would be an unhandled rejection.
    ready.catch(() => undefined)
    this.ready = ready
    return ready
  }

  private stop(): void {
    const child = this.child
    this.child = undefined
    this.ready = undefined
    this.clearIdle()
    if (child && child.exitCode === null) {
      try {
        child.kill()
      } catch {
        // already gone
      }
    }
  }

  private touch(): void {
    this.clearIdle()
    this.idleTimer = setTimeout(() => {
      this.o.log("Windows helper: idle, stopping PowerShell")
      this.stop()
    }, this.o.idleMs)
    this.idleTimer.unref?.()
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/* ------------------------------------------------------------ per platform */

const titles = (list: WindowCandidate[]) => list.map((c) => c.title)

async function windowsAttention(helper: WindowsHelper, who: WindowIdentity, log: Log): Promise<Omit<AttentionResult, "ms">> {
  const found = await helper.call({ op: "windows", pid: process.pid })
  if (!found.ok) return { ok: false, method: "none", candidates: [], chosen: [], problem: found.error ?? "the window list failed" }
  const candidates: WindowCandidate[] = (found.windows ?? []).map((w) => ({ id: w.h, title: w.t }))
  log(`Windows: ${candidates.length} VS Code window(s) in process ${found.pid ?? "?"}: ${candidates.map((c) => JSON.stringify(c.title)).join(", ") || "-"}`)
  const pick = pickWindows(candidates, who, { trustSingle: true })
  if (pick.chosen.length === 0) {
    return { ok: false, method: "none", candidates: titles(candidates), chosen: [], reason: pick.reason, problem: candidates.length ? "no window title matched this window (a custom window.title can cause this)" : "no VS Code window was found for this process" }
  }
  if (pick.reason === "tie") log(`Windows: ${pick.chosen.length} titles fit equally well; flashing all of them`)
  const flashed = await helper.call({ op: "flash", hwnds: pick.chosen.map((c) => c.id) })
  if (!flashed.ok) return { ok: false, method: "none", candidates: titles(candidates), chosen: titles(pick.chosen), reason: pick.reason, problem: flashed.error ?? "FlashWindowEx failed" }
  const skipped = new Set(flashed.skipped ?? [])
  if (skipped.size) log(`Windows: ${skipped.size} window(s) already in front, not flashed`)
  return { ok: true, method: "flash", candidates: titles(candidates), chosen: titles(pick.chosen), reason: skipped.size === pick.chosen.length ? "already in front" : pick.reason }
}

function run(command: string, args: string[], timeout = 5000): Promise<{ ok: boolean; stdout: string; missing: boolean; error?: string }> {
  return new Promise((resolve) => {
    try {
      execFile(command, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => {
        if (!err) return resolve({ ok: true, stdout: String(stdout), missing: false })
        resolve({ ok: false, stdout: String(stdout ?? ""), missing: (err as NodeJS.ErrnoException).code === "ENOENT", error: err.message })
      })
    } catch (e) {
      resolve({ ok: false, stdout: "", missing: false, error: e instanceof Error ? e.message : String(e) })
    }
  })
}

async function notify(command: "osascript" | "notify-send", req: AttentionRequest): Promise<{ ok: boolean; missing: boolean; error?: string }> {
  const args = command === "osascript" ? osascriptArgs(req.title, req.body) : notifySendArgs(req.title, req.body)
  const r = await run(command, args)
  return { ok: r.ok, missing: r.missing, error: r.error }
}

async function linuxAttention(who: WindowIdentity, req: AttentionRequest, log: Log): Promise<Omit<AttentionResult, "ms">> {
  let candidates: WindowCandidate[] = []
  let problem: string | undefined
  if (process.env.DISPLAY) {
    const listed = await run("wmctrl", ["-l", "-p"])
    if (listed.ok) {
      const windows = parseWmctrl(listed.stdout)
      const byId = new Map(windows.map((w, i) => [i, w]))
      candidates = windows.map((w, i) => ({ id: i, title: w.title }))
      const pick = pickWindows(candidates, who, { requireApp: true })
      log(`X11: ${windows.length} window(s); ${pick.chosen.length} fit this window (${pick.reason})`)
      if (pick.chosen.length > 0) {
        if (pick.reason === "tie") log(`X11: ${pick.chosen.length} titles fit equally well; marking all of them`)
        let marked = 0
        for (const c of pick.chosen) {
          const w = byId.get(c.id)!
          if ((await run("wmctrl", wmctrlAttentionArgs(w.id))).ok) marked++
        }
        if (marked > 0) return { ok: true, method: "x11", candidates: titles(candidates), chosen: titles(pick.chosen), reason: pick.reason }
        problem = "wmctrl could not mark the window"
      } else {
        problem = "no X11 window title matched this window (Wayland? a custom window.title?)"
      }
    } else {
      problem = listed.missing ? "wmctrl is not installed" : `wmctrl failed: ${listed.error}`
    }
  } else {
    problem = "no X11 display (DISPLAY is not set)"
  }
  log(`X11: ${problem}; trying a notification`)
  const sent = await notify("notify-send", req)
  if (sent.ok) return { ok: true, method: "notification", candidates: titles(candidates), chosen: [], reason: problem }
  return { ok: false, method: "none", candidates: titles(candidates), chosen: [], problem: `${problem}; ${sent.missing ? "notify-send is not installed" : `notify-send failed: ${sent.error}`}` }
}

async function macAttention(req: AttentionRequest): Promise<Omit<AttentionResult, "ms">> {
  const sent = await notify("osascript", req)
  return sent.ok ? { ok: true, method: "notification", candidates: [], chosen: [] } : { ok: false, method: "none", candidates: [], chosen: [], problem: `osascript failed: ${sent.error}` }
}

/** Ask for attention on this computer. The caller has already checked that the window is not focused. */
export async function askForAttention(helper: WindowsHelper, who: WindowIdentity, req: AttentionRequest, log: Log, platform: NodeJS.Platform = process.platform): Promise<AttentionResult> {
  const started = Date.now()
  try {
    const r = platform === "win32" ? await windowsAttention(helper, who, log) : platform === "darwin" ? await macAttention(req) : platform === "linux" ? await linuxAttention(who, req, log) : { ok: false, method: "none" as const, candidates: [], chosen: [], problem: `not supported on ${platform}` }
    return { ...r, ms: Date.now() - started }
  } catch (e) {
    return { ok: false, method: "none", candidates: [], chosen: [], problem: e instanceof Error ? e.message : String(e), ms: Date.now() - started }
  }
}

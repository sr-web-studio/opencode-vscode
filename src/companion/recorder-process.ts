/**
 * The recording process of the companion. Forked by the companion extension (`ELECTRON_RUN_AS_NODE`), so a crash in the
 * native recorder can never take down VS Code's extension host. It records, streams to Soniox and reports text over IPC.
 *
 * IPC in:  { type: "start", engine?: "soniox", key, model, languages, deviceIndex? }
 *          | { type: "start", engine: "local", paths, threads, deviceIndex? } | { type: "stop" } | { type: "devices" }
 * IPC out: SessionUpdate ({ kind: "listening" | "heard" | "done", ... }) | { kind: "devices", devices, error? }
 *          | { kind: "log", line } (diagnostics of the on-device engine, for the "OpenCode Voice" output channel)
 */
import { join } from "node:path"
import type { LocalPaths } from "../core/local-voice"
import { LocalDictationSession } from "./local-session"
import { DictationSession, type Recorder, type SessionUpdate, type Socket } from "./session"
import { loadEngine } from "./sherpa"

// 100 ms frames at 16 kHz: few, small WebSocket messages and low latency.
const FRAME = 1600

type Start = { type: "start"; engine?: "soniox"; key: string; model: string; languages: string[]; deviceIndex?: number }
type StartLocal = { type: "start"; engine: "local"; paths: LocalPaths; threads?: number; deviceIndex?: number }

let session: { start(): void; stop(): void; abort(): void } | undefined

const send = (u: SessionUpdate): void => {
  process.send?.(u)
  if (u.kind === "done") setTimeout(() => process.exit(0), 100)
}

type PvRecorderClass = { new (frameLength: number, deviceIndex?: number): Recorder; getAvailableDevices(): string[] }

const log = (line: string): void => void process.send?.({ kind: "log", line })

function pv(): PvRecorderClass {
  // Loaded lazily so a missing or broken native build is reported as a normal error. The package is shipped as files
  // next to this script (dist/pvrecorder/{dist,lib}): it finds its native binary through `__dirname/../lib/`.
  return (require(join(__dirname, "pvrecorder", "dist", "index.js")) as { PvRecorder: PvRecorderClass }).PvRecorder
}

function makeSocket(url: string, protocols: string[]): Socket {
  const WS = (globalThis as { WebSocket?: new (url: string, protocols: string[]) => Socket }).WebSocket
  if (!WS) throw new Error("this VS Code is too old for voice input (no WebSocket in Node)")
  return new WS(url, protocols)
}

process.on("message", (raw: unknown) => {
  const m = raw as Start | StartLocal | { type: "stop" } | { type: "devices" }
  if (m?.type === "devices") {
    // Answer, then exit: a device listing is its own short-lived process.
    let reply: { kind: "devices"; devices: string[]; error?: string }
    try {
      reply = { kind: "devices", devices: pv().getAvailableDevices() }
    } catch (e) {
      reply = { kind: "devices", devices: [], error: e instanceof Error ? e.message : String(e) }
    }
    process.send?.(reply, () => process.exit(0))
    return
  }
  if (m?.type === "start" && !session) {
    const device = typeof m.deviceIndex === "number" && m.deviceIndex >= 0 ? m.deviceIndex : -1
    const recorder = () => new (pv())(FRAME, device)
    if (m.engine === "local") {
      const threads = m.threads ?? 2
      session = new LocalDictationSession({
        recorder,
        load: async () => loadEngine(m.paths, threads, log),
        emit: send,
        log,
        peakRssMb: () => process.resourceUsage().maxRSS / 1024,
      })
    } else {
      session = new DictationSession({ key: m.key, model: m.model, languages: m.languages, recorder, socket: makeSocket, emit: send })
    }
    session.start()
  } else if (m?.type === "stop") {
    if (session) session.stop()
    else process.exit(0)
  }
})

// The companion went away (window closed): stop at once.
process.on("disconnect", () => {
  session?.abort()
  process.exit(0)
})

/**
 * The recording process of the companion. Forked by the companion extension (`ELECTRON_RUN_AS_NODE`), so a crash in the
 * native recorder can never take down VS Code's extension host. It records, streams to Soniox and reports text over IPC.
 *
 * IPC in:  { type: "start", key, model, languages, deviceIndex? } | { type: "stop" } | { type: "devices" } | { type: "probe", ms }
 * IPC out: SessionUpdate ({ kind: "listening" | "heard" | "done", ... }) | { kind: "devices", devices, error? } | ProbeReport
 */
import { join } from "node:path"
import { DictationSession, type Recorder, type SessionUpdate, type Socket } from "./session"
import { SENTINEL, probeFrame, type DeviceProbe, type ProbeReport } from "./probe"

// 100 ms frames at 16 kHz: few, small WebSocket messages and low latency.
const FRAME = 1600

type Start = { type: "start"; key: string; model: string; languages: string[]; deviceIndex?: number }

let session: DictationSession | undefined

const send = (u: SessionUpdate): void => {
  process.send?.(u)
  if (u.kind === "done") setTimeout(() => process.exit(0), 100)
}

type PvRecorderClass = { new (frameLength: number, deviceIndex?: number): Recorder; getAvailableDevices(): string[] }

function pv(): PvRecorderClass {
  // Loaded lazily so a missing or broken native build is reported as a normal error. The package is shipped as files
  // next to this script (dist/pvrecorder/{dist,lib}): it finds its native binary through `__dirname/../lib/`.
  return (require(join(__dirname, "pvrecorder", "dist", "index.js")) as { PvRecorder: PvRecorderClass }).PvRecorder
}

/** The native module and the handle behind a PvRecorder, for the probe's direct reads. */
type Native = { read(handle: unknown, pcm: Int16Array): number }

/**
 * Record `ms` from every microphone and report what arrived. A sentinel fills each buffer before the native read, so
 * "the library never wrote into it" is told apart from "the driver delivered zeros". No network, no key.
 */
async function probe(ms: number): Promise<ProbeReport> {
  const PvRecorder = pv()
  const native = (PvRecorder as unknown as { _pvRecorder: Native })._pvRecorder
  const names = ["(system default)", ...PvRecorder.getAvailableDevices()]
  const devices: DeviceProbe[] = []
  for (let i = 0; i < names.length; i++) {
    const index = i - 1
    const r: DeviceProbe = { index, name: names[i]!, frames: 0, untouched: 0, zero: 0, peak: 0, statuses: [] }
    let rec: (Recorder & { _handle?: unknown }) | undefined
    try {
      rec = new PvRecorder(FRAME, index) as Recorder & { _handle?: unknown }
      r.selected = rec.getSelectedDevice?.()
      r.sampleRate = rec.sampleRate
      rec.start()
      const end = Date.now() + ms
      while (Date.now() < end) {
        const pcm = new Int16Array(FRAME).fill(SENTINEL)
        const status = native.read(rec._handle, pcm)
        probeFrame(r, status, pcm)
        await new Promise((res) => setTimeout(res, 20))
      }
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e)
    } finally {
      try { rec?.stop() } catch {}
      try { rec?.release() } catch {}
    }
    devices.push(r)
  }
  return { kind: "probe", runtime: `node ${process.versions.node}${process.versions.electron ? `, electron ${process.versions.electron}` : ""}, ${process.platform}/${process.arch}`, devices }
}

function makeSocket(url: string, protocols: string[]): Socket {
  const WS = (globalThis as { WebSocket?: new (url: string, protocols: string[]) => Socket }).WebSocket
  if (!WS) throw new Error("this VS Code is too old for voice input (no WebSocket in Node)")
  return new WS(url, protocols)
}

process.on("message", (raw: unknown) => {
  const m = raw as Start | { type: "stop" } | { type: "devices" } | { type: "probe"; ms?: number }
  if (m?.type === "probe") {
    probe(m.ms ?? 3000)
      .catch((e) => ({ kind: "probe" as const, runtime: "", devices: [], error: e instanceof Error ? e.message : String(e) }))
      .then((report) => process.send?.(report, () => process.exit(0)))
    return
  }
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
    session = new DictationSession({ key: m.key, model: m.model, languages: m.languages, recorder: () => new (pv())(FRAME, device), socket: makeSocket, emit: send })
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

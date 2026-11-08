import { SONIOX_WS_URL, applySonioxMessage, nothingHeard, pcmBytes, sonioxProtocols, sonioxStartMessage, type Heard } from "@occ/core/dictation"
import { MicCapture, emptyReason, errorText, safe, silenceMessage, type Recorder, type SessionUpdate } from "./shared"

export { SILENT_PEAK } from "./shared"
export type { Recorder, SessionUpdate } from "./shared"

/** The part of a WebSocket this session uses (the global `WebSocket` of Node 22+). */
export interface Socket {
  binaryType: string
  readyState: number
  send(data: string | Uint8Array): void
  close(code?: number): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev: unknown) => void) | null
  onclose: ((ev: { code?: number }) => void) | null
}

export type SessionOptions = {
  key: string
  model: string
  languages: string[]
  recorder: () => Recorder
  socket: (url: string, protocols: string[]) => Socket
  emit: (u: SessionUpdate) => void
  /** Stop by itself when nothing new was heard for this long (spending stops too). */
  idleMs?: number
  /** Hard cap for one recording. */
  maxMs?: number
  /** After `stop()`, wait this long for Soniox to send the last words. */
  drainMs?: number
  now?: () => number
}

const OPEN = 1

/**
 * One dictation: microphone → Soniox → text updates. Frames read before the socket opens are kept and sent once it
 * opens, so the first words are not lost. `stop()` stops recording, ends the stream with an empty text frame and waits
 * for Soniox's `finished` (or `drainMs`). Exactly one `done` is emitted.
 */
export class DictationSession {
  private heard: Heard = nothingHeard()
  private readonly mic: MicCapture
  private socket?: Socket
  private pending: Uint8Array[] = []
  private ended = false
  private stopping = false
  private lastHeard = 0
  private started = 0
  private drainTimer?: ReturnType<typeof setTimeout>
  private answers = 0
  private readonly now: () => number

  constructor(private readonly o: SessionOptions) {
    this.now = o.now ?? Date.now
    this.mic = new MicCapture(o.recorder, {
      onFrame: (frame) => this.onFrame(frame),
      onSilent: () => this.finish(silenceMessage(this.mic.device)),
      onError: (m) => this.finish(m),
    })
  }

  start(): void {
    this.started = this.lastHeard = this.now()
    const opened = this.mic.open()
    if (opened) return this.finish(opened)
    try {
      const ws = this.o.socket(SONIOX_WS_URL, sonioxProtocols(this.o.key))
      this.socket = ws
      ws.binaryType = "arraybuffer"
      ws.onopen = () => {
        ws.send(sonioxStartMessage({ model: this.o.model, languages: this.o.languages }))
        for (const chunk of this.pending) ws.send(chunk)
        this.pending = []
        if (this.stopping) ws.send("")
      }
      ws.onmessage = (ev) => this.onMessage(ev.data)
      ws.onerror = () => {
        if (!this.ended) this.finish(this.heard.error ?? "The connection to Soniox failed.")
      }
      ws.onclose = (ev) => {
        if (!this.ended) this.finish(this.heard.error ?? (this.stopping ? undefined : `Soniox closed the connection${ev?.code ? ` (${ev.code})` : ""}.`))
      }
    } catch (e) {
      return this.finish(`Could not connect to Soniox: ${errorText(e)}`)
    }
    this.o.emit({ kind: "listening", device: this.mic.device })
    void this.mic.run()
  }

  /** The user clicked the mic again (or sent the prompt). */
  stop(): void {
    if (this.ended || this.stopping) return
    this.stopping = true
    this.mic.stop()
    const ws = this.socket
    if (ws && ws.readyState === OPEN) ws.send("")
    this.drainTimer = setTimeout(() => this.finish(), this.o.drainMs ?? 4000)
  }

  /** Throw everything away now (the companion is shutting down). */
  abort(): void {
    this.finish()
  }

  get done(): boolean {
    return this.ended
  }

  private onFrame(frame: Int16Array): void {
    const bytes = pcmBytes(frame)
    const ws = this.socket
    if (ws && ws.readyState === OPEN) ws.send(bytes)
    else this.pending.push(bytes)
    const t = this.now()
    if (t - this.lastHeard > (this.o.idleMs ?? 60_000) || t - this.started > (this.o.maxMs ?? 10 * 60_000)) this.stop()
  }

  private onMessage(data: unknown): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer))
    } catch {
      return
    }
    this.answers++
    const before = this.heard
    this.heard = applySonioxMessage(this.heard, parsed)
    if (this.heard.final !== before.final || (this.heard.partial && this.heard.partial !== before.partial)) this.lastHeard = this.now()
    if (this.heard.error || this.heard.finished) return this.finish(this.heard.error)
    if (this.heard.final !== before.final || this.heard.partial !== before.partial) {
      this.o.emit({ kind: "heard", final: this.heard.final, partial: this.heard.partial })
    }
  }

  private finish(error?: string): void {
    if (this.ended) return
    this.ended = true
    if (this.drainTimer) clearTimeout(this.drainTimer)
    this.mic.release()
    const ws = this.socket
    this.socket = undefined
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
      safe(() => ws.close(1000))
    }
    // The last guess counts when the user stopped before Soniox made it final.
    const final = (this.heard.final + (error ? "" : this.heard.partial)).trim() ? this.heard.final + (error ? "" : this.heard.partial) : ""
    // Never end quietly with nothing: say why, so the user is not left guessing.
    const stats = { frames: this.mic.frames, peak: this.mic.peak, answers: this.answers, device: this.mic.device }
    if (!error && !final && this.now() - this.started > 1500) error = emptyReason(stats, "Soniox did not answer. Check the internet connection and try again.")
    this.o.emit({ kind: "done", final, error, stats })
  }
}

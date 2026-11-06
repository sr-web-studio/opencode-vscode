import {
  SAMPLE_RATE,
  SONIOX_WS_URL,
  applySonioxMessage,
  nothingHeard,
  pcmBytes,
  sonioxProtocols,
  sonioxStartMessage,
  type Heard,
} from "../core/dictation"

/** The part of a microphone recorder this session uses (`@picovoice/pvrecorder-node` in production). */
export interface Recorder {
  readonly sampleRate: number
  start(): void
  read(): Promise<Int16Array>
  stop(): void
  release(): void
  getSelectedDevice?(): string
}

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

/** What one recording received: for the log, and to tell "silent microphone" from "nothing said". */
export type SessionStats = { frames: number; peak: number; answers: number; device?: string }

export type SessionUpdate =
  | { kind: "listening"; device?: string }
  | { kind: "heard"; final: string; partial: string }
  | { kind: "done"; final: string; error?: string; stats?: SessionStats }

/**
 * A blocked or muted microphone delivers (near) digital zeros; any real microphone has a noise floor above this.
 * Checked after `SILENCE_FRAMES` frames (100 ms each), so the user is told within 2 s instead of talking to nothing.
 */
export const SILENT_PEAK = 8
export const SILENCE_FRAMES = 20

export const silenceMessage = (device?: string): string =>
  `The microphone${device ? ` “${device}”` : ""} sends only silence. On Windows, turn on Settings → Privacy & security → Microphone → “Let desktop apps access your microphone”, and check that it is not muted. Or pick another one with “OpenCode Voice: Choose Microphone”.`

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
  private recorder?: Recorder
  private socket?: Socket
  private pending: Uint8Array[] = []
  private recording = false
  private ended = false
  private stopping = false
  private lastHeard = 0
  private started = 0
  private drainTimer?: ReturnType<typeof setTimeout>
  private frames = 0
  private peak = 0
  private answers = 0
  private device?: string
  private readonly now: () => number

  constructor(private readonly o: SessionOptions) {
    this.now = o.now ?? Date.now
  }

  start(): void {
    this.started = this.lastHeard = this.now()
    try {
      this.recorder = this.o.recorder()
      if (this.recorder.sampleRate !== SAMPLE_RATE) throw new Error(`The microphone gives ${this.recorder.sampleRate} Hz audio; ${SAMPLE_RATE} Hz is needed.`)
      this.recorder.start()
      this.recording = true
    } catch (e) {
      return this.finish(`Could not open the microphone: ${errorText(e)}`)
    }
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
    this.device = safe(() => this.recorder?.getSelectedDevice?.())
    this.o.emit({ kind: "listening", device: this.device })
    void this.pump()
  }

  /** The user clicked the mic again (or sent the prompt). */
  stop(): void {
    if (this.ended || this.stopping) return
    this.stopping = true
    this.stopRecorder()
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

  private async pump(): Promise<void> {
    const idleMs = this.o.idleMs ?? 60_000
    const maxMs = this.o.maxMs ?? 10 * 60_000
    while (this.recording && !this.ended) {
      let frame: Int16Array
      try {
        frame = await this.recorder!.read()
      } catch (e) {
        if (this.recording && !this.ended) this.finish(`The microphone stopped: ${errorText(e)}`)
        return
      }
      if (!this.recording || this.ended) return
      this.frames++
      for (let i = 0; i < frame.length; i++) {
        const v = Math.abs(frame[i]!)
        if (v > this.peak) this.peak = v
      }
      if (this.frames === SILENCE_FRAMES && this.peak < SILENT_PEAK) return this.finish(silenceMessage(this.device))
      const bytes = pcmBytes(frame)
      const ws = this.socket
      if (ws && ws.readyState === OPEN) ws.send(bytes)
      else this.pending.push(bytes)
      const t = this.now()
      if (t - this.lastHeard > idleMs || t - this.started > maxMs) {
        this.stop()
        return
      }
    }
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

  private stopRecorder(): void {
    if (!this.recorder) return
    this.recording = false
    safe(() => this.recorder!.stop())
  }

  private finish(error?: string): void {
    if (this.ended) return
    this.ended = true
    if (this.drainTimer) clearTimeout(this.drainTimer)
    this.stopRecorder()
    const rec = this.recorder
    this.recorder = undefined
    // release() after any read in flight has settled.
    if (rec) setTimeout(() => safe(() => rec.release()), 50)
    const ws = this.socket
    this.socket = undefined
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
      safe(() => ws.close(1000))
    }
    // The last guess counts when the user stopped before Soniox made it final.
    const final = (this.heard.final + (error ? "" : this.heard.partial)).trim() ? this.heard.final + (error ? "" : this.heard.partial) : ""
    // Never end quietly with nothing: say why, so the user is not left guessing.
    if (!error && !final && this.now() - this.started > 1500) {
      if (this.frames === 0) error = `The microphone${this.device ? ` “${this.device}”` : ""} delivered no audio. Pick another one with “OpenCode Voice: Choose Microphone”.`
      else if (this.peak < SILENT_PEAK) error = silenceMessage(this.device)
      else if (this.answers === 0) error = "Soniox did not answer. Check the internet connection and try again."
      else error = "No words were heard. Speak a little louder or closer to the microphone, or pick another one with “OpenCode Voice: Choose Microphone”."
    }
    this.o.emit({ kind: "done", final, error, stats: { frames: this.frames, peak: this.peak, answers: this.answers, device: this.device } })
  }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error")

function safe<T>(f: () => T): T | undefined {
  try {
    return f()
  } catch {
    return undefined
  }
}

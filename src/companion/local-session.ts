import { SAMPLE_RATE, type VoiceFix } from "../core/dictation"
import { appendSegment, concatFloat32, heardText, int16ToFloat32 } from "../core/local-voice"
import { MicCapture, emptyReason, errorText, silenceMessage, type Recorder, type SessionUpdate } from "./shared"

/** One live recognition stream (a sherpa-onnx OnlineStream + its recognizer). */
export interface LocalStream {
  accept(samples: Float32Array): void
  /** Tell the stream no more audio follows (it then decodes what it still holds). */
  inputFinished(): void
  /** Decode everything that is ready. */
  decodeReady(): void
  /** The current text of the segment being spoken. */
  text(): string
  /** The recognizer's endpoint rules fired: the speaker paused. */
  endpoint(): boolean
  /** Start a fresh segment. */
  reset(): void
}

/** The loaded engine: the streaming model (live text) and the offline model (better final text). */
export interface LocalEngine {
  stream: LocalStream
  /** Decode one finished segment (16 kHz mono Float32) with the offline model. May throw. Missing: the language has no offline model. */
  offline?(samples: Float32Array): string
  /** Timings of loading, for the log. */
  loadMs?: Record<string, number>
  /** Silence fed when stopping so the last word is decoded (default 0.5 s). */
  tailSeconds?: number
  /** An endpoint that carries no words resets the stream (default yes). Nemotron must not: it then misreads the next words. */
  resetOnSilence?: boolean
}

export type LocalSessionOptions = {
  recorder: () => Recorder
  /** Load the native addon and both models. Rejects with a readable message. Called once, after the microphone started. */
  load: () => Promise<LocalEngine>
  emit: (u: SessionUpdate) => void
  /** Diagnostics for the "OpenCode Voice" output channel. */
  log?: (line: string) => void
  /** Stop by itself when nothing new was heard for this long. */
  idleMs?: number
  /** Hard cap for one recording. */
  maxMs?: number
  /** Silence fed to the stream when stopping, so the last word is flushed. */
  tailSeconds?: number
  now?: () => number
  /** Monotonic milliseconds for timings. */
  clock?: () => number
  /** Peak memory (resident set) in MB, for the log. */
  peakRssMb?: () => number
}

export const ENGINE_ERROR = "On-device voice could not start"

/**
 * One dictation with the on-device engine: microphone → streaming recognizer (live partial text) → on a pause (the
 * recognizer's endpoint) or at stop the segment's audio is decoded again with the offline model and appended to the
 * final text. Same contract as `DictationSession`: `listening`, `heard`, then exactly one `done`.
 *
 * Loading the models takes seconds and the microphone starts first: frames recorded meanwhile are kept and fed once
 * the engine is loaded, so the first words are not lost. `listening` is emitted after loading.
 */
export class LocalDictationSession {
  private engine?: LocalEngine
  private readonly mic: MicCapture
  private pending: Float32Array[] = []
  private segment: Float32Array[] = []
  private final = ""
  private partial = ""
  private segments = 0
  private ended = false
  private stopping = false
  private started = 0
  private lastHeard = 0
  private streamMs = 0
  private offlineMs = 0
  private audioSeconds = 0
  private readonly now: () => number
  private readonly clock: () => number

  constructor(private readonly o: LocalSessionOptions) {
    this.now = o.now ?? Date.now
    this.clock = o.clock ?? (() => performance.now())
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
    void this.mic.run()
    this.o.load().then(
      (engine) => this.loaded(engine),
      (e) => this.finish(`${ENGINE_ERROR}: ${errorText(e)}`, "showLog"),
    )
  }

  /** The user clicked the mic again (or sent the prompt). */
  stop(): void {
    if (this.ended || this.stopping) return
    this.stopping = true
    this.mic.stop()
    if (this.engine) this.flush()
    // Not loaded yet: `loaded()` flushes as soon as it is.
  }

  /** Throw everything away now (the companion is shutting down). */
  abort(): void {
    this.finish()
  }

  get done(): boolean {
    return this.ended
  }

  private loaded(engine: LocalEngine): void {
    if (this.ended) return
    this.engine = engine
    // The wait for the models is not "silence" for the idle timer.
    this.lastHeard = this.now()
    const pending = this.pending
    this.pending = []
    try {
      this.o.emit({ kind: "listening", device: this.mic.device })
      for (const f of pending) this.process(f)
    } catch (e) {
      return this.finish(`The on-device engine failed: ${errorText(e)}`, "showLog")
    }
    if (this.stopping) this.flush()
  }

  private onFrame(frame: Int16Array): void {
    if (this.ended) return
    const f = int16ToFloat32(frame)
    if (this.engine && !this.stopping) {
      try {
        this.process(f)
      } catch (e) {
        return this.finish(`The on-device engine failed: ${errorText(e)}`, "showLog")
      }
    } else if (!this.engine) this.pending.push(f)
    if (this.stopping || !this.engine) return
    const t = this.now()
    if (t - this.lastHeard > (this.o.idleMs ?? 60_000) || t - this.started > (this.o.maxMs ?? 10 * 60_000)) this.stop()
  }

  /** Feed one frame to the streaming recognizer and publish its text. */
  private process(f: Float32Array): void {
    const engine = this.engine!
    const t0 = this.clock()
    this.audioSeconds += f.length / SAMPLE_RATE
    this.segment.push(f)
    engine.stream.accept(f)
    engine.stream.decodeReady()
    const text = engine.stream.text().trim()
    const endpoint = engine.stream.endpoint()
    this.streamMs += this.clock() - t0
    if (text !== this.partial) {
      this.partial = text
      if (text) this.lastHeard = this.now()
      this.publish()
    }
    if (endpoint) this.endSegment()
  }

  /** The speaker paused (or stopped): turn the segment into final text. */
  private endSegment(): void {
    const engine = this.engine!
    const streamingText = engine.stream.text().trim()
    const audio = concatFloat32(this.segment)
    this.segment = []
    if (!streamingText) {
      // Silence, or noise the model did not turn into words: nothing to keep.
      this.partial = ""
      if (engine.resetOnSilence !== false) engine.stream.reset()
      return
    }
    let offlineText = ""
    let offlineError: string | undefined
    const t0 = this.clock()
    if (engine.offline) {
      try {
        offlineText = engine.offline(audio).trim()
      } catch (e) {
        offlineError = errorText(e)
      }
    }
    const ms = this.clock() - t0
    this.offlineMs += ms
    const text = offlineText || streamingText
    this.segments++
    this.final = appendSegment(this.final, text)
    this.partial = ""
    this.lastHeard = this.now()
    engine.stream.reset()
    this.o.log?.(
      engine.offline
        ? `Segment ${this.segments}: ${(audio.length / SAMPLE_RATE).toFixed(1)} s audio\n  streaming: ${streamingText}\n  offline:   ${offlineError ? `FAILED (${offlineError}); used the streaming text` : offlineText || "(empty; used the streaming text)"}\n  offline decode ${ms.toFixed(0)} ms`
        : `Segment ${this.segments}: ${(audio.length / SAMPLE_RATE).toFixed(1)} s audio\n  streaming: ${streamingText}\n  (this language has no offline model)`,
    )
    this.publish()
  }

  private publish(): void {
    const h = heardText(this.final, this.partial)
    this.o.emit({ kind: "heard", final: h.final, partial: h.partial })
  }

  /** After stop: push a little silence so the last word is decoded, finish the stream, re-decode the last segment. */
  private flush(): void {
    if (this.ended) return
    try {
      const engine = this.engine!
      const t0 = this.clock()
      engine.stream.accept(new Float32Array(Math.round((this.o.tailSeconds ?? engine.tailSeconds ?? 0.5) * SAMPLE_RATE)))
      engine.stream.inputFinished()
      engine.stream.decodeReady()
      this.streamMs += this.clock() - t0
      this.partial = engine.stream.text().trim()
      this.endSegment()
    } catch (e) {
      return this.finish(`The on-device engine failed: ${errorText(e)}`, "showLog")
    }
    this.finish()
  }

  private finish(error?: string, fix?: VoiceFix): void {
    if (this.ended) return
    this.ended = true
    this.mic.release()
    // The last guess counts when something stopped us before it was made final.
    const final = error ? this.final : appendSegment(this.final, this.partial)
    const stats = { frames: this.mic.frames, peak: this.mic.peak, answers: this.segments, device: this.mic.device }
    if (!error && !final && this.now() - this.started > 1500) error = emptyReason(stats)
    const rtf = this.audioSeconds > 0 ? (this.streamMs + this.offlineMs) / 1000 / this.audioSeconds : 0
    this.o.log?.(
      `Recording ended: ${this.audioSeconds.toFixed(1)} s audio, ${this.segments} segments; streaming ${this.streamMs.toFixed(0)} ms + offline ${this.offlineMs.toFixed(0)} ms; RTF ${rtf.toFixed(3)}; peak RSS ${(this.o.peakRssMb?.() ?? 0).toFixed(0)} MB`,
    )
    this.o.emit({ kind: "done", final, error, ...(error && fix ? { fix } : {}), stats })
  }
}

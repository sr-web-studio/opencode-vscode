import { SAMPLE_RATE, type VoiceFix } from "../core/dictation"

/** The part of a microphone recorder a session uses (`@picovoice/pvrecorder-node` in production). */
export interface Recorder {
  readonly sampleRate: number
  start(): void
  read(): Promise<Int16Array>
  stop(): void
  release(): void
  getSelectedDevice?(): string
}

/** What one recording received: for the log, and to tell "silent microphone" from "nothing said". */
export type SessionStats = { frames: number; peak: number; answers: number; device?: string }

export type SessionUpdate =
  | { kind: "listening"; device?: string }
  | { kind: "heard"; final: string; partial: string }
  | { kind: "done"; final: string; error?: string; fix?: VoiceFix; stats?: SessionStats }

/**
 * A blocked or muted microphone delivers (near) digital zeros; any real microphone has a noise floor above this.
 * Checked after `SILENCE_FRAMES` frames (100 ms each), so the user is told within 2 s instead of talking to nothing.
 */
export const SILENT_PEAK = 8
export const SILENCE_FRAMES = 20

export const silenceMessage = (device?: string): string =>
  `The microphone${device ? ` “${device}”` : ""} sends only silence. Check that it is not muted (mute key, headset switch, or Windows Sound settings), or pick another one with “Choose Microphone”.`

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error")

export function safe<T>(f: () => T): T | undefined {
  try {
    return f()
  } catch {
    return undefined
  }
}

/**
 * Why a recording that heard nothing ended empty, so the user is never left guessing. `engineSilent` is the sentence
 * for "audio arrived but the engine never answered" (undefined for engines that always answer, like the local one).
 */
export function emptyReason(s: { frames: number; peak: number; answers: number; device?: string }, engineSilent?: string): string {
  if (s.frames === 0) return `The microphone${s.device ? ` “${s.device}”` : ""} delivered no audio. Pick another one with “OpenCode Voice: Choose Microphone”.`
  if (s.peak < SILENT_PEAK) return silenceMessage(s.device)
  if (s.answers === 0 && engineSilent) return engineSilent
  return "No words were heard. Speak a little louder or closer to the microphone, or pick another one with “OpenCode Voice: Choose Microphone”."
}

/**
 * The microphone half of a session: opens the recorder, reads 100 ms frames, measures the level and reports a silent
 * microphone after `SILENCE_FRAMES`. Shared by the Soniox and the on-device session.
 */
export class MicCapture {
  frames = 0
  peak = 0
  device?: string
  private recorder?: Recorder
  private active = false

  constructor(
    private readonly make: () => Recorder,
    private readonly h: {
      onFrame(frame: Int16Array): void
      /** The microphone sent only silence for the first `SILENCE_FRAMES` frames. */
      onSilent(): void
      onError(message: string): void
    },
  ) {}

  get recording(): boolean {
    return this.active
  }

  /** Start the recorder. Returns an error text instead of throwing. */
  open(): string | undefined {
    try {
      const r = this.make()
      this.recorder = r
      if (r.sampleRate !== SAMPLE_RATE) throw new Error(`The microphone gives ${r.sampleRate} Hz audio; ${SAMPLE_RATE} Hz is needed.`)
      r.start()
      this.active = true
      this.device = safe(() => r.getSelectedDevice?.())
      return undefined
    } catch (e) {
      return `Could not open the microphone: ${errorText(e)}`
    }
  }

  /** Read frames until stopped. Never throws. */
  async run(): Promise<void> {
    while (this.active) {
      let frame: Int16Array
      try {
        frame = await this.recorder!.read()
      } catch (e) {
        if (this.active) this.h.onError(`The microphone stopped: ${errorText(e)}`)
        return
      }
      if (!this.active) return
      this.frames++
      for (let i = 0; i < frame.length; i++) {
        const v = Math.abs(frame[i]!)
        if (v > this.peak) this.peak = v
      }
      if (this.frames === SILENCE_FRAMES && this.peak < SILENT_PEAK) return this.h.onSilent()
      this.h.onFrame(frame)
    }
  }

  /** Stop recording; a frame still being read is dropped. */
  stop(): void {
    if (!this.recorder) return
    this.active = false
    safe(() => this.recorder!.stop())
  }

  /** Stop and free the device (after any read in flight has settled). */
  release(): void {
    this.stop()
    const rec = this.recorder
    this.recorder = undefined
    if (rec) setTimeout(() => safe(() => rec.release()), 50)
  }
}

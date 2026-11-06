/**
 * Dictation over Soniox real-time speech-to-text. Pure: shared by the companion extension (which records and talks to
 * Soniox), the main extension (which forwards text to the prompt box) and, later, mobile.
 *
 * Protocol (soniox.com/docs/stt/api-reference/websocket-api, checked 2026-11-06):
 * - connect to `SONIOX_WS_URL` with the key as WebSocket subprotocols `["soniox-api-key", key]` (the `api_key` field in
 *   the start message is deprecated and stops working on 2027-01-15);
 * - send the start message as text, then raw PCM as binary frames; an empty text frame ends the stream;
 * - every answer carries `tokens`: final tokens arrive once, non-final tokens are replaced by the next answer.
 */

export const SONIOX_WS_URL = "wss://stt-rt.soniox.com/transcribe-websocket"
export const SONIOX_MODEL = "stt-rt-v6"
export const DEFAULT_LANGUAGES = ["bn", "en"]
export const SAMPLE_RATE = 16_000

/** Subprotocols that carry the key at connect time. */
export const sonioxProtocols = (key: string): string[] => ["soniox-api-key", key]

export function sonioxStartMessage(opts: { model?: string; languages?: string[]; sampleRate?: number } = {}): string {
  return JSON.stringify({
    model: opts.model || SONIOX_MODEL,
    audio_format: "pcm_s16le",
    sample_rate: opts.sampleRate ?? SAMPLE_RATE,
    num_channels: 1,
    language_hints: opts.languages?.length ? opts.languages : DEFAULT_LANGUAGES,
    enable_endpoint_detection: true,
  })
}

/** Text heard so far: `final` never changes once added; `partial` is the current guess for what follows. */
export type Heard = { final: string; partial: string; finished: boolean; error?: string }

export const nothingHeard = (): Heard => ({ final: "", partial: "", finished: false })

/** Markers Soniox puts in the token stream (endpoint, manual finalize). Never shown. */
const MARKERS = new Set(["<end>", "<fin>"])

/** Apply one Soniox answer (already JSON-parsed). Unknown shapes leave the state unchanged. */
export function applySonioxMessage(state: Heard, message: unknown): Heard {
  const m = message as { tokens?: unknown; finished?: unknown; error_message?: unknown; error_type?: unknown; error_code?: unknown }
  if (!m || typeof m !== "object") return state
  if (m.error_message || m.error_type || m.error_code) {
    return { ...state, partial: "", finished: true, error: sonioxErrorText(m.error_type, m.error_code, m.error_message) }
  }
  let final = state.final
  let partial = ""
  if (Array.isArray(m.tokens)) {
    for (const t of m.tokens as Array<{ text?: unknown; is_final?: unknown }>) {
      const text = typeof t?.text === "string" ? t.text : ""
      if (!text || MARKERS.has(text)) continue
      if (t.is_final) final += text
      else partial += text
    }
  }
  const finished = m.finished === true
  return { final, partial: finished ? "" : partial, finished: state.finished || finished, error: state.error }
}

function sonioxErrorText(type: unknown, code: unknown, message: unknown): string {
  const t = typeof type === "string" ? type : ""
  if (t === "unauthenticated" || code === 401) return "Soniox rejected the voice key. Set it again with “OpenCode: Set Voice API Key”."
  if (code === 402) return "Your Soniox balance is too low. Top up at console.soniox.com."
  if (t === "request_timeout" || code === 408) return "No audio reached Soniox for a while, so it stopped listening."
  if (code === 429) return "Soniox is limiting this key right now. Try again in a minute."
  const msg = typeof message === "string" && message ? message : t || "unknown error"
  return `Soniox: ${msg}`
}

/** What dictation adds to the prompt box right now: the heard text with leading whitespace trimmed. */
export const spokenText = (h: Heard): string => (h.final + h.partial).replace(/^\s+/, "")

/**
 * Put dictated text into the prompt box. `shown` is what the previous update inserted (the box ends with it unless the
 * user typed meanwhile); `next` replaces it. When the user edited the end of the box, only the newly heard part is
 * appended so nothing they typed is lost. A space separates dictation from text before it.
 */
export function mergeDictation(box: string, shown: string, next: string): { text: string; shown: string } {
  if (shown && box.endsWith(shown)) return { text: box.slice(0, box.length - shown.length) + next, shown: next }
  let add = next
  if (shown) {
    let i = 0
    while (i < shown.length && i < next.length && shown[i] === next[i]) i++
    add = next.slice(i)
  }
  if (!add) return { text: box, shown: "" }
  const sep = box && !/\s$/.test(box) && !/^\s/.test(add) ? " " : ""
  return { text: box + sep + add, shown: sep + add }
}

/** Little-endian 16-bit PCM bytes of one recorder frame. */
export function pcmBytes(frame: Int16Array): Uint8Array {
  const out = new Uint8Array(frame.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < frame.length; i++) view.setInt16(i * 2, frame[i]!, true)
  return out
}

/* ---------------------------------------------------- companion ⇄ main extension */

/** Commands of the companion extension (runs where the UI runs: the user's laptop). Arguments must be plain JSON. */
export const COMPANION = {
  ping: "opencode.companion.ping",
  start: "opencode.companion.voice.start",
  stop: "opencode.companion.voice.stop",
} as const

/** The main extension's command that receives dictation updates from the companion. */
export const VOICE_FEED_COMMAND = "opencode.voice.feed"

export type CompanionInfo = { version: string; capture: boolean; problem?: string }

export type VoiceStartArgs = {
  /** Correlates feed updates with this recording. */
  id: string
  /** A short-lived Soniox key minted by the main extension; the user's own key never leaves it. */
  key: string
  model: string
  languages: string[]
}

/** One update from the companion. `heard` is cumulative for the recording `id`. */
export type VoiceFeed =
  | { id: string; kind: "listening"; device?: string }
  | { id: string; kind: "heard"; final: string; partial: string }
  | { id: string; kind: "done"; final: string; error?: string }

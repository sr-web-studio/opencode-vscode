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
  /** Open the operating system's microphone privacy page (Windows, macOS). */
  micSettings: "opencode.companion.voice.micSettings",
  chooseMicrophone: "opencode.companion.voice.chooseMicrophone",
  /** Show the companion's "OpenCode Voice" output channel (diagnostics of the on-device engine). */
  showLog: "opencode.companion.voice.showLog",
  /** Ask the operating system to draw attention to this window (taskbar flash). Argument: `AttentionRequest`. */
  attention: "opencode.companion.attention",
  /** Palette command of the companion: waits 5 s, then asks for attention (to test it from another window). */
  testAttention: "opencode.companion.testAttention",
} as const

/** Which engine turns speech into text: on this computer (free, offline) or Soniox (cloud, the user's own key). */
export type VoiceEngine = "local" | "soniox"
export const DEFAULT_ENGINE: VoiceEngine = "local"
export const normalizeEngine = (raw: unknown): VoiceEngine => (raw === "soniox" ? "soniox" : DEFAULT_ENGINE)

/** What the user can do about a failed recording; the main extension turns it into a button. */
export type VoiceFix = "micSettings" | "chooseMicrophone" | "showLog"

/** The main extension's command that receives dictation updates from the companion. */
export const VOICE_FEED_COMMAND = "opencode.voice.feed"

/**
 * Whether version `a` is newer than `b` (`major.minor.patch`, numeric parts; anything after `-` or `+` is ignored).
 * An unreadable `b` counts as older, an unreadable `a` as not newer. Used so the companion is only ever upgraded:
 * two installed copies of the main extension (e.g. an old ID next to the new one) must not keep reinstalling their
 * own companion over each other.
 */
export function isNewerVersion(a: string, b: string): boolean {
  const parse = (v: string): { core: number[]; pre: string[] } | undefined => {
    const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?\s*$/.exec(v)
    return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] } : undefined
  }
  const x = parse(a)
  if (!x) return false
  const y = parse(b)
  if (!y) return true
  for (let i = 0; i < 3; i++) {
    const p = x.core[i] ?? 0
    const q = y.core[i] ?? 0
    if (p !== q) return p > q
  }
  return comparePrerelease(x.pre, y.pre) > 0
}

/** Semver precedence of prerelease parts: none ranks above any (`0.3.7` > `0.3.7-test.11`), numbers compare as numbers. */
function comparePrerelease(a: string[], b: string[]): number {
  if (!a.length || !b.length) return a.length === b.length ? 0 : a.length ? -1 : 1
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const p = a[i]
    const q = b[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) - Number(q)
    if (pn !== qn) return pn ? -1 : 1
    return p < q ? -1 : 1
  }
  return 0
}

/** `local`: this computer has a build of the on-device engine (the microphone may work without it). */
export type CompanionInfo = {
  version: string
  capture: boolean
  problem?: string
  local?: boolean
  localProblem?: string
  /**
   * On-device language packs fully downloaded on this computer (ids from the catalog). Missing in older versions and
   * when unknown: then nothing is shown as downloaded.
   */
  installedLanguages?: string[]
}

export type VoiceStartArgs = {
  /** Correlates feed updates with this recording. */
  id: string
  /** Missing means `soniox` (older callers). */
  engine?: VoiceEngine
  /** soniox only: a short-lived key minted by the main extension; the user's own key never leaves it. */
  key?: string
  /** soniox only. */
  model?: string
  languages: string[]
  /** local only: threads per recognizer. */
  threads?: number
  /** local only: the language to speak (a catalog id: the first of `opencode.voice.localLanguages`). Missing (older callers) means the default language. */
  localLanguage?: string
}

/** One update from the companion. `heard` is cumulative for the recording `id`. */
export type VoiceFeed =
  | { id: string; kind: "listening"; device?: string }
  | { id: string; kind: "heard"; final: string; partial: string }
  | { id: string; kind: "done"; final: string; error?: string; fix?: VoiceFix; stats?: { frames: number; peak: number; answers: number; device?: string } }

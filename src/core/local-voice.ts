/**
 * The on-device ("local") voice engine: what is downloaded, from where, and the small pure helpers around it.
 * Pure (no `vscode`, no `node:*`): the companion extension does the downloading and the recognizing.
 *
 * Engine: sherpa-onnx (Apache-2.0), npm `sherpa-onnx-<platform>-<arch>` 2.0.1 (the native addon + onnxruntime).
 * Models: language packs (the multilingual Nemotron model for most languages; a Bangla pack with a streaming model for
 * live text and an offline model that re-decodes each segment at a pause), see `voice-catalog.ts`.
 * Every file is pinned to a revision and verified by size and SHA-256 (npm tarballs: by the registry's SHA-512 integrity).
 */
import type { VoiceEngine, VoiceStartArgs } from "./dictation"
import { normalizeLanguage, type ModelKind, type ModelRole } from "./voice-catalog"

export const SHERPA_VERSION = "2.0.1"

/** Folder under the companion's global storage. Bump when the layout or the pinned files change. */
export const LOCAL_ROOT = "local-voice/v1"

export type SherpaTarget = {
  /** npm package name (also its folder name). */
  pkg: string
  url: string
  /** Subresource-integrity string of the tarball, as in the registry's `dist.integrity`. */
  integrity: string
  /** Tarball size in bytes (for progress; the integrity is what is trusted). */
  bytes: number
}

const sherpa = (plat: string, integrity: string, bytes: number): SherpaTarget => {
  const pkg = `sherpa-onnx-${plat}`
  return { pkg, url: `https://registry.npmjs.org/${pkg}/-/${pkg}-${SHERPA_VERSION}.tgz`, integrity, bytes }
}

/** Keyed by `process.platform/process.arch`. The npm package for Windows is `win-*` (not `win32-*`). */
const TARGETS: Record<string, SherpaTarget> = {
  "win32/x64": sherpa("win-x64", "sha512-7vwdAw9PGEb0JLSpK7UFxAdp1vabBHK9Nhw2jFRBWSFgtslUPHIB0T6syJfRgiUGyCeNW9fJvcFAk2F2u7hBEw==", 8_779_375),
  "win32/arm64": sherpa("win-arm64", "sha512-Mb9iqy2Zp7GC5a99dk5E8EQJsEBnapf+IcwHLVCgtIf5mxYHO9Q8YptnAoOHZOD0Zi+R+MblFyG9qv0Q6tin4Q==", 8_486_399),
  "darwin/x64": sherpa("darwin-x64", "sha512-SBnHa3LDOSI/5/rpBHGxKQDFq+yIdxowYY0InLzfojTUx+yGgqu7cYBrRxjzvHOiOKi0O4rmlFVZboyhIqpDgA==", 11_167_483),
  "darwin/arm64": sherpa("darwin-arm64", "sha512-agXmbbwiVPUSMViMhWhYAt59iG21ui7x6HxQFU35XzHOfQe9x6Pg9V160Pzak/66x0ePMjixsLUtMaaUrLfCwQ==", 10_013_200),
  "linux/x64": sherpa("linux-x64", "sha512-w5mRRrIvPvcNWac7rQ8AN/t/cwElPGoRpH+ceCRBV7XfjCIQ9Rcr3Ig/kXcJLNOxgK4bGmef+Y47lIWiesDODw==", 11_005_484),
  "linux/arm64": sherpa("linux-arm64", "sha512-5CJvLjFYIg23oELCsT7l07fMLT3PdquZ3tqh7KZK3Pzi+c2YiPKRe1DDUxoNdtCaw3ZiS4aQSQPBblB9JStuDA==", 13_822_449),
}

/** The native engine package for this platform, or undefined when there is none. */
export const sherpaTarget = (platform: string, arch: string): SherpaTarget | undefined => TARGETS[`${platform}/${arch}`]

export const SHERPA_PLATFORMS: readonly string[] = Object.keys(TARGETS)

/* The models and the language catalog are in `voice-catalog.ts`. */

/** Where one model lives on disk: its kind, feature size and the absolute path of each file by role (what the recognizers are configured with). */
export type ModelPaths = { kind: ModelKind; featureDim: number; files: Partial<Record<ModelRole, string>> }

/** What the recorder process needs to run the local engine for one language. */
export type LocalPaths = {
  nativeDir: string
  /** Language id (for the log). */
  language: string
  /** Pack id (for the log). */
  pack: string
  /** Multilingual model: the value of each stream's `language` option (`es-US`, `auto`). Missing: the model has one language. */
  locale?: string
  streaming: ModelPaths
  /** Missing: the streaming text is final. */
  offline?: ModelPaths
  /** Seconds of silence fed when stopping (see `ModelSpec.tailSeconds`). */
  tailSeconds?: number
}

/* ------------------------------------------------------------ audio */

/** Recorder frames (Int16) as the recognizers want them: Float32 in [-1, 1). */
export function int16ToFloat32(frame: Int16Array): Float32Array {
  const out = new Float32Array(frame.length)
  for (let i = 0; i < frame.length; i++) out[i] = frame[i]! / 32768
  return out
}

export function concatFloat32(parts: Float32Array[]): Float32Array {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Float32Array(n)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/* ------------------------------------------------------------ text */

/** Add one finished segment to the final text: space-separated, nothing for an empty segment. */
export function appendSegment(final: string, segment: string): string {
  const s = segment.trim()
  if (!s) return final
  return final ? `${final} ${s}` : s
}

/**
 * What a `heard` update carries: the finished segments, and the current guess for the one being spoken (with the
 * separating space in front, so `final + partial` reads right).
 */
export const heardText = (final: string, partial: string): { final: string; partial: string } => {
  const p = partial.trim()
  return { final, partial: p ? (final ? " " : "") + p : "" }
}

/* ------------------------------------------------------------ state */

export type CompanionFacts = { capture: boolean; local?: boolean } | undefined

/**
 * Can a click on the mic start dictation? Local: yes unless the companion says this computer has no local engine
 * (before the companion answers the button stays usable: the click installs it). Soniox: only with a saved key.
 */
export function voiceReady(engine: VoiceEngine, keySet: boolean, info: CompanionFacts): boolean {
  if (engine === "soniox") return keySet
  return info ? info.local === true : true
}

type MicView = { engine: VoiceEngine; ready: boolean; recording: "off" | "starting" | "on" | "stopping" }

/** Tooltip of the mic button. */
export function micTitle(v: MicView): string {
  if (!v.ready) {
    return v.engine === "soniox"
      ? "Voice input is off: click to add your Soniox API key"
      : "On-device voice is not available on this computer. Set opencode.voice.engine to soniox to use the cloud engine."
  }
  if (v.recording === "on") return "Listening: click to stop"
  if (v.recording === "starting") return "Starting the microphone… (click to cancel)"
  if (v.recording === "stopping") return "Finishing the last words…"
  return v.engine === "local" ? "Voice input (on-device)" : "Voice input"
}

/** Accessible name of the mic button. */
export function micLabel(v: MicView): string {
  if (!v.ready) return v.engine === "soniox" ? "Voice input (set API key)" : "Voice input (not available on this computer)"
  if (v.recording !== "off") return "Stop voice input"
  return v.engine === "local" ? "Voice input (on-device)" : "Voice input"
}

/**
 * The arguments of `opencode.companion.voice.start` for the chosen engine. Local sends no key and no model name, only
 * the language pack id (`opencode.voice.localLanguage`, normalized: unknown → the default language).
 */
export function startArgs(o: {
  id: string
  engine: VoiceEngine
  languages: string[]
  /** Local engine: the language pack. */
  localLanguage?: unknown
  threads?: number
  soniox?: { key: string; model: string }
}): VoiceStartArgs {
  if (o.engine === "soniox") {
    if (!o.soniox) throw new Error("The Soniox engine needs a key")
    return { id: o.id, engine: "soniox", key: o.soniox.key, model: o.soniox.model, languages: o.languages }
  }
  return { id: o.id, engine: "local", languages: o.languages, localLanguage: normalizeLanguage(o.localLanguage), threads: clampThreads(o.threads) }
}

export const DEFAULT_THREADS = 2

export function clampThreads(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(8, Math.max(1, Math.round(n))) : DEFAULT_THREADS
}


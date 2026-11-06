/**
 * The on-device ("local") voice engine: what is downloaded, from where, and the small pure helpers around it.
 * Pure (no `vscode`, no `node:*`): the companion extension does the downloading and the recognizing.
 *
 * Engine: sherpa-onnx (Apache-2.0), npm `sherpa-onnx-<platform>-<arch>` 2.0.1 (the native addon + onnxruntime).
 * Streaming model (live partial text): Vosk small streaming Bangla Zipformer, Apache-2.0.
 * Final re-decode model (better words, adds punctuation): SayedShaun/bangla-zipformer-onnx, CC-BY-SA-4.0.
 * Every file is pinned to a revision and verified by size and SHA-256 (npm tarballs: by the registry's SHA-512 integrity).
 */
import type { VoiceEngine, VoiceStartArgs } from "./dictation"

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

export type ModelFile = { path: string; name: string; size: number; sha256: string }
export type ModelSpec = { id: string; repo: string; rev: string; files: ModelFile[] }

export const STREAMING_MODEL: ModelSpec = {
  id: "streaming-bn-vosk-501097a",
  repo: "alphacep/vosk-model-small-streaming-bn",
  rev: "501097ae5257e5859d7956b50e4ba53a3f2be106",
  files: [
    { path: "am-onnx/encoder.onnx", name: "encoder.onnx", size: 90_994_145, sha256: "779f2412d6fa56f76be9fe71349cdf3edd10434ae9b1fc5e49834fb904320516" },
    { path: "am-onnx/decoder.onnx", name: "decoder.onnx", size: 2_093_080, sha256: "fc03e8ca154593b95748198a56de115d4e6048d97c41692f93dfefb05f3693b4" },
    { path: "am-onnx/joiner.onnx", name: "joiner.onnx", size: 1_026_462, sha256: "1df7319f4f9c36d7130cacaf629e1d52e904070e7a14bca9d4f209edeb162da6" },
    { path: "lang/tokens.txt", name: "tokens.txt", size: 6_252, sha256: "6f3a4d64d7da07e7dd7f3fd679e07607be3ec149d1b807726dbb8bbcc80a9fe1" },
  ],
}

/** CC-BY-SA-4.0, © Sayed Shaun: attribution is in `companion/NOTICE`, the README and docs/local-voice.md. */
export const OFFLINE_MODEL: ModelSpec = {
  id: "offline-bn-sayed-16bec01",
  repo: "SayedShaun/bangla-zipformer-onnx",
  rev: "16bec01c5f554d3f0dc8f0139de3a00839a72efc",
  files: [
    { path: "int8/encoder.onnx", name: "encoder.onnx", size: 72_828_389, sha256: "43d5bdfc8e956c8137b8652fca347a4deb8ae6742cc0a2840db47c02a5c4cd4a" },
    { path: "int8/decoder.onnx", name: "decoder.onnx", size: 540_689, sha256: "a183a765346a050c8577dc947cb96e69beecb8a83a73ebef48ad0cdd387e18df" },
    { path: "int8/joiner.onnx", name: "joiner.onnx", size: 259_417, sha256: "bd9d5b3a02b0550fc09e55f222dce6ac72d38396b5c5087c462d67d0cb840fb4" },
    { path: "tokens.txt", name: "tokens.txt", size: 6_578, sha256: "8edb5b3ef2587207c86cc3966f3f729ec3845250d3b040e5ba916ce935fcae2b" },
  ],
}

export const modelUrl = (m: ModelSpec, f: ModelFile): string => `https://huggingface.co/${m.repo}/resolve/${m.rev}/${f.path}`

export const modelBytes = (m: ModelSpec): number => m.files.reduce((n, f) => n + f.size, 0)

/** Everything one local install downloads for `target`, in bytes (shown to the user as MB). */
export const downloadBytes = (target: SherpaTarget): number => target.bytes + modelBytes(STREAMING_MODEL) + modelBytes(OFFLINE_MODEL)

export const megabytes = (bytes: number): string => (bytes / 1e6).toFixed(bytes < 10e6 ? 1 : 0)

/** Where the models live on disk, as absolute file paths (what the recognizers are configured with). */
export type ModelPaths = { encoder: string; decoder: string; joiner: string; tokens: string }

/** What the recorder process needs to run the local engine. */
export type LocalPaths = { nativeDir: string; streaming: ModelPaths; offline: ModelPaths }

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

/** The arguments of `opencode.companion.voice.start` for the chosen engine. Local sends no key and no model name. */
export function startArgs(o: {
  id: string
  engine: VoiceEngine
  languages: string[]
  threads?: number
  soniox?: { key: string; model: string }
}): VoiceStartArgs {
  if (o.engine === "soniox") {
    if (!o.soniox) throw new Error("The Soniox engine needs a key")
    return { id: o.id, engine: "soniox", key: o.soniox.key, model: o.soniox.model, languages: o.languages }
  }
  return { id: o.id, engine: "local", languages: o.languages, threads: clampThreads(o.threads) }
}

export const DEFAULT_THREADS = 2

export function clampThreads(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(8, Math.max(1, Math.round(n))) : DEFAULT_THREADS
}

/** Local understands Bangla only (this build): true when the user's languages include it (or list nothing). */
export const localUnderstands = (languages: string[]): boolean => languages.length === 0 || languages.some((l) => l.trim().toLowerCase().split(/[-_]/)[0] === "bn")

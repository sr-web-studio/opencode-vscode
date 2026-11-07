/**
 * The few calls of the sherpa-onnx native addon the on-device engine needs, wrapped like the `sherpa-onnx-node`
 * package does, but loading `sherpa-onnx.node` from an absolute path (the folder the companion downloaded it to)
 * instead of searching `node_modules`. This is why nothing from sherpa ships in the vsix.
 */
import { join } from "node:path"
import type { ModelPaths, LocalPaths } from "../core/local-voice"
import { STREAMING_KINDS, type ModelRole } from "../core/voice-catalog"
import { errorText } from "./shared"
import type { LocalEngine, LocalStream } from "./local-session"

/** The addon functions used here (handles are opaque). Everything else the addon exports is ignored. */
interface Addon {
  version?: string
  onnxruntimeVersion?: string
  createOnlineRecognizer(config: unknown): unknown
  createOnlineStream(recognizer: unknown): unknown
  /** sherpa-onnx 2.0.1: per-stream options (`language` for multilingual Nemotron). */
  onlineStreamSetOption?(stream: unknown, key: string, value: string): void
  acceptWaveformOnline(stream: unknown, wave: { samples: Float32Array; sampleRate: number }): void
  inputFinished(stream: unknown): void
  isOnlineStreamReady(recognizer: unknown, stream: unknown): boolean
  decodeOnlineStream(recognizer: unknown, stream: unknown): void
  getOnlineStreamResultAsJson(recognizer: unknown, stream: unknown): string
  isEndpoint(recognizer: unknown, stream: unknown): boolean
  reset(recognizer: unknown, stream: unknown): void
  createOfflineRecognizer(config: unknown): unknown
  createOfflineStream(recognizer: unknown): unknown
  acceptWaveformOffline(stream: unknown, wave: { samples: Float32Array; sampleRate: number }): void
  decodeOfflineStream(recognizer: unknown, stream: unknown): void
  getOfflineStreamResultAsJson(stream: unknown): string
}

const sampleRate = 16000

/** Environment variable the OS searches for the addon's shared libraries (next to the addon is searched anyway). */
export function libraryPathVar(platform: string): "PATH" | "LD_LIBRARY_PATH" | "DYLD_LIBRARY_PATH" {
  return platform === "win32" ? "PATH" : platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH"
}

/** `env` with the native folder first in the library search path of this platform. */
export function envWithNative(env: NodeJS.ProcessEnv, nativeDir: string, platform: string): NodeJS.ProcessEnv {
  const key = libraryPathVar(platform)
  const sep = platform === "win32" ? ";" : ":"
  // Windows environment names are case-insensitive: keep the spelling that is already there ("Path").
  const existing = Object.keys(env).find((k) => (platform === "win32" ? k.toUpperCase() === key : k === key)) ?? key
  const old = env[existing]
  return { ...env, [existing]: old ? `${nativeDir}${sep}${old}` : nativeDir }
}

export function loadAddon(nativeDir: string, log: (line: string) => void): Addon {
  const file = join(nativeDir, "sherpa-onnx.node")
  const t0 = performance.now()
  try {
    const addon = require(file) as Addon
    log(`Native addon loaded from ${file} in ${(performance.now() - t0).toFixed(0)} ms (sherpa-onnx ${addon.version ?? "?"}, onnxruntime ${addon.onnxruntimeVersion ?? "?"})`)
    return addon
  } catch (e) {
    const libVar = libraryPathVar(process.platform)
    const detail = e instanceof Error ? (e.stack ?? e.message) : String(e)
    log(`FAILED to load the native addon.\n  tried: ${file}\n  ${libVar}=${process.env[libVar] ?? "(unset)"}\n  ${detail}`)
    throw new Error(`the speech engine could not be loaded (${errorText(e).split("\n")[0]})`, { cause: e })
  }
}

/**
 * The `modelConfig` fields of one model, by kind. A new sherpa-onnx model family is one more case here (and one more
 * `ModelKind` + its required roles in `src/core/voice-catalog.ts`).
 */
export function modelConfig(m: ModelPaths, threads: number): Record<string, unknown> {
  const f = m.files as Record<ModelRole, string>
  const common = { tokens: f.tokens, numThreads: threads, provider: "cpu", debug: 0 }
  switch (m.kind) {
    case "transducer":
      return { transducer: { encoder: f.encoder, decoder: f.decoder, joiner: f.joiner }, ...common }
    default:
      throw new Error(`model kind ${String((m as ModelPaths).kind)} is not supported by this build`)
  }
}

/** `featConfig` of one model: 16 kHz and the model's own filter-bank size (Nemotron 128, the others 80). */
export const featConfig = (m: ModelPaths): { sampleRate: number; featureDim: number } => ({ sampleRate, featureDim: m.featureDim })

/** Load the addon and the recognizers of one language. Timings go to `log`. */
export function loadEngine(paths: LocalPaths, threads: number, log: (line: string) => void): LocalEngine {
  const loadMs: Record<string, number> = {}
  const t0 = performance.now()
  const addon = loadAddon(paths.nativeDir, log)
  loadMs.addon = performance.now() - t0
  if (!STREAMING_KINDS.includes(paths.streaming.kind)) throw new Error(`the live model of ${paths.language} (${paths.streaming.kind}) cannot stream`)

  const t1 = performance.now()
  const online = addon.createOnlineRecognizer({
    featConfig: featConfig(paths.streaming),
    modelConfig: modelConfig(paths.streaming, threads),
    decodingMethod: "greedy_search",
    enableEndpoint: true,
  })
  loadMs.streaming = performance.now() - t1
  log(`Language ${paths.language} (pack ${paths.pack}): streaming model (${paths.streaming.kind}, ${paths.streaming.featureDim} features) loaded in ${loadMs.streaming.toFixed(0)} ms (${threads} threads)`)

  let offline: unknown
  if (paths.offline) {
    const t2 = performance.now()
    offline = addon.createOfflineRecognizer({
      featConfig: featConfig(paths.offline),
      modelConfig: modelConfig(paths.offline, threads),
      decodingMethod: "greedy_search",
    })
    loadMs.offline = performance.now() - t2
    log(`Offline model (${paths.offline.kind}) loaded in ${loadMs.offline.toFixed(0)} ms (${threads} threads)`)
  }

  const handle = addon.createOnlineStream(online)
  if (paths.locale) {
    // Multilingual Nemotron: the language is a per-stream option, read on every decode call. It survives `reset()`.
    // Source: sherpa-onnx v2.0.1 nodejs-addon-examples/test_asr_streaming_nemotron.js (`stream.setOption('language', …)`).
    if (!addon.onlineStreamSetOption) throw new Error("this speech engine cannot select a language (it needs sherpa-onnx 2.0.1 or newer)")
    addon.onlineStreamSetOption(handle, "language", paths.locale)
    log(`Spoken language: ${paths.language} → model locale ${paths.locale}`)
  }
  const stream: LocalStream = {
    accept: (samples) => addon.acceptWaveformOnline(handle, { samples, sampleRate }),
    inputFinished: () => addon.inputFinished(handle),
    decodeReady: () => {
      while (addon.isOnlineStreamReady(online, handle)) addon.decodeOnlineStream(online, handle)
    },
    text: () => (JSON.parse(addon.getOnlineStreamResultAsJson(online, handle)) as { text?: string }).text ?? "",
    endpoint: () => !!addon.isEndpoint(online, handle),
    reset: () => addon.reset(online, handle),
  }

  return {
    stream,
    tailSeconds: paths.tailSeconds,
    // A multilingual model reads the first words after a reset of an empty segment worse (measured: English came out
    // in Devanagari), so an endpoint without words keeps the stream as it is.
    resetOnSilence: !paths.locale,
    loadMs,
    offline: offline
      ? (samples) => {
          const s = addon.createOfflineStream(offline)
          addon.acceptWaveformOffline(s, { samples, sampleRate })
          addon.decodeOfflineStream(offline, s)
          return (JSON.parse(addon.getOfflineStreamResultAsJson(s)) as { text?: string }).text ?? ""
        }
      : undefined,
  }
}

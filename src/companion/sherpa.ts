/**
 * The few calls of the sherpa-onnx native addon the on-device engine needs, wrapped like the `sherpa-onnx-node`
 * package does, but loading `sherpa-onnx.node` from an absolute path (the folder the companion downloaded it to)
 * instead of searching `node_modules`. This is why nothing from sherpa ships in the vsix.
 */
import { join } from "node:path"
import type { ModelPaths, LocalPaths } from "../core/local-voice"
import { errorText } from "./shared"
import type { LocalEngine, LocalStream } from "./local-session"

/** The addon functions used here (handles are opaque). Everything else the addon exports is ignored. */
interface Addon {
  version?: string
  onnxruntimeVersion?: string
  createOnlineRecognizer(config: unknown): unknown
  createOnlineStream(recognizer: unknown): unknown
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

const transducer = (m: ModelPaths) => ({ encoder: m.encoder, decoder: m.decoder, joiner: m.joiner })

/** Load the addon and both recognizers. Timings go to `log`. */
export function loadEngine(paths: LocalPaths, threads: number, log: (line: string) => void): LocalEngine {
  const loadMs: Record<string, number> = {}
  const t0 = performance.now()
  const addon = loadAddon(paths.nativeDir, log)
  loadMs.addon = performance.now() - t0

  const t1 = performance.now()
  const online = addon.createOnlineRecognizer({
    featConfig: { sampleRate, featureDim: 80 },
    modelConfig: { transducer: transducer(paths.streaming), tokens: paths.streaming.tokens, numThreads: threads, provider: "cpu", debug: 0 },
    decodingMethod: "greedy_search",
    enableEndpoint: true,
  })
  loadMs.streaming = performance.now() - t1
  log(`Streaming model loaded in ${loadMs.streaming.toFixed(0)} ms (${threads} threads)`)

  const t2 = performance.now()
  const offline = addon.createOfflineRecognizer({
    featConfig: { sampleRate, featureDim: 80 },
    modelConfig: { transducer: transducer(paths.offline), tokens: paths.offline.tokens, numThreads: threads, provider: "cpu", debug: 0 },
    decodingMethod: "greedy_search",
  })
  loadMs.offline = performance.now() - t2
  log(`Offline model loaded in ${loadMs.offline.toFixed(0)} ms (${threads} threads)`)

  const handle = addon.createOnlineStream(online)
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
    loadMs,
    offline(samples) {
      const s = addon.createOfflineStream(offline)
      addon.acceptWaveformOffline(s, { samples, sampleRate })
      addon.decodeOfflineStream(offline, s)
      return (JSON.parse(addon.getOfflineStreamResultAsJson(s)) as { text?: string }).text ?? ""
    },
  }
}

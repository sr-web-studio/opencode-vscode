/**
 * Dev check of the on-device voice engine without VS Code (not shipped). Uses the real downloader and forks the real
 * `companion/dist/recorder.js` (like the companion extension does), with a fake microphone that plays WAV files at
 * real-time pace.
 *
 *   bun run build:ext
 *   bun scripts/local-voice-smoke.ts [--lang=<id>] [--threads=N] [cache-dir] [file.wav ...]   # download (if needed) + recognize
 *   bun scripts/local-voice-smoke.ts [--lang=<id>] --corrupt=native|model [cache-dir]   # a damaged download is rejected
 *
 * `--lang` is a language id of the catalog (`en`, `de`, `bn`, `auto`, …; default: the catalog default, English); the
 * pack that serves it is downloaded. Default WAVs: Bangla /tmp/opencode/sherpa/{mixed,pure}.wav, English
 * /tmp/opencode/sherpa/en/wavs/*.wav, any other language /tmp/opencode/sherpa/nemotron/wavs16/<id>.wav (16 kHz mono,
 * 16-bit: the fake microphone plays the samples as they are, another rate would play too fast).
 *
 * The recorder runs under Node (`process.execPath` of the runner when it is node; otherwise `node`), with
 * ELECTRON_RUN_AS_NODE=1 and the native folder first in the library path, exactly as the companion does.
 */
import { fork, execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { IntegrityError, ensureLocal } from "../apps/vscode/src/companion/local-install"
import { DEFAULT_LANGUAGE, LANGUAGES, languageById } from "@occ/core/voice-catalog"
import { envWithNative } from "../apps/vscode/src/companion/sherpa"
import type { FetchLike } from "../apps/vscode/src/companion/local-install"
import type { SessionUpdate } from "../apps/vscode/src/companion/session"

const args = process.argv.slice(2)
const corrupt = args.find((a) => a.startsWith("--corrupt="))?.slice(10)
const langArg = args.find((a) => a.startsWith("--lang="))?.slice(7)
if (langArg && !languageById(langArg)) {
  console.error(`unknown --lang=${langArg}; the catalog has: ${LANGUAGES.map((l) => l.id).join(", ")}`)
  process.exit(2)
}
const language = langArg ?? DEFAULT_LANGUAGE
const threads = Number(args.find((a) => a.startsWith("--threads="))?.slice(10)) || 2
const rest = args.filter((a) => !a.startsWith("--"))
const dirArg = rest.find((a) => !a.endsWith(".wav"))
const cache = resolve(dirArg ?? "/tmp/opencode/voice-cache")
const wavs = rest.filter((a) => a.endsWith(".wav")).map((a) => resolve(a))
if (wavs.length === 0) {
  if (language === "bn") wavs.push("/tmp/opencode/sherpa/mixed.wav", "/tmp/opencode/sherpa/pure.wav")
  else if (language === "en") wavs.push(...["en-0.wav", "en-1.wav"].map((n) => `/tmp/opencode/sherpa/en/wavs/${n}`))
  else wavs.push(`/tmp/opencode/sherpa/nemotron/wavs16/${language}.wav`)
}

const repo = resolve(import.meta.dirname, "..")
const recorder = join(repo, "apps", "vscode", "companion", "dist", "recorder.js")
const ms = (t: number) => `${(performance.now() - t).toFixed(0)} ms`

async function download(fetchImpl?: FetchLike) {
  const t0 = performance.now()
  let lastPct = -1
  const paths = await ensureLocal({
    storage: cache,
    platform: process.platform,
    arch: process.arch,
    language,
    fetch: fetchImpl,
    log: (l) => console.log(`[install] ${l}`),
    onProgress: (p) => {
      const pct = Math.floor((100 * p.done) / p.total / 10) * 10
      if (pct !== lastPct) console.log(`[install] ${pct}% (${(p.done / 1e6).toFixed(0)}/${(p.total / 1e6).toFixed(0)} MB, ${p.label})`)
      lastPct = pct
    },
  })
  console.log(`[install] ready in ${ms(t0)}`)
  return paths
}

/** A fetch that flips one byte of the first chunk of the first URL containing `needle`. */
const damaged =
  (needle: string): FetchLike =>
  async (url, init) => {
    const res = await fetch(url, init)
    if (!url.includes(needle) || !res.body) return res
    let flipped = false
    const body = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) {
          if (!flipped) {
            flipped = true
            chunk = chunk.slice()
            chunk[chunk.length >> 1] = ~chunk[chunk.length >> 1]! & 0xff
          }
          ctl.enqueue(chunk)
        },
      }),
    )
    return { ok: res.ok, status: res.status, body }
  }

/** Preloaded into the recorder process: replaces the native microphone library with a WAV player. */
const FAKE = (wav: string) => `
const Module = require("module"), fs = require("fs")
const buf = fs.readFileSync(${JSON.stringify(wav)})
const at = buf.indexOf("data") + 8
const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + at, buf.byteOffset + at + ((buf.length - at) & ~1)))
class PvRecorder {
  constructor(frameLength) { this.n = frameLength; this.i = 0; this.sampleRate = 16000; this.next = 0 }
  start() { this.next = Date.now() }
  stop() {}
  release() {}
  getSelectedDevice() { return "WAV file" }
  async read() {
    this.next += 100
    const wait = this.next - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    const f = new Int16Array(this.n)
    f.set(pcm.subarray(this.i, this.i + this.n)); this.i += this.n
    return f
  }
}
const load = Module._load
Module._load = function (request, parent, ...rest) {
  if (/pvrecorder[\\\\/]dist[\\\\/]index\\.js$/.test(request)) return { PvRecorder }
  return load.call(this, request, parent, ...rest)
}
`

async function recognize(paths: Awaited<ReturnType<typeof download>>, wav: string): Promise<void> {
  const raw = readFileSync(wav)
  const seconds = (raw.length - (raw.indexOf("data") + 8)) / 2 / 16000
  const preload = join(cache, `fake-mic-${process.pid}.cjs`)
  writeFileSync(preload, FAKE(wav))
  console.log(`\n=== ${wav} (${seconds.toFixed(1)} s) ===`)
  const t0 = performance.now()
  const child = fork(recorder, [], {
    execPath: "node",
    execArgv: ["--require", preload],
    env: envWithNative({ ...process.env, ELECTRON_RUN_AS_NODE: "1" }, paths.nativeDir, process.platform),
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  })
  let listeningAt = 0
  let last = ""
  const done = new Promise<SessionUpdate & { kind: "done" }>((res) => {
    child.on("message", (m: SessionUpdate | { kind: "log"; line: string }) => {
      if (m.kind === "log") return console.log(`[recorder] ${m.line}`)
      if (m.kind === "listening") {
        listeningAt = performance.now()
        return console.log(`+${ms(t0)} listening (${m.device})`)
      }
      if (m.kind === "heard") {
        const line = `${m.final}${m.partial}`
        if (line !== last) console.log(`+${ms(t0)} heard  final=«${m.final}»  partial=«${m.partial}»`)
        last = line
        return
      }
      res(m)
    })
    child.on("exit", (code) => res({ kind: "done", final: "", error: `recorder exited (${code}) without done` }))
  })
  child.send({ type: "start", engine: "local", paths, threads, deviceIndex: -1 })
  // Speak the whole file at real-time pace, then 1 s of silence, then the user clicks stop.
  setTimeout(() => child.send({ type: "stop" }), 1500 + (seconds + 1) * 1000 + 3000)
  const result = await done
  console.log(`+${ms(t0)} done   final=«${result.final}»${result.error ? `  ERROR: ${result.error}` : ""}`)
  console.log(`  stats: ${JSON.stringify(result.stats)}; first words after ${((listeningAt - t0) / 1000).toFixed(1)} s (model load, frames were kept)`)
  rmSync(preload, { force: true })
}

if (corrupt) {
  const dir = join(cache, `corrupt-${corrupt}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const needle = corrupt === "native" ? "registry.npmjs.org" : "huggingface.co"
  try {
    await ensureLocal({ storage: dir, platform: process.platform, arch: process.arch, language, fetch: damaged(needle), log: (l) => console.log(`[install] ${l}`) })
    console.log("UNEXPECTED: damaged download was accepted")
    process.exit(1)
  } catch (e) {
    console.log(`rejected as expected (${e instanceof IntegrityError ? "IntegrityError" : "other error"}): ${e instanceof Error ? e.message : e}`)
    console.log(execFileSync("sh", ["-c", `find ${JSON.stringify(dir)} -type f | head -20; echo "files left: $(find ${JSON.stringify(dir)} -type f | wc -l)"`]).toString())
    process.exit(e instanceof IntegrityError ? 0 : 1)
  }
} else {
  const paths = await download()
  for (const w of wavs) await recognize(paths, w)
}

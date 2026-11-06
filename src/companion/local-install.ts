/**
 * Downloads what the on-device engine needs into the companion's storage (on the user's own computer):
 *
 *   <root>/native/<npm package>-<version>/   the sherpa-onnx addon + onnxruntime libraries (from the npm registry)
 *   <root>/models/<model id>/                 the model files (from Hugging Face, pinned revisions)
 *
 * Every download goes to a `.part` file, is verified (size + SHA-256, or the registry's SHA-512 integrity for the npm
 * tarball) and only then renamed into place. A folder counts only when its `ready.json` exists and its files have the
 * recorded sizes, so an interrupted or corrupted download is never used and is simply fetched again.
 * No `vscode` import: the dev smoke script uses this module too.
 */
import { createHash, randomBytes } from "node:crypto"
import { createWriteStream } from "node:fs"
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { gunzipSync } from "node:zlib"
import {
  LOCAL_ROOT,
  OFFLINE_MODEL,
  SHERPA_VERSION,
  STREAMING_MODEL,
  downloadBytes,
  modelUrl,
  sherpaTarget,
  type LocalPaths,
  type ModelPaths,
  type ModelSpec,
  type SherpaTarget,
} from "../core/local-voice"
import { parseTar, stripTopFolder } from "../core/tar"

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>

export type Progress = { label: string; done: number; total: number }

export type InstallOptions = {
  /** The companion's global storage folder. */
  storage: string
  platform: string
  arch: string
  fetch?: FetchLike
  onProgress?: (p: Progress) => void
  signal?: AbortSignal
  log?: (line: string) => void
  /** Abort a download that receives nothing for this long. */
  stallMs?: number
}

/** The integrity or hash of a download did not match: the file is deleted and never used. */
export class IntegrityError extends Error {}

/* ------------------------------------------------------------ pure helpers */

/** `sha512-<base64>` (Subresource Integrity, as in npm's `dist.integrity`) of `data`. */
export const integrityOf = (data: Uint8Array, algo: "sha512" | "sha256" = "sha512"): string => `${algo}-${createHash(algo).update(data).digest("base64")}`

/** True when `data` matches the SRI string. Only sha256/sha384/sha512 are accepted (never sha1). */
export function matchesIntegrity(data: Uint8Array, integrity: string): boolean {
  const m = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(integrity.trim())
  if (!m) return false
  return createHash(m[1]!).update(data).digest("base64") === m[2]
}

export const sha256Hex = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex")

/** Where each part lives under `<storage>`. */
export function layout(storage: string, target: SherpaTarget) {
  const root = join(storage, LOCAL_ROOT)
  const modelDir = (m: ModelSpec) => join(root, "models", m.id)
  return { root, nativeDir: join(root, "native", `${target.pkg}-${SHERPA_VERSION}`), streamingDir: modelDir(STREAMING_MODEL), offlineDir: modelDir(OFFLINE_MODEL) }
}

const modelPaths = (dir: string): ModelPaths => ({ encoder: join(dir, "encoder.onnx"), decoder: join(dir, "decoder.onnx"), joiner: join(dir, "joiner.onnx"), tokens: join(dir, "tokens.txt") })

/* ------------------------------------------------------------ ready markers */

type Ready = { files: Record<string, number> }

async function isReady(dir: string): Promise<boolean> {
  try {
    const ready = JSON.parse(await readFile(join(dir, "ready.json"), "utf8")) as Ready
    const names = Object.keys(ready.files ?? {})
    if (names.length === 0) return false
    for (const name of names) {
      if ((await stat(join(dir, name))).size !== ready.files[name]) return false
    }
    return true
  } catch {
    return false
  }
}

export type LocalState = { native: boolean; streaming: boolean; offline: boolean; target?: SherpaTarget }

/** What is already on disk. */
export async function localState(o: Pick<InstallOptions, "storage" | "platform" | "arch">): Promise<LocalState> {
  const target = sherpaTarget(o.platform, o.arch)
  if (!target) return { native: false, streaming: false, offline: false }
  const l = layout(o.storage, target)
  const [native, streaming, offline] = await Promise.all([isReady(l.nativeDir), isReady(l.streamingDir), isReady(l.offlineDir)])
  return { native, streaming, offline, target }
}

export const isInstalled = (s: LocalState): boolean => s.native && s.streaming && s.offline

/** Bytes still to download for the current state. */
export function missingBytes(s: LocalState): number {
  if (!s.target) return 0
  let n = 0
  if (!s.native) n += s.target.bytes
  if (!s.streaming) n += STREAMING_MODEL.files.reduce((a, f) => a + f.size, 0)
  if (!s.offline) n += OFFLINE_MODEL.files.reduce((a, f) => a + f.size, 0)
  return n
}

export { downloadBytes }

/* ------------------------------------------------------------ download */

type Sink = { onBytes(n: number): void }

/**
 * Stream `url` into `dest + ".part"`, hashing on the way. Returns the digest; the caller verifies and renames.
 * A stalled connection aborts after `stallMs`.
 */
async function fetchToFile(url: string, part: string, algo: "sha256" | "sha512", o: InstallOptions, sink: Sink): Promise<{ digest: Buffer; bytes: number }> {
  const doFetch: FetchLike = o.fetch ?? ((u, init) => fetch(u, init) as unknown as ReturnType<FetchLike>)
  const ctl = new AbortController()
  const onAbort = () => ctl.abort()
  o.signal?.addEventListener("abort", onAbort)
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => ctl.abort(new Error("the download stalled")), o.stallMs ?? 30_000)
  }
  await mkdir(dirname(part), { recursive: true })
  await rm(part, { force: true })
  const hash = createHash(algo)
  let bytes = 0
  try {
    if (o.signal?.aborted) throw new Error("cancelled")
    arm()
    const res = await doFetch(url, { signal: ctl.signal })
    if (!res.ok || !res.body) throw new Error(`${new URL(url).host} answered with HTTP ${res.status}`)
    const out = createWriteStream(part)
    const failed = new Promise<never>((_, reject) => out.on("error", reject))
    failed.catch(() => undefined)
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), failed])
        if (done) break
        if (ctl.signal.aborted) throw new Error("cancelled")
        arm()
        hash.update(value)
        bytes += value.length
        sink.onBytes(value.length)
        if (!out.write(value)) await Promise.race([new Promise<void>((r) => out.once("drain", r)), failed])
      }
      await Promise.race([new Promise<void>((r) => out.end(r)), failed])
    } catch (e) {
      out.destroy()
      throw e
    }
  } catch (e) {
    await rm(part, { force: true })
    if (o.signal?.aborted) throw new Error("cancelled")
    if (ctl.signal.aborted) throw ctl.signal.reason instanceof Error ? ctl.signal.reason : new Error("the download was interrupted")
    throw e
  } finally {
    if (timer) clearTimeout(timer)
    o.signal?.removeEventListener("abort", onAbort)
  }
  return { digest: hash.digest(), bytes }
}

async function installModel(model: ModelSpec, dir: string, o: InstallOptions, report: (label: string, n: number) => void): Promise<void> {
  if (await isReady(dir)) return
  await rm(dir, { recursive: true, force: true })
  const tmp = `${dir}.tmp-${randomBytes(4).toString("hex")}`
  try {
    for (const f of model.files) {
      const part = join(tmp, `${f.name}.part`)
      const t0 = Date.now()
      const { digest, bytes } = await fetchToFile(modelUrl(model, f), part, "sha256", o, { onBytes: (n) => report(f.name, n) })
      const hex = digest.toString("hex")
      if (bytes !== f.size || hex !== f.sha256) {
        await rm(part, { force: true })
        throw new IntegrityError(`${model.repo}/${f.path} failed verification (got ${bytes} bytes, sha256 ${hex.slice(0, 12)}…; expected ${f.size} bytes, ${f.sha256.slice(0, 12)}…)`)
      }
      await rename(part, join(tmp, f.name))
      o.log?.(`Downloaded ${model.repo}/${f.path} (${(bytes / 1e6).toFixed(1)} MB, ${Date.now() - t0} ms), sha256 verified`)
    }
    const ready: Ready & { repo: string; rev: string } = { repo: model.repo, rev: model.rev, files: Object.fromEntries(model.files.map((f) => [f.name, f.size])) }
    await writeFile(join(tmp, "ready.json"), JSON.stringify(ready, null, 2))
    await rename(tmp, dir)
  } catch (e) {
    await rm(tmp, { recursive: true, force: true })
    throw e
  }
}

async function installNative(target: SherpaTarget, dir: string, o: InstallOptions, report: (label: string, n: number) => void): Promise<void> {
  if (await isReady(dir)) return
  await rm(dir, { recursive: true, force: true })
  const tmp = `${dir}.tmp-${randomBytes(4).toString("hex")}`
  const tgz = `${tmp}.tgz.part`
  try {
    const t0 = Date.now()
    const { digest } = await fetchToFile(target.url, tgz, "sha512", o, { onBytes: (n) => report("speech engine", n) })
    const got = `sha512-${digest.toString("base64")}`
    if (got !== target.integrity) throw new IntegrityError(`${target.pkg} failed verification (integrity ${got.slice(0, 20)}…, expected ${target.integrity.slice(0, 20)}…)`)
    const entries = parseTar(gunzipSync(await readFile(tgz)))
    await mkdir(tmp, { recursive: true })
    const files: Record<string, number> = {}
    for (const e of entries) {
      const rel = stripTopFolder(e.path)
      if (!rel || e.type !== "file") continue
      const dest = join(tmp, ...rel.split("/"))
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, e.data)
      await chmod(dest, (e.mode & 0o777) | 0o644 | (/\.(node|so|dylib|dll)(\.|$)/.test(rel) ? 0o111 : 0))
      files[rel] = e.data.length
    }
    if (!files["sherpa-onnx.node"]) throw new Error(`${target.pkg} does not contain sherpa-onnx.node`)
    await writeFile(join(tmp, "ready.json"), JSON.stringify({ pkg: target.pkg, version: SHERPA_VERSION, integrity: target.integrity, files }, null, 2))
    await rename(tmp, dir)
    o.log?.(`Installed ${target.pkg}@${SHERPA_VERSION} (${Object.keys(files).length} files, ${Date.now() - t0} ms), integrity verified`)
  } catch (e) {
    await rm(tmp, { recursive: true, force: true })
    throw e
  } finally {
    await rm(tgz, { force: true })
  }
}

/**
 * Make sure the engine and both models are on disk (downloading what is missing) and return where they are.
 * Throws `IntegrityError` for a download that does not match, `Error("cancelled")` when `signal` aborts.
 */
export async function ensureLocal(o: InstallOptions): Promise<LocalPaths> {
  const target = sherpaTarget(o.platform, o.arch)
  if (!target) throw new Error(`The on-device engine is not available for ${o.platform}/${o.arch}.`)
  const l = layout(o.storage, target)
  await mkdir(l.root, { recursive: true })
  const state = await localState(o)
  const total = missingBytes(state)
  let done = 0
  const report = (label: string, n: number) => {
    done += n
    o.onProgress?.({ label, done, total })
  }
  if (!state.native) await installNative(target, l.nativeDir, o, report)
  if (!state.streaming) await installModel(STREAMING_MODEL, l.streamingDir, o, report)
  if (!state.offline) await installModel(OFFLINE_MODEL, l.offlineDir, o, report)
  return { nativeDir: l.nativeDir, streaming: modelPaths(l.streamingDir), offline: modelPaths(l.offlineDir) }
}

/** Remove everything the local engine downloaded (not used by the extension itself; for the dev script and support). */
export async function removeLocal(storage: string): Promise<void> {
  await rm(join(storage, LOCAL_ROOT), { recursive: true, force: true })
}

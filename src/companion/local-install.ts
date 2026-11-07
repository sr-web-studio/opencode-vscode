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
import { createWriteStream, type Dirent } from "node:fs"
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { gunzipSync } from "node:zlib"
import { LOCAL_ROOT, SHERPA_VERSION, sherpaTarget, type LocalPaths, type ModelPaths, type SherpaTarget } from "../core/local-voice"
import { parseTar, stripTopFolder } from "../core/tar"
import { CATALOG, REQUIRED_ROLES, knownModelIds, languageFor, modelBytes, modelUrl, packModels, modelsToRemove, packFor, type Catalog, type LanguagePack, type ModelSpec } from "../core/voice-catalog"

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
  /** The language catalog (tests pass their own). */
  catalog?: Catalog
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
  return { root, nativeDir: join(root, "native", `${target.pkg}-${SHERPA_VERSION}`), modelDir }
}

/** Absolute file paths of a model folder, by role (a model is one folder, whichever packs use it). */
export function modelPaths(m: ModelSpec, dir: string): ModelPaths {
  const files: ModelPaths["files"] = {}
  for (const f of m.files) files[f.role] = join(dir, f.name)
  for (const role of REQUIRED_ROLES[m.kind]) if (!files[role]) throw new Error(`model ${m.id} has no ${role} file`)
  return { kind: m.kind, featureDim: m.featureDim, files }
}

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

/** `models`: ids of the catalog's models that are fully on disk (whichever pack they belong to). */
export type LocalState = { native: boolean; models: string[]; target?: SherpaTarget }

type StateOptions = Pick<InstallOptions, "storage" | "platform" | "arch" | "catalog">

const allModels = (packs: readonly LanguagePack[]): ModelSpec[] => {
  const out: ModelSpec[] = []
  for (const p of packs) for (const m of packModels(p)) if (!out.some((x) => x.id === m.id)) out.push(m)
  return out
}

/** What is already on disk. */
export async function localState(o: StateOptions): Promise<LocalState> {
  const target = sherpaTarget(o.platform, o.arch)
  if (!target) return { native: false, models: [] }
  const l = layout(o.storage, target)
  const models = allModels((o.catalog ?? CATALOG).packs)
  const [native, ready] = await Promise.all([isReady(l.nativeDir), Promise.all(models.map((m) => isReady(l.modelDir(m))))])
  return { native, models: models.filter((_, i) => ready[i]).map((m) => m.id), target }
}

/** Is the pack usable: the engine and every model of the pack are on disk? */
export const isInstalled = (s: LocalState, pack: LanguagePack): boolean => s.native && packModels(pack).every((m) => s.models.includes(m.id))

/** Ids of the packs whose models are all on this computer (the engine is not counted: it is the same for all). */
export const installedLanguages = (s: LocalState, packs: readonly LanguagePack[] = CATALOG.packs): string[] =>
  packs.filter((p) => packModels(p).every((m) => s.models.includes(m.id))).map((p) => p.id)

/** Bytes still to download to use `pack`: what is missing of the engine and of its models. */
export function missingBytes(s: LocalState, pack: LanguagePack): number {
  if (!s.target) return 0
  return (s.native ? 0 : s.target.bytes) + packModels(pack).reduce((n, m) => (s.models.includes(m.id) ? n : n + modelBytes(m)), 0)
}

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
 * Make sure the engine and the models of the pack that serves one language are on disk (downloading what is missing; a
 * model another pack already downloaded is not fetched again) and return where they are. `language` is a catalog
 * language id (unknown → the default). Throws `IntegrityError` for a download that does not match, `Error("cancelled")`
 * when `signal` aborts.
 */
export async function ensureLocal(o: InstallOptions & { language?: string }): Promise<LocalPaths> {
  const target = sherpaTarget(o.platform, o.arch)
  if (!target) throw new Error(`The on-device engine is not available for ${o.platform}/${o.arch}.`)
  const language = languageFor(o.language, o.catalog)
  const pack = packFor(language.id, o.catalog)
  const l = layout(o.storage, target)
  await mkdir(l.root, { recursive: true })
  const state = await localState(o)
  const total = missingBytes(state, pack)
  let done = 0
  const report = (label: string, n: number) => {
    done += n
    o.onProgress?.({ label, done, total })
  }
  if (!state.native) await installNative(target, l.nativeDir, o, report)
  for (const m of packModels(pack)) if (!state.models.includes(m.id)) await installModel(m, l.modelDir(m), o, report)
  return {
    nativeDir: l.nativeDir,
    language: language.id,
    pack: pack.id,
    locale: language.locale,
    streaming: modelPaths(pack.streaming, l.modelDir(pack.streaming)),
    offline: pack.offline ? modelPaths(pack.offline, l.modelDir(pack.offline)) : undefined,
    tailSeconds: pack.streaming.tailSeconds,
  }
}

/**
 * Delete the downloaded models of the given packs (pack ids), except models another installed pack still uses.
 * Returns the ids of the deleted models. The speech engine stays (it is small and shared).
 */
export async function removeLanguages(o: StateOptions, packIds: readonly string[]): Promise<string[]> {
  const cat = o.catalog ?? CATALOG
  const state = await localState(o)
  if (!state.target) return []
  const l = layout(o.storage, state.target)
  const doomed = modelsToRemove(packIds, installedLanguages(state, cat.packs), cat.packs).filter((m) => state.models.includes(m.id))
  for (const m of doomed) await rm(l.modelDir(m), { recursive: true, force: true })
  return doomed.map((m) => m.id)
}

/** A folder name we could have created: a catalog model id, a leftover `<id>.tmp-<hex>`, never anything else. */
const OURS = /^[a-z0-9][a-z0-9._-]*$/

/**
 * Delete model folders under `<storage>/local-voice/v1/models/` that the catalog does not list any more (the English
 * Zipformer and Moonshine models of earlier versions, interrupted downloads). Only direct children of that folder are
 * looked at; a folder is removed only when its name looks like one we create, it is a real directory (symlinks are left
 * alone) and it holds our `ready.json` marker or `.tmp-` leftovers. Returns the folder names removed.
 */
export async function removeUnknownModels(o: StateOptions): Promise<string[]> {
  const target = sherpaTarget(o.platform, o.arch)
  if (!target) return []
  const models = join(layout(o.storage, target).root, "models")
  const known = new Set(knownModelIds(o.catalog ?? CATALOG))
  let names: Dirent[]
  try {
    names = await readdir(models, { withFileTypes: true })
  } catch {
    return []
  }
  const removed: string[] = []
  for (const e of names) {
    if (!e.isDirectory() || e.isSymbolicLink() || !OURS.test(e.name) || known.has(e.name)) continue
    const dir = join(models, e.name)
    const leftover = /\.tmp-[0-9a-f]{8}$/.test(e.name) && known.has(e.name.replace(/\.tmp-[0-9a-f]{8}$/, ""))
    const ours = leftover || (await readFile(join(dir, "ready.json"), "utf8").then(() => true, () => false))
    if (!ours) continue
    await rm(dir, { recursive: true, force: true })
    removed.push(e.name)
  }
  return removed
}

/** Remove everything the local engine downloaded (not used by the extension itself; for the dev script and support). */
export async function removeLocal(storage: string): Promise<void> {
  await rm(join(storage, LOCAL_ROOT), { recursive: true, force: true })
}

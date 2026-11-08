import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import {
  IntegrityError,
  ensureLocal,
  installedLanguages,
  integrityOf,
  isInstalled,
  layout,
  localState,
  matchesIntegrity,
  missingBytes,
  removeLanguages,
  removeUnknownModels,
  sha256Hex,
  type FetchLike,
} from "../../apps/vscode/src/companion/local-install"
import { SHERPA_PLATFORMS, sherpaTarget, type SherpaTarget } from "@occ/core/local-voice"
import { modelBytes, modelUrl, packById, type Catalog, type LanguagePack, type ModelFile, type ModelKind, type ModelRole, type ModelSpec } from "@occ/core/voice-catalog"

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "oc-voice-"))
  dirs.push(d)
  return d
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

const enc = new TextEncoder()
function tarEntry(name: string, body: string | Uint8Array, mode = 0o644): number[] {
  const data = typeof body === "string" ? enc.encode(body) : body
  const h = new Uint8Array(512)
  h.set(enc.encode(name), 0)
  h.set(enc.encode(mode.toString(8).padStart(7, "0")), 100)
  h.set(enc.encode(data.length.toString(8).padStart(11, "0")), 124)
  h.set(enc.encode("0"), 156)
  h.set(enc.encode("ustar"), 257)
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512)
  padded.set(data)
  return [...h, ...padded]
}
const tgz = (...entries: number[][]) => gzipSync(Uint8Array.from([...entries.flat(), ...new Uint8Array(1024)]))

const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += 1000) c.enqueue(bytes.subarray(i, i + 1000))
      c.close()
    },
  })

describe("integrity helpers", () => {
  test("matchesIntegrity accepts only a correct sha256/384/512 digest", () => {
    const data = enc.encode("hello")
    expect(matchesIntegrity(data, integrityOf(data))).toBe(true)
    expect(matchesIntegrity(data, integrityOf(data, "sha256"))).toBe(true)
    expect(matchesIntegrity(enc.encode("hellp"), integrityOf(data))).toBe(false)
    expect(matchesIntegrity(data, "sha1-qvTGHdzF6KLavt4PO0gs2a6pQ00=")).toBe(false)
    expect(matchesIntegrity(data, "nonsense")).toBe(false)
    expect(sha256Hex(data)).toBe(createHash("sha256").update("hello").digest("hex"))
  })
})

describe("pinned downloads", () => {
  test("all six platforms are pinned with a sha512 integrity and a registry URL", () => {
    expect([...SHERPA_PLATFORMS].sort()).toEqual(["darwin/arm64", "darwin/x64", "linux/arm64", "linux/x64", "win32/arm64", "win32/x64"])
    for (const p of SHERPA_PLATFORMS) {
      const [plat, arch] = p.split("/") as [string, string]
      const t = sherpaTarget(plat, arch)!
      expect(t.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/)
      expect(t.url).toBe(`https://registry.npmjs.org/${t.pkg}/-/${t.pkg}-2.0.1.tgz`)
    }
    expect(sherpaTarget("win32", "x64")!.pkg).toBe("sherpa-onnx-win-x64")
    expect(sherpaTarget("freebsd", "x64")).toBeUndefined()
  })
  test("the Bangla models keep their ids, paths and sizes (existing downloads are reused)", () => {
    const bn = packById("bn")!
    expect(bn.streaming.id).toBe("streaming-bn-vosk-501097a")
    expect(bn.offline!.id).toBe("offline-bn-sayed-16bec01")
    expect(modelUrl(bn.offline!, bn.offline!.files[0]!)).toBe("https://huggingface.co/SayedShaun/bangla-zipformer-onnx/resolve/16bec01c5f554d3f0dc8f0139de3a00839a72efc/int8/encoder.onnx")
    expect(modelBytes(bn.streaming)).toBe(94_119_939)
    expect(modelBytes(bn.offline!)).toBe(73_635_073)
    const total = sherpaTarget("win32", "x64")!.bytes + modelBytes(bn.streaming) + modelBytes(bn.offline!)
    expect(total / 1e6).toBeGreaterThan(150)
    expect(total / 1e6).toBeLessThan(200)
  })
})

/** A model whose files are the fake bodies (`file:<path>`), pinned with their real hashes, so downloads can be verified for real. */
const body = (path: string) => enc.encode(`file:${path}`)
function fakeModel(id: string, kind: ModelKind, repo: string, roles: Partial<Record<ModelRole, string>>): ModelSpec {
  const files: ModelFile[] = Object.entries(roles).map(([role, path]) => ({
    path: path!,
    name: path!.split("/").pop()!,
    role: role as ModelRole,
    size: body(path!).length,
    sha256: sha256Hex(body(path!)),
  }))
  return { id, kind, title: id, author: "t", license: "MIT", licenseUrl: "x", source: `https://huggingface.co/${repo}`, repo, rev: "a".repeat(40), featureDim: 128, tailSeconds: 0.8, files }
}
const tdRoles = (dir: string) => ({ encoder: `${dir}/enc.onnx`, decoder: `${dir}/dec.onnx`, joiner: `${dir}/join.onnx`, tokens: `${dir}/tokens.txt` })
const M_A = fakeModel("model-a", "transducer", "org/a", tdRoles("a"))
const M_B = fakeModel("model-b", "transducer", "org/b", tdRoles("b"))
const M_SHARED = fakeModel("model-shared", "transducer", "org/shared", tdRoles("s"))
const M_OFF = fakeModel("model-off", "transducer", "org/off", tdRoles("o"))
const PACKS: LanguagePack[] = [
  { id: "xa", name: "Xa", noun: "xa models", streaming: M_A, offline: M_OFF },
  { id: "xb", name: "Xb", noun: "xb models", streaming: M_B, offline: M_SHARED },
  { id: "xc", name: "Xc", noun: "multilingual model", streaming: M_SHARED },
]
/** Two languages (`xc`, `xd`) share the pack `xc`; `xd` is told its locale. */
const CAT: Catalog = {
  packs: PACKS,
  defaultLanguage: "xa",
  languages: [
    { id: "xa", name: "Xa", native: "Xa", pack: "xa", tier: "ready" },
    { id: "xb", name: "Xb", native: "Xb", pack: "xb", tier: "ready" },
    { id: "xc", name: "Xc", native: "Xc", pack: "xc", locale: "xc-XC", tier: "ready" },
    { id: "xd", name: "Xd", native: "Xd", pack: "xc", locale: "xd-XD", tier: "broad" },
  ],
}

describe("ensureLocal", () => {
  // A tiny fake world: one native package and fake language packs whose files are verified for real.
  const native = tgz(tarEntry("package/", ""), tarEntry("package/sherpa-onnx.node", "ADDON", 0o755), tarEntry("package/libx.so", "LIB"))
  const target: SherpaTarget = { pkg: "sherpa-onnx-linux-x64", url: "https://registry.npmjs.org/p.tgz", integrity: integrityOf(native), bytes: native.length }

  function world(opts: { corrupt?: string; status?: number } = {}) {
    const calls: string[] = []
    const fetch: FetchLike = async (url) => {
      calls.push(url)
      if (opts.status) return { ok: false, status: opts.status, body: null }
      if (url === target.url) return { ok: true, status: 200, body: streamOf(opts.corrupt === "native" ? native.map((b, i) => (i === 40 ? b ^ 1 : b)) : native) }
      const path = url.split("/resolve/")[1]!.split("/").slice(1).join("/")
      const b = body(path)
      return { ok: true, status: 200, body: streamOf(opts.corrupt && url.includes(opts.corrupt) ? enc.encode("x".repeat(b.length)) : b) }
    }
    return { fetch, calls }
  }

  const ls = (storage: string) => ({ storage, platform: "linux", arch: "x64", catalog: CAT })

  const run = async (storage: string, w: ReturnType<typeof world>, signal?: AbortSignal, language = "xa") => {
    // sherpaTarget("linux","x64") is the real pinned one; swap its integrity for the fake tarball for this run.
    const real = sherpaTarget("linux", "x64")!
    const saved = { ...real }
    Object.assign(real, target)
    try {
      return await ensureLocal({ ...ls(storage), language, fetch: w.fetch, signal })
    } finally {
      Object.assign(real, saved)
    }
  }

  test("downloads, verifies, extracts into the versioned folders and writes ready markers", async () => {
    const storage = tmp()
    const w = world()
    const paths = await run(storage, w)
    expect(paths.nativeDir).toBe(layout(storage, target).nativeDir)
    expect(paths.language).toBe("xa")
    expect(await readFile(join(paths.nativeDir, "sherpa-onnx.node"), "utf8")).toBe("ADDON")
    expect(await readFile(join(paths.nativeDir, "libx.so"), "utf8")).toBe("LIB")
    expect(paths.streaming.kind).toBe("transducer")
    expect(await readFile(paths.streaming.files.tokens!, "utf8")).toBe("file:a/tokens.txt")
    expect(paths.streaming.featureDim).toBe(128) // the model's own feature size travels with its paths
    expect(paths.tailSeconds).toBe(0.8)
    expect(paths.pack).toBe("xa")
    expect(paths.locale).toBeUndefined()
    expect(paths.offline!.kind).toBe("transducer")
    expect(await readFile(paths.offline!.files.decoder!, "utf8")).toBe("file:o/dec.onnx")
    expect(existsSync(join(paths.nativeDir, "ready.json"))).toBe(true)
    expect(w.calls).toHaveLength(1 + 4 + 4)
    // No temp or partial leftovers anywhere.
    const all = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(join(d, e.name)) : [join(d, e.name)]))
    expect(all(storage).filter((f) => /\.part$|\.tmp-/.test(f))).toEqual([])
    // Second call downloads nothing.
    const again = world()
    await run(storage, again)
    expect(again.calls).toEqual([])
  })

  test("a damaged npm tarball is rejected and leaves nothing behind", async () => {
    const storage = tmp()
    await expect(run(storage, world({ corrupt: "native" }))).rejects.toBeInstanceOf(IntegrityError)
    const state = await localState(ls(storage))
    expect(state.native).toBe(false)
    expect(readdirSync(join(storage, "local-voice/v1")).filter((n) => n !== "native" && n !== "models")).toEqual([])
    expect(existsSync(join(storage, "local-voice/v1/native")) ? readdirSync(join(storage, "local-voice/v1/native")) : []).toEqual([])
  })

  test("a damaged model file is rejected; what was already verified is kept, the broken model is not", async () => {
    const storage = tmp()
    await expect(run(storage, world({ corrupt: "org/off" }))).rejects.toThrow(/failed verification/)
    const state = await localState(ls(storage))
    expect(state).toMatchObject({ native: true, models: ["model-a"] })
    expect(isInstalled(state, PACKS[0]!)).toBe(false)
    // Repair: the next run fetches only what is missing.
    const w = world()
    await run(storage, w)
    expect(w.calls).toHaveLength(4)
    expect(isInstalled(await localState(ls(storage)), PACKS[0]!)).toBe(true)
  })

  test("a folder is not used when a file has the wrong size (partial or tampered)", async () => {
    const storage = tmp()
    const paths = await run(storage, world())
    await writeFile(paths.streaming.files.encoder!, "short")
    const state = await localState(ls(storage))
    expect(state.models).toEqual(["model-off"])
    expect(missingBytes({ ...state, target }, PACKS[0]!)).toBe(modelBytes(M_A))
    const w = world()
    await run(storage, w)
    expect(w.calls).toHaveLength(4) // the damaged model only
    expect(await readFile(paths.streaming.files.encoder!, "utf8")).toBe("file:a/enc.onnx")
  })

  test("only the chosen language is downloaded; a model two languages share is downloaded once", async () => {
    const storage = tmp()
    const first = world()
    await run(storage, first, undefined, "xb") // model-b + model-shared
    expect(first.calls).toHaveLength(1 + 4 + 4)
    expect(first.calls.some((u) => u.includes("org/a") || u.includes("org/off"))).toBe(false)
    const second = world()
    const paths = await run(storage, second, undefined, "xc") // streaming = model-shared: already there
    expect(second.calls).toEqual([])
    expect(paths.offline).toBeUndefined()
    expect(paths.streaming.files.tokens).toBe(join(storage, "local-voice/v1/models/model-shared/tokens.txt"))
    expect(paths.locale).toBe("xc-XC")
    const state = await localState(ls(storage))
    expect(installedLanguages(state, PACKS)).toEqual(["xb", "xc"])
    expect(missingBytes({ ...state, target }, PACKS[0]!)).toBe(modelBytes(M_A) + modelBytes(M_OFF))
  })

  test("two languages of one pack download once and differ only by locale", async () => {
    const storage = tmp()
    const first = world()
    const c = await run(storage, first, undefined, "xc")
    expect(first.calls).toHaveLength(1 + 4)
    const second = world()
    const d = await run(storage, second, undefined, "xd")
    expect(second.calls).toEqual([]) // switching to another language of the same pack: no new download
    expect(d.streaming).toEqual(c.streaming)
    expect([c.locale, d.locale, c.pack, d.pack]).toEqual(["xc-XC", "xd-XD", "xc", "xc"])
  })

  test("an unknown language id installs the default language (a catalog without `en` falls back to its default)", async () => {
    const paths = await run(tmp(), world(), undefined, "zz")
    expect(paths.language).toBe("xa")
  })

  test("removing a pack deletes only models no other installed pack uses", async () => {
    const storage = tmp()
    await run(storage, world(), undefined, "xb")
    await run(storage, world(), undefined, "xc")
    await run(storage, world(), undefined, "xa")
    expect(await removeLanguages(ls(storage), ["xb"])).toEqual(["model-b"]) // model-shared stays: xc uses it
    expect(installedLanguages(await localState(ls(storage)), PACKS)).toEqual(["xa", "xc"])
    expect((await removeLanguages(ls(storage), ["xa", "xc"])).sort()).toEqual(["model-a", "model-off", "model-shared"])
    expect((await localState(ls(storage))).models).toEqual([])
    expect(await removeLanguages(ls(storage), ["xa"])).toEqual([]) // nothing left: nothing deleted, no error
  })

  test("cleanup deletes model folders the catalog no longer lists, only ours, only inside models/", async () => {
    const storage = tmp()
    await run(storage, world(), undefined, "xa")
    const models = join(storage, "local-voice/v1/models")
    // Left over by an older version: a folder we made (has ready.json) and an interrupted download.
    for (const old of ["streaming-en-zipformer-672fbf1", "offline-en-moonshine-tiny-bf2b762"]) {
      mkdirSync(join(models, old), { recursive: true })
      await writeFile(join(models, old, "ready.json"), "{}")
      await writeFile(join(models, old, "encoder.onnx"), "x")
    }
    mkdirSync(join(models, "model-a.tmp-0123abcd"), { recursive: true })
    // Not ours: no ready.json, an odd name, a symlink to a folder outside, a file, and a sibling of models/.
    mkdirSync(join(models, "somebody-elses-folder"), { recursive: true })
    await writeFile(join(models, "somebody-elses-folder", "notes.txt"), "keep me")
    mkdirSync(join(models, "Weird Name"), { recursive: true })
    await writeFile(join(models, "Weird Name", "ready.json"), "{}")
    const outside = tmp()
    await writeFile(join(outside, "precious.txt"), "precious")
    symlinkSync(outside, join(models, "linked-elsewhere"))
    await writeFile(join(models, "stray-file"), "x")
    await writeFile(join(storage, "local-voice/v1/keep.txt"), "keep")

    const removed = await removeUnknownModels(ls(storage))
    expect(removed.sort()).toEqual(["model-a.tmp-0123abcd", "offline-en-moonshine-tiny-bf2b762", "streaming-en-zipformer-672fbf1"])
    expect(readdirSync(models).sort()).toEqual(["Weird Name", "linked-elsewhere", "model-a", "model-off", "somebody-elses-folder", "stray-file"])
    expect(await readFile(join(outside, "precious.txt"), "utf8")).toBe("precious")
    expect(await readFile(join(models, "somebody-elses-folder/notes.txt"), "utf8")).toBe("keep me")
    expect(await readFile(join(storage, "local-voice/v1/keep.txt"), "utf8")).toBe("keep")
    // The catalog's own models are untouched and still ready.
    expect((await localState(ls(storage))).models.sort()).toEqual(["model-a", "model-off"])
    // Nothing to do the second time; no models folder at all is fine.
    expect(await removeUnknownModels(ls(storage))).toEqual([])
    expect(await removeUnknownModels(ls(tmp()))).toEqual([])
    expect(await removeUnknownModels({ storage: tmp(), platform: "freebsd", arch: "x64" })).toEqual([])
  })

  test("HTTP errors and cancellation fail cleanly", async () => {
    await expect(run(tmp(), world({ status: 503 }))).rejects.toThrow(/HTTP 503/)
    const ctl = new AbortController()
    ctl.abort()
    await expect(run(tmp(), world(), ctl.signal)).rejects.toThrow()
  })

  test("a platform without the engine is an error, not a crash", async () => {
    await expect(ensureLocal({ storage: tmp(), platform: "freebsd", arch: "x64" })).rejects.toThrow(/not available/)
  })
})

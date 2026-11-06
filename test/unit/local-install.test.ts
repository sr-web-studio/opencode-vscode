import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { IntegrityError, ensureLocal, integrityOf, isInstalled, layout, localState, matchesIntegrity, missingBytes, sha256Hex, type FetchLike } from "../../src/companion/local-install"
import { OFFLINE_MODEL, SHERPA_PLATFORMS, STREAMING_MODEL, downloadBytes, modelBytes, modelUrl, sherpaTarget, type SherpaTarget } from "../../src/core/local-voice"

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
  test("models are pinned to a commit, with full sha256 and the sizes from Hugging Face", () => {
    for (const m of [STREAMING_MODEL, OFFLINE_MODEL]) {
      expect(m.rev).toMatch(/^[0-9a-f]{40}$/)
      for (const f of m.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(modelUrl(OFFLINE_MODEL, OFFLINE_MODEL.files[0]!)).toBe("https://huggingface.co/SayedShaun/bangla-zipformer-onnx/resolve/16bec01c5f554d3f0dc8f0139de3a00839a72efc/int8/encoder.onnx")
    expect(modelBytes(STREAMING_MODEL)).toBe(94_119_939)
    const total = downloadBytes(sherpaTarget("win32", "x64")!)
    expect(total / 1e6).toBeGreaterThan(150)
    expect(total / 1e6).toBeLessThan(200)
  })
})

describe("ensureLocal", () => {
  // A tiny fake world: one native package and two models whose pinned hashes are replaced by the fake files' hashes.
  const native = tgz(tarEntry("package/", ""), tarEntry("package/sherpa-onnx.node", "ADDON", 0o755), tarEntry("package/libx.so", "LIB"))
  const target: SherpaTarget = { pkg: "sherpa-onnx-linux-x64", url: "https://registry.npmjs.org/p.tgz", integrity: integrityOf(native), bytes: native.length }
  const body = (path: string) => enc.encode(`file:${path}`)

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

  // Use the real model specs but patch their hashes/sizes to the fake bodies for the duration of these tests.
  function patchModels(): () => void {
    const saved = [STREAMING_MODEL, OFFLINE_MODEL].map((m) => m.files.map((f) => ({ ...f })))
    for (const m of [STREAMING_MODEL, OFFLINE_MODEL]) {
      for (const f of m.files) {
        const b = body(f.path)
        f.size = b.length
        f.sha256 = sha256Hex(b)
      }
    }
    return () => [STREAMING_MODEL, OFFLINE_MODEL].forEach((m, i) => m.files.forEach((f, j) => Object.assign(f, saved[i]![j]!)))
  }

  const run = async (storage: string, w: ReturnType<typeof world>, signal?: AbortSignal) => {
    // sherpaTarget("linux","x64") is the real pinned one; swap its integrity for the fake tarball for this run.
    const real = sherpaTarget("linux", "x64")!
    const saved = { ...real }
    Object.assign(real, target)
    const restore = patchModels()
    try {
      return await ensureLocal({ storage, platform: "linux", arch: "x64", fetch: w.fetch, signal })
    } finally {
      Object.assign(real, saved)
      restore()
    }
  }

  test("downloads, verifies, extracts into the versioned folders and writes ready markers", async () => {
    const storage = tmp()
    const w = world()
    const paths = await run(storage, w)
    expect(paths.nativeDir).toBe(layout(storage, target).nativeDir)
    expect(await readFile(join(paths.nativeDir, "sherpa-onnx.node"), "utf8")).toBe("ADDON")
    expect(await readFile(join(paths.nativeDir, "libx.so"), "utf8")).toBe("LIB")
    expect(await readFile(paths.streaming.tokens, "utf8")).toBe("file:lang/tokens.txt")
    expect(await readFile(paths.offline.encoder, "utf8")).toBe("file:int8/encoder.onnx")
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
    const state = await localState({ storage, platform: "linux", arch: "x64" })
    expect(state.native).toBe(false)
    expect(readdirSync(join(storage, "local-voice/v1")).filter((n) => n !== "native" && n !== "models")).toEqual([])
    expect(existsSync(join(storage, "local-voice/v1/native")) ? readdirSync(join(storage, "local-voice/v1/native")) : []).toEqual([])
  })

  test("a damaged model file is rejected; what was already verified is kept, the broken model is not", async () => {
    const storage = tmp()
    await expect(run(storage, world({ corrupt: "SayedShaun" }))).rejects.toThrow(/failed verification/)
    const state = await localState({ storage, platform: "linux", arch: "x64" })
    expect(state).toMatchObject({ native: true, streaming: true, offline: false })
    expect(isInstalled(state)).toBe(false)
    // Repair: the next run fetches only what is missing.
    const w = world()
    await run(storage, w)
    expect(w.calls).toHaveLength(4)
    expect(isInstalled(await localState({ storage, platform: "linux", arch: "x64" }))).toBe(true)
  })

  test("a folder is not used when a file has the wrong size (partial or tampered)", async () => {
    const storage = tmp()
    const paths = await run(storage, world())
    await writeFile(paths.streaming.encoder, "short")
    const state = await localState({ storage, platform: "linux", arch: "x64" })
    expect(state.streaming).toBe(false)
    expect(missingBytes({ ...state, target })).toBeGreaterThan(0)
    const w = world()
    await run(storage, w)
    expect(w.calls).toHaveLength(4) // the damaged model only
    expect(await readFile(paths.streaming.encoder, "utf8")).toBe("file:am-onnx/encoder.onnx")
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

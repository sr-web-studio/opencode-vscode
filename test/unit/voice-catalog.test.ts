import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { modelConfig } from "../../src/companion/sherpa"
import { sherpaTarget } from "../../src/core/local-voice"
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_PACKS,
  OFFLINE_KINDS,
  REQUIRED_ROLES,
  STREAMING_KINDS,
  applyTextStyle,
  displayName,
  downloadBytes,
  downloadDetail,
  downloadWhat,
  languageItems,
  megabytes,
  modelBytes,
  modelUrl,
  modelsToRemove,
  normalizeLanguage,
  packBytes,
  packById,
  packFor,
  packModels,
  type LanguagePack,
  type ModelSpec,
} from "../../src/core/voice-catalog"

const root = join(import.meta.dir, "..", "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")
const allModels = (): ModelSpec[] => LANGUAGE_PACKS.flatMap((p) => packModels(p)).filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i)

describe("catalog validity", () => {
  test("pack ids are unique, lowercase codes; the default exists and is English", () => {
    const ids = LANGUAGE_PACKS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z]{2,3}(-[a-z]+)?$/)
    expect(DEFAULT_LANGUAGE).toBe("en")
    expect(packById("en")).toBeDefined()
    expect(packById("bn")).toBeDefined()
  })

  test("every pack is named in English and its own language, and has a streaming model that can stream", () => {
    for (const p of LANGUAGE_PACKS) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.native.length).toBeGreaterThan(0)
      expect(STREAMING_KINDS).toContain(p.streaming.kind)
      if (p.offline) expect(OFFLINE_KINDS).toContain(p.offline.kind)
    }
    expect(displayName(packById("bn")!)).toBe("Bangla (বাংলা)")
    expect(displayName(packById("en")!)).toBe("English")
  })

  test("a model id is one model everywhere it is used (same repo, rev and files), ids and folder names are unique", () => {
    const seen = new Map<string, ModelSpec>()
    for (const p of LANGUAGE_PACKS) {
      for (const m of packModels(p)) {
        const other = seen.get(m.id)
        if (other) expect(other).toEqual(m)
        seen.set(m.id, m)
      }
    }
    for (const m of [...seen.values()]) expect(m.id).toMatch(/^[a-z0-9][a-z0-9._-]*$/)
  })

  test("every model: pinned commit, license, attribution, source, files with size and sha256, all roles its kind needs", () => {
    for (const m of allModels()) {
      expect(m.rev).toMatch(/^[0-9a-f]{40}$/)
      expect(m.repo).toMatch(/^[\w.-]+\/[\w.-]+$/)
      expect(m.license.length).toBeGreaterThan(0)
      expect(m.licenseUrl).toMatch(/^https:\/\//)
      expect(m.source).toMatch(/^https:\/\//)
      expect(m.title.length).toBeGreaterThan(0)
      expect(m.author.length).toBeGreaterThan(0)
      const names = m.files.map((f) => f.name)
      expect(new Set(names).size).toBe(names.length)
      for (const f of m.files) {
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(f.size).toBeGreaterThan(0)
        expect(f.name).toMatch(/^[\w.-]+$/) // a plain file name: never a path
        expect(f.path).not.toContain("..")
      }
      const roles = m.files.map((f) => f.role)
      for (const need of REQUIRED_ROLES[m.kind]) expect(roles).toContain(need)
      expect(new Set(roles).size).toBe(roles.length)
    }
  })

  test("every catalog model's source and license are listed in companion/NOTICE, the companion README and docs/local-voice.md", () => {
    const docs = [read("companion/NOTICE"), read("companion/README.md"), read("docs/local-voice.md")].map((d) => d.replace(/\s+/g, " "))
    const spelled = (license: string): string[] => (license === "Apache-2.0" ? ["Apache-2.0", "Apache License 2.0"] : [license])
    for (const m of allModels()) {
      for (const doc of docs) {
        expect(doc).toContain(m.source)
        expect(spelled(m.license).some((s) => doc.includes(s))).toBe(true)
      }
      expect(read("companion/NOTICE")).toContain(m.rev) // the notice names the pinned revision
    }
  })

  test("package.json offers exactly the catalog's languages, English first and default", () => {
    const pkg = JSON.parse(read("package.json")) as { contributes: { configuration: { properties: Record<string, { enum?: string[]; enumItemLabels?: string[]; enumDescriptions?: string[]; default?: unknown }> }; commands: Array<{ command: string; title: string }> } }
    const setting = pkg.contributes.configuration.properties["opencode.voice.localLanguage"]!
    expect(setting.enum).toEqual(LANGUAGE_PACKS.map((p) => p.id))
    expect(setting.enumItemLabels).toEqual(LANGUAGE_PACKS.map((p) => displayName(p)))
    expect(setting.enumDescriptions).toHaveLength(LANGUAGE_PACKS.length)
    expect(setting.default).toBe(DEFAULT_LANGUAGE)
    expect(pkg.contributes.commands.find((c) => c.command === "opencode.voice.chooseLanguage")?.title).toBe("Choose Voice Language")
    expect(JSON.stringify(pkg.contributes.configuration)).not.toMatch(/Bangla only/i)
  })

  test("English: streaming transducer + cased/punctuated offline model, total under 250 MB with the engine", () => {
    const en = packById("en")!
    expect(en.streaming.kind).toBe("transducer")
    expect(en.offline?.kind).toBe("moonshine")
    for (const m of packModels(en)) expect(["Apache-2.0", "MIT"]).toContain(m.license)
    const total = downloadBytes(sherpaTarget("linux", "x64")!, en)
    expect(total / 1e6).toBeLessThan(250)
  })

  test("Bangla: the two models keep their ids, repos and pinned revisions", () => {
    const bn = packById("bn")!
    expect(bn.streaming).toMatchObject({ id: "streaming-bn-vosk-501097a", repo: "alphacep/vosk-model-small-streaming-bn", rev: "501097ae5257e5859d7956b50e4ba53a3f2be106", license: "Apache-2.0" })
    expect(bn.offline).toMatchObject({ id: "offline-bn-sayed-16bec01", repo: "SayedShaun/bangla-zipformer-onnx", rev: "16bec01c5f554d3f0dc8f0139de3a00839a72efc", license: "CC BY-SA 4.0" })
    expect(bn.streaming.files.map((f) => f.name)).toEqual(["encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt"])
    expect(bn.offline!.files.map((f) => f.path)).toEqual(["int8/encoder.onnx", "int8/decoder.onnx", "int8/joiner.onnx", "tokens.txt"])
  })

  test("download URLs point at the pinned commit", () => {
    const en = packById("en")!
    expect(modelUrl(en.streaming, en.streaming.files[0]!)).toBe(
      "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/672fbf1b30579d6585301139bb363f42a0ad4a24/encoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx",
    )
  })
})

/* ------------------------------------------------------------ adding a language is data only */

const MOCK_A: ModelSpec = { id: "m-a", kind: "transducer", title: "A", author: "x", license: "Apache-2.0", licenseUrl: "https://x", source: "https://x", repo: "o/a", rev: "1".repeat(40), files: [{ path: "a", name: "a", role: "encoder", size: 100, sha256: "0".repeat(64) }] }
const MOCK_B: ModelSpec = { ...MOCK_A, id: "m-b", files: [{ path: "b", name: "b", role: "encoder", size: 40, sha256: "0".repeat(64) }] }
const MOCK_S: ModelSpec = { ...MOCK_A, id: "m-shared", files: [{ path: "s", name: "s", role: "encoder", size: 1000, sha256: "0".repeat(64) }] }
const pack = (id: string, streaming: ModelSpec, offline?: ModelSpec): LanguagePack => ({ id, name: id.toUpperCase(), native: id.toUpperCase(), streaming, offline })
const FAKE: LanguagePack[] = [pack("aa", MOCK_A, MOCK_S), pack("bb", MOCK_B, MOCK_S), pack("cc", MOCK_S)]

describe("download size", () => {
  const engine = { bytes: 11_005_484 }
  test("engine + every model of the pack, shown in MB", () => {
    const en = packById("en")!
    expect(packBytes(en)).toBe(modelBytes(en.streaming) + modelBytes(en.offline!))
    expect(downloadBytes(engine, en)).toBe(engine.bytes + packBytes(en))
    expect(megabytes(downloadBytes(engine, en))).toBe(String(Math.round(downloadBytes(engine, en) / 1e6)))
  })
  test("the engine counts only when it is not installed yet", () => {
    const en = packById("en")!
    expect(downloadBytes(engine, en, { native: true })).toBe(packBytes(en))
    expect(downloadBytes(engine, en, { native: false })).toBe(packBytes(en) + engine.bytes)
  })
  test("a model that is already on disk (or shared with a downloaded pack) is not counted again", () => {
    expect(packBytes(FAKE[0]!)).toBe(1100)
    expect(packBytes(FAKE[0]!, { models: ["m-shared"] })).toBe(100)
    expect(downloadBytes(engine, FAKE[1]!, { native: true, models: ["m-shared"] })).toBe(40)
    expect(downloadBytes(engine, FAKE[2]!, { native: true, models: ["m-shared"] })).toBe(0)
  })
  test("a model used for both roles of a pack is one download", () => {
    expect(packModels(pack("dd", MOCK_A, MOCK_A))).toEqual([MOCK_A])
    expect(packBytes(pack("dd", MOCK_A, MOCK_A))).toBe(100)
    expect(packBytes(pack("ee", MOCK_A))).toBe(100)
  })
})

describe("language setting", () => {
  test("unknown, empty or non-string values become English; case and spaces are forgiven", () => {
    expect(normalizeLanguage(undefined)).toBe("en")
    expect(normalizeLanguage(null)).toBe("en")
    expect(normalizeLanguage("")).toBe("en")
    expect(normalizeLanguage("klingon")).toBe("en")
    expect(normalizeLanguage(7)).toBe("en")
    expect(normalizeLanguage("bn")).toBe("bn")
    expect(normalizeLanguage(" BN ")).toBe("bn")
    expect(normalizeLanguage("aa", FAKE)).toBe("aa")
    expect(normalizeLanguage("bn", FAKE)).toBe("en")
    expect(packFor("bn").id).toBe("bn")
    expect(packFor("nope").id).toBe("en")
    expect(packFor("nope", FAKE).id).toBe("aa") // a catalog without `en`: its first pack
  })
  test("text style: English streaming text is shown in lower case until the offline text replaces it", () => {
    expect(packById("en")!.streamingText).toBe("lowercase")
    expect(applyTextStyle("lowercase", "HELLO WORLD")).toBe("hello world")
    expect(applyTextStyle(undefined, "HELLO")).toBe("HELLO")
  })
})

describe("QuickPick items", () => {
  test("every language with name, size and the current mark; installed ones say downloaded", () => {
    const items = languageItems({ installed: ["bn"], current: "en" })
    expect(items.map((i) => i.id)).toEqual(LANGUAGE_PACKS.map((p) => p.id))
    const en = items.find((i) => i.id === "en")!
    const bn = items.find((i) => i.id === "bn")!
    expect(en.label).toBe("English")
    expect(en.description).toBe(`current · ${megabytes(packBytes(packById("en")!))} MB download`)
    expect(bn.label).toBe("Bangla (বাংলা)")
    expect(bn.description).toBe("downloaded")
    expect(bn.detail).toContain("CC BY-SA 4.0")
  })
  test("an older companion (unknown) marks nothing as downloaded; a current installed language shows both marks", () => {
    const unknown = languageItems({ installed: undefined, current: "bn" })
    expect(unknown.every((i) => !i.description.includes("downloaded"))).toBe(true)
    expect(unknown.find((i) => i.id === "bn")!.description).toContain("current")
    expect(languageItems({ installed: ["en"], current: "en" })[0]!.description).toBe("current · downloaded")
  })
  test("works for any catalog (a new language appears with its size)", () => {
    const items = languageItems({ installed: [], current: "aa", packs: FAKE })
    expect(items.map((i) => i.label)).toEqual(["AA", "BB", "CC"])
    expect(items[0]!.description).toBe("current · 0.0 MB download".replace("0.0", megabytes(1100)))
  })
})

describe("download prompt", () => {
  test("names the pack, and the engine only when it is missing", () => {
    expect(downloadWhat(packById("en")!, true)).toBe("speech engine + English models")
    expect(downloadWhat(packById("bn")!, false)).toBe("Bangla models")
  })
  test("attribution of every model of the pack: author, license, source (CC BY-SA included)", () => {
    const bn = downloadDetail(packById("bn")!)
    expect(bn).toContain("Sayed Shaun")
    expect(bn).toContain("CC BY-SA 4.0")
    expect(bn).toContain("https://huggingface.co/SayedShaun/bangla-zipformer-onnx")
    expect(bn).toContain("Apache-2.0")
    const en = downloadDetail(packById("en")!)
    expect(en).toContain("Moonshine")
    expect(en).toContain("MIT")
    expect(en).toContain("https://github.com/moonshine-ai/moonshine")
    expect(en).toContain("sherpa-onnx (Apache-2.0)")
  })
})

describe("removing languages", () => {
  test("keeps models another installed pack still uses", () => {
    expect(modelsToRemove(["aa"], ["aa", "bb"], FAKE).map((m) => m.id)).toEqual(["m-a"])
    expect(modelsToRemove(["aa", "bb"], ["aa", "bb"], FAKE).map((m) => m.id)).toEqual(["m-a", "m-shared", "m-b"])
    expect(modelsToRemove(["aa", "bb"], ["aa", "bb", "cc"], FAKE).map((m) => m.id)).toEqual(["m-a", "m-b"])
    expect(modelsToRemove(["zz"], ["aa"], FAKE)).toEqual([])
  })
})

describe("sherpa model configuration", () => {
  const paths = (kind: "transducer" | "moonshine") => ({
    kind,
    files: { encoder: "/e", decoder: "/d", joiner: "/j", tokens: "/t", preprocessor: "/p", uncachedDecoder: "/u", cachedDecoder: "/c" },
  })
  test("transducer and moonshine map every role to the addon's field", () => {
    expect(modelConfig(paths("transducer"), 3)).toEqual({ transducer: { encoder: "/e", decoder: "/d", joiner: "/j" }, tokens: "/t", numThreads: 3, provider: "cpu", debug: 0 })
    expect(modelConfig(paths("moonshine"), 2)).toEqual({ moonshine: { preprocessor: "/p", encoder: "/e", uncachedDecoder: "/u", cachedDecoder: "/c" }, tokens: "/t", numThreads: 2, provider: "cpu", debug: 0 })
  })
  test("an unknown kind is an error, not a silent wrong configuration", () => {
    expect(() => modelConfig({ kind: "whisper" as never, files: {} }, 1)).toThrow(/not supported/)
  })
})

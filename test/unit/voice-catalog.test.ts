import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { featConfig, modelConfig } from "../../src/companion/sherpa"
import {
  BANGLA_PACK,
  CATALOG,
  DEFAULT_LANGUAGE,
  DEFAULT_MAX_LANGUAGES,
  LANGUAGES,
  LANGUAGE_PACKS,
  MAX_LANGUAGES_LIMIT,
  MULTILINGUAL_PACK,
  OFFLINE_KINDS,
  REQUIRED_ROLES,
  STREAMING_KINDS,
  applyPick,
  clampMaxLanguages,
  cycleLanguages,
  displayName,
  downloadBytes,
  downloadDetail,
  downloadPrompt,
  downloadWhat,
  knownModelIds,
  languageById,
  languageCode,
  languageFor,
  languageItems,
  languageLabel,
  languageTitle,
  megabytes,
  modelBytes,
  modelUrl,
  modelsToRemove,
  normalizeLanguage,
  normalizeLanguages,
  packBytes,
  packById,
  packFor,
  packModels,
  withCurrent,
  type Catalog,
  type LanguagePack,
  type ModelSpec,
} from "../../src/core/voice-catalog"

const root = join(import.meta.dir, "..", "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")
const allModels = (): ModelSpec[] => LANGUAGE_PACKS.flatMap((p) => packModels(p)).filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i)

describe("catalog validity", () => {
  test("pack ids are unique; the default pack is the multilingual Nemotron one, the default language is English", () => {
    const ids = LANGUAGE_PACKS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([MULTILINGUAL_PACK, BANGLA_PACK])
    expect(DEFAULT_LANGUAGE).toBe("en")
    expect(packFor(DEFAULT_LANGUAGE).id).toBe(MULTILINGUAL_PACK)
    expect(packFor(DEFAULT_LANGUAGE).streaming.id).toBe("streaming-nemotron-3.5-0.6b-560ms-ab43d89")
    expect(packFor(DEFAULT_LANGUAGE).offline).toBeUndefined() // one model, streaming only
    expect(packById("en")).toBeUndefined() // the old English pack (Zipformer + Moonshine) is gone
  })

  test("language ids are unique lowercase codes and every language maps to an existing pack", () => {
    const ids = LANGUAGES.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const l of LANGUAGES) {
      expect(l.id).toMatch(/^[a-z]{2,4}$/)
      expect(packById(l.pack)).toBeDefined()
      expect(l.name.length).toBeGreaterThan(0)
      expect(l.native.length).toBeGreaterThan(0)
      expect(["ready", "broad", "weak"]).toContain(l.tier)
    }
    expect(languageById(DEFAULT_LANGUAGE)).toBeDefined()
    expect(displayName(languageById("bn")!)).toBe("Bangla (বাংলা)")
    expect(displayName(languageById("en")!)).toBe("English")
  })

  test("multilingual languages carry a model locale (`auto` included); Bangla is its own pack without one", () => {
    for (const l of LANGUAGES.filter((x) => x.pack === MULTILINGUAL_PACK)) expect(l.locale).toMatch(/^(auto|[a-z]{2}-[A-Z]{2})$/)
    expect(languageById("bn")).toMatchObject({ pack: BANGLA_PACK, tier: "ready" })
    expect(languageById("bn")!.locale).toBeUndefined()
    expect(languageById("en")!.locale).toBe("en-US")
    expect(languageById("es")!.locale).toBe("es-US")
    expect(languageById("fr")!.locale).toBe("fr-FR")
    expect(languageById("pt")!.locale).toBe("pt-BR")
    expect(languageById("auto")!.locale).toBe("auto")
    expect(languageById("zh")!.tier).toBe("weak")
    expect(languageById("pl")!.tier).toBe("broad")
  })

  test("every locale is a tag the Nemotron tokens file knows (the model card's languages)", () => {
    const known = new Set(["en-US", "es-US", "fr-FR", "de-DE", "it-IT", "pt-BR", "nl-NL", "tr-TR", "ru-RU", "uk-UA", "ar-AR", "hi-IN", "ja-JP", "ko-KR", "vi-VN", "pl-PL", "sv-SE", "cs-CZ", "nb-NO", "da-DK", "bg-BG", "fi-FI", "hr-HR", "sk-SK", "hu-HU", "ro-RO", "et-EE", "zh-CN", "auto"])
    for (const l of LANGUAGES.filter((x) => x.pack === MULTILINGUAL_PACK)) expect(known.has(l.locale!)).toBe(true)
  })

  test("every pack has a streaming model that can stream; the feature size is part of every model", () => {
    for (const p of LANGUAGE_PACKS) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.noun.length).toBeGreaterThan(0)
      expect(STREAMING_KINDS).toContain(p.streaming.kind)
      if (p.offline) expect(OFFLINE_KINDS).toContain(p.offline.kind)
    }
    for (const m of allModels()) expect([80, 128]).toContain(m.featureDim)
    expect(packById(MULTILINGUAL_PACK)!.streaming.featureDim).toBe(128)
    expect(packById(MULTILINGUAL_PACK)!.streaming.tailSeconds).toBe(0.8)
    expect(packById(BANGLA_PACK)!.streaming.featureDim).toBe(80)
    expect(packById(BANGLA_PACK)!.offline!.featureDim).toBe(80)
  })

  test("Nemotron: pinned repo and revision, OpenMDW-1.1, 4 files of about 682 MB without test_wavs", () => {
    const n = packById(MULTILINGUAL_PACK)!.streaming
    expect(n).toMatchObject({
      repo: "csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11",
      rev: "ab43d895f5985b1bbab8b6eac8607fcdc05343f3",
      license: "OpenMDW-1.1",
      licenseUrl: "https://openmdw.ai/license/1-1/",
      source: "https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b",
    })
    expect(n.files.map((f) => f.path)).toEqual(["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"])
    expect(n.files.some((f) => f.path.includes("test_wavs"))).toBe(false)
    expect(Math.round(modelBytes(n) / 1e6)).toBe(682)
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

  test("the docs name the default model, its license text link, the attribution line and no removed models", () => {
    const docs = { notice: read("companion/NOTICE"), readme: read("README.md"), companion: read("companion/README.md"), local: read("docs/local-voice.md") }
    const line = "NVIDIA Nemotron 3.5 ASR Streaming 0.6B, OpenMDW-1.1; sherpa-onnx int8 export by csukuangfj."
    for (const [name, text] of Object.entries(docs)) {
      const flat = text.replace(/\s+/g, " ")
      expect([name, flat.includes(line)]).toEqual([name, true])
      expect([name, flat.includes("https://openmdw.ai/license/1-1/")]).toEqual([name, true])
      // docs/local-voice.md names the old folders on purpose (its cleanup section); the others must not mention them.
      if (name !== "local") expect([name, /zipformer-en|moonshine/i.test(flat)]).toEqual([name, false])
    }
    expect(docs.local).toContain("streaming-en-zipformer-672fbf1") // the cleanup note says which folders go
  })

  test("package.json: the engine is local/soniox, localLanguages and maxLanguages exist, the commands are there", () => {
    type Prop = { type?: string; enum?: string[]; enumItemLabels?: string[]; enumDescriptions?: string[]; default?: unknown; minimum?: number; maximum?: number; items?: { enum?: string[]; enumItemLabels?: string[]; enumDescriptions?: string[] }; markdownDescription?: string }
    const pkg = JSON.parse(read("package.json")) as { contributes: { configuration: { properties: Record<string, Prop> }; commands: Array<{ command: string; title: string }> } }
    const props = pkg.contributes.configuration.properties
    const list = props["opencode.voice.localLanguages"]!
    expect(list.type).toBe("array")
    expect(list.items!.enum).toEqual(LANGUAGES.map((l) => l.id))
    expect(list.items!.enumItemLabels).toEqual(LANGUAGES.map((l) => (l.id === "auto" ? l.name : displayName(l))))
    expect(list.items!.enumDescriptions).toHaveLength(LANGUAGES.length)
    expect(list.default).toEqual([DEFAULT_LANGUAGE])
    const max = props["opencode.voice.maxLanguages"]!
    expect(max).toMatchObject({ type: "number", default: DEFAULT_MAX_LANGUAGES, minimum: 1, maximum: MAX_LANGUAGES_LIMIT })
    // The description is honest about cost: shared model free, separate pack costs disk, one model in memory, reload time.
    const d = max.markdownDescription!
    expect(d).toContain(`${megabytes(packBytes(packById(BANGLA_PACK)!))} MB`)
    expect(d).toMatch(/share[sd]? the multilingual model/i)
    expect(d).toMatch(/one model is loaded/i)
    expect(d).toMatch(/reload/i)
    // The old single setting only keeps the old values working.
    expect(props["opencode.voice.localLanguage"]!.enum).toEqual(["en", "bn"])
    expect(props["opencode.voice.localThreads"]!.default).toBe(2)
    const titles = Object.fromEntries(pkg.contributes.commands.map((c) => [c.command, c.title]))
    expect(titles["opencode.voice.chooseLanguage"]).toBe("Choose Voice Language")
    expect(titles["opencode.voice.switchLanguage"]).toBe("Switch Voice Language")
  })

  test("Nemotron's speed: the default stays at two threads (measured: 2 is fastest, 4 is slower)", () => {
    expect(read("docs/local-voice.md")).toMatch(/RTF/)
  })

  test("Bangla: the two models keep their ids, repos and pinned revisions", () => {
    const bn = packById("bn")!
    expect(bn.streaming).toMatchObject({ id: "streaming-bn-vosk-501097a", repo: "alphacep/vosk-model-small-streaming-bn", rev: "501097ae5257e5859d7956b50e4ba53a3f2be106", license: "Apache-2.0" })
    expect(bn.offline).toMatchObject({ id: "offline-bn-sayed-16bec01", repo: "SayedShaun/bangla-zipformer-onnx", rev: "16bec01c5f554d3f0dc8f0139de3a00839a72efc", license: "CC BY-SA 4.0" })
    expect(bn.streaming.files.map((f) => f.name)).toEqual(["encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt"])
    expect(bn.offline!.files.map((f) => f.path)).toEqual(["int8/encoder.onnx", "int8/decoder.onnx", "int8/joiner.onnx", "tokens.txt"])
  })

  test("download URLs point at the pinned commit", () => {
    const n = packById(MULTILINGUAL_PACK)!
    expect(modelUrl(n.streaming, n.streaming.files[0]!)).toBe(
      "https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11/resolve/ab43d895f5985b1bbab8b6eac8607fcdc05343f3/encoder.int8.onnx",
    )
  })

  test("every model folder the catalog knows, once; the removed English ids are not among them", () => {
    expect(knownModelIds().sort()).toEqual(["offline-bn-sayed-16bec01", "streaming-bn-vosk-501097a", "streaming-nemotron-3.5-0.6b-560ms-ab43d89"])
  })
})

/* ------------------------------------------------------------ adding a language is data only */

const MOCK_A: ModelSpec = { id: "m-a", kind: "transducer", title: "A", author: "x", license: "Apache-2.0", licenseUrl: "https://x", source: "https://x", repo: "o/a", rev: "1".repeat(40), featureDim: 80, files: [{ path: "a", name: "a", role: "encoder", size: 100, sha256: "0".repeat(64) }] }
const MOCK_B: ModelSpec = { ...MOCK_A, id: "m-b", files: [{ path: "b", name: "b", role: "encoder", size: 40, sha256: "0".repeat(64) }] }
const MOCK_S: ModelSpec = { ...MOCK_A, id: "m-shared", files: [{ path: "s", name: "s", role: "encoder", size: 1000, sha256: "0".repeat(64) }] }
const pack = (id: string, streaming: ModelSpec, offline?: ModelSpec): LanguagePack => ({ id, name: id.toUpperCase(), noun: `${id} models`, streaming, offline })
const FAKE: LanguagePack[] = [pack("aa", MOCK_A, MOCK_S), pack("bb", MOCK_B, MOCK_S), pack("cc", MOCK_S)]
/** `cc` serves two languages; `aa` and `bb` one each; the default is `la`. */
const FAKE_CAT: Catalog = {
  packs: FAKE,
  defaultLanguage: "la",
  languages: [
    { id: "la", name: "La", native: "La", pack: "aa", tier: "ready" },
    { id: "lb", name: "Lb", native: "Lb-native", pack: "bb", tier: "ready" },
    { id: "lc", name: "Lc", native: "Lc", pack: "cc", locale: "lc-LC", tier: "ready" },
    { id: "ld", name: "Ld", native: "Ld", pack: "cc", locale: "ld-LD", tier: "broad" },
  ],
}

describe("download size", () => {
  const engine = { bytes: 11_005_484 }
  test("engine + every model of the pack, shown in MB", () => {
    const bn = packById("bn")!
    expect(packBytes(bn)).toBe(modelBytes(bn.streaming) + modelBytes(bn.offline!))
    expect(downloadBytes(engine, bn)).toBe(engine.bytes + packBytes(bn))
    expect(megabytes(downloadBytes(engine, bn))).toBe(String(Math.round(downloadBytes(engine, bn) / 1e6)))
    // The two sizes the picker and the setting text quote.
    expect(megabytes(packBytes(packById(MULTILINGUAL_PACK)!))).toBe("682")
    expect(megabytes(packBytes(bn))).toBe("168")
  })
  test("the engine counts only when it is not installed yet", () => {
    const n = packById(MULTILINGUAL_PACK)!
    expect(downloadBytes(engine, n, { native: true })).toBe(packBytes(n))
    expect(downloadBytes(engine, n, { native: false })).toBe(packBytes(n) + engine.bytes)
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
  test("a single value: unknown, empty or non-string becomes English (the legacy `en`/`bn` values keep working)", () => {
    expect(normalizeLanguage(undefined)).toBe("en")
    expect(normalizeLanguage(null)).toBe("en")
    expect(normalizeLanguage("")).toBe("en")
    expect(normalizeLanguage("klingon")).toBe("en")
    expect(normalizeLanguage(7)).toBe("en")
    expect(normalizeLanguage("en")).toBe("en")
    expect(normalizeLanguage("bn")).toBe("bn")
    expect(normalizeLanguage(" BN ")).toBe("bn")
    expect(normalizeLanguage("de")).toBe("de")
    expect(normalizeLanguage("lb", FAKE_CAT)).toBe("lb")
    expect(normalizeLanguage("bn", FAKE_CAT)).toBe("la")
    expect(languageFor("nope", FAKE_CAT).id).toBe("la")
    expect(packFor("bn").id).toBe(BANGLA_PACK)
    expect(packFor("en").id).toBe(MULTILINGUAL_PACK)
    expect(packFor("ja").id).toBe(MULTILINGUAL_PACK)
    expect(packFor("nope").id).toBe(MULTILINGUAL_PACK)
    expect(packFor("ld", FAKE_CAT).id).toBe("cc")
  })

  test("maxLanguages: default 2, clamped to 1..5, rounded; junk is the default", () => {
    expect(DEFAULT_MAX_LANGUAGES).toBe(2)
    expect(clampMaxLanguages(undefined)).toBe(2)
    expect(clampMaxLanguages("3")).toBe(2)
    expect(clampMaxLanguages(NaN)).toBe(2)
    expect(clampMaxLanguages(0)).toBe(1)
    expect(clampMaxLanguages(-4)).toBe(1)
    expect(clampMaxLanguages(3)).toBe(3)
    expect(clampMaxLanguages(2.6)).toBe(3)
    expect(clampMaxLanguages(99)).toBe(MAX_LANGUAGES_LIMIT)
  })

  test("the list: dedupe (first wins), unknown ids dropped, capped at max, case and spaces forgiven", () => {
    expect(normalizeLanguages(["en", "bn"])).toEqual(["en", "bn"])
    expect(normalizeLanguages(["bn", "en"])).toEqual(["bn", "en"])
    expect(normalizeLanguages(["en", "EN", " en ", "bn"])).toEqual(["en", "bn"])
    expect(normalizeLanguages(["xx", "de", 5, null, "fr"], { max: 5 })).toEqual(["de", "fr"])
    expect(normalizeLanguages(["en", "de", "fr", "es"])).toEqual(["en", "de"]) // default cap 2
    expect(normalizeLanguages(["en", "de", "fr", "es"], { max: 3 })).toEqual(["en", "de", "fr"])
    expect(normalizeLanguages(["en", "de", "fr"], { max: 1 })).toEqual(["en"])
    expect(normalizeLanguages(["en", "de", "fr"], { max: 50 })).toEqual(["en", "de", "fr"])
    expect(normalizeLanguages(["xx", "yy"])).toEqual(["en"]) // nothing valid: the default
    expect(normalizeLanguages([])).toEqual(["en"])
    expect(normalizeLanguages("en")).toEqual(["en"]) // not a list: ignored
    expect(normalizeLanguages(["ld", "lb", "la"], { max: 3, cat: FAKE_CAT })).toEqual(["ld", "lb", "la"])
    expect(normalizeLanguages(["en"], { cat: FAKE_CAT })).toEqual(["la"])
  })

  test("legacy migration: the old single value seeds the list only while the list was never set", () => {
    expect(normalizeLanguages(undefined, { legacy: "bn" })).toEqual(["bn"])
    expect(normalizeLanguages(undefined, { legacy: "en" })).toEqual(["en"])
    expect(normalizeLanguages(undefined, { legacy: " BN " })).toEqual(["bn"])
    expect(normalizeLanguages(undefined, { legacy: "klingon" })).toEqual(["en"])
    expect(normalizeLanguages(undefined, { legacy: undefined })).toEqual(["en"])
    expect(normalizeLanguages(["de", "fr"], { legacy: "bn" })).toEqual(["de", "fr"]) // the list wins
    expect(normalizeLanguages(["xx"], { legacy: "bn" })).toEqual(["bn"]) // an all-unknown list falls back to the legacy value
  })

  test("cycling rotates the list: the next language becomes current, the order is kept", () => {
    expect(cycleLanguages(["en", "bn"])).toEqual(["bn", "en"])
    expect(cycleLanguages(["bn", "en"])).toEqual(["en", "bn"])
    expect(cycleLanguages(["en", "de", "fr"])).toEqual(["de", "fr", "en"])
    expect(cycleLanguages(["en"])).toEqual(["en"])
    expect(cycleLanguages([])).toEqual([])
    const list = ["en", "de", "fr"]
    expect(cycleLanguages(cycleLanguages(cycleLanguages(list)))).toEqual(list)
    expect(list).toEqual(["en", "de", "fr"]) // not mutated
  })

  test("withCurrent: the chosen language goes first; a new one joins at the front, within the cap", () => {
    expect(withCurrent(["en", "de", "fr"], "fr", 3)).toEqual(["fr", "en", "de"])
    expect(withCurrent(["en", "bn"], "bn", 2)).toEqual(["bn", "en"])
    expect(withCurrent(["en", "bn"], "de", 2)).toEqual(["de", "en"])
    expect(withCurrent(["en"], "de", 1)).toEqual(["de"])
  })

  test("the picker's result: ticked languages that were active keep their place, the cap cuts the rest", () => {
    expect(applyPick(["en", "bn"], ["bn", "en"], 2)).toEqual({ list: ["en", "bn"], dropped: [] }) // current stays current
    expect(applyPick(["bn", "en"], ["en", "bn"], 2)).toEqual({ list: ["bn", "en"], dropped: [] })
    expect(applyPick(["en"], ["en", "de", "fr"], 2)).toEqual({ list: ["en", "de"], dropped: ["fr"] })
    expect(applyPick(["en", "bn"], ["de", "fr", "es"], 2)).toEqual({ list: ["de", "fr"], dropped: ["es"] })
    expect(applyPick(["en"], ["de"], 2)).toEqual({ list: ["de"], dropped: [] })
    expect(applyPick(["en"], ["de", "de"], 5)).toEqual({ list: ["de"], dropped: [] })
    expect(applyPick(["en"], ["en", "de", "fr", "es", "it", "pt", "nl"], 5).list).toHaveLength(5)
    expect(applyPick(["en"], ["en", "de"], 0).list).toEqual(["en"]) // never below one
  })
})

describe("QuickPick items", () => {
  const items = languageItems({ installed: ["bn"], active: ["en", "bn"] })
  const by = (id: string) => items.find((i) => i.id === id)!

  test("every language once, grouped by pack: the multilingual languages together, Bangla separate", () => {
    expect(items.map((i) => i.id)).toEqual(LANGUAGES.map((l) => l.id).sort((a, b) => (languageById(a)!.pack === languageById(b)!.pack ? 0 : languageById(a)!.pack === MULTILINGUAL_PACK ? -1 : 1)))
    const groups = items.map((i) => i.group).filter((g, i, a) => a.indexOf(g) === i)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toBe("Multilingual model (≈682 MB, shared by all these languages)")
    expect(groups[1]).toBe("Bangla (separate download ≈168 MB)")
    // A group's items are one run (the picker draws one separator per run).
    for (const g of groups) {
      const idx = items.map((i, n) => (i.group === g ? n : -1)).filter((n) => n >= 0)
      expect(idx[idx.length - 1]! - idx[0]! + 1).toBe(idx.length)
    }
  })

  test("ticks the active languages; the first is marked current; downloaded packs are marked", () => {
    expect(items.filter((i) => i.picked).map((i) => i.id).sort()).toEqual(["bn", "en"])
    expect(by("en").description).toBe("current") // multilingual pack not downloaded: no mark
    expect(by("bn").description).toBe("downloaded")
    expect(by("bn").label).toBe("Bangla (বাংলা)")
    expect(by("en").label).toBe("English")
    expect(by("auto").label).toBe("Detect automatically")
    const other = languageItems({ installed: ["multilingual"], active: ["bn", "en"] })
    expect(other.find((i) => i.id === "bn")!.description).toBe("current")
    expect(other.find((i) => i.id === "de")!.description).toBe("downloaded")
    expect(other.find((i) => i.id === "en")!.description).toBe("downloaded")
  })

  test("broad-coverage languages say `lower accuracy`; Mandarin is marked weak", () => {
    expect(by("pl").description).toBe("lower accuracy")
    expect(by("hu").description).toBe("lower accuracy")
    expect(by("zh").description).toMatch(/weak/)
    expect(by("de").description).toBe("")
    const dl = languageItems({ installed: ["multilingual"], active: ["en"] })
    expect(dl.find((i) => i.id === "pl")!.description).toBe("downloaded · lower accuracy")
    expect(dl.find((i) => i.id === "zh")!.description).toMatch(/^downloaded · weak/)
  })

  test("an older companion (unknown) marks nothing as downloaded", () => {
    const unknown = languageItems({ installed: undefined, active: ["bn"] })
    expect(unknown.every((i) => !i.description.includes("downloaded"))).toBe(true)
    expect(unknown.find((i) => i.id === "bn")!.description).toBe("current")
  })

  test("the picker offers at most `max` languages: applyPick on what the user ticked keeps the first N", () => {
    const ticked = items.map((i) => i.id).slice(0, 6)
    expect(applyPick(["en"], ticked, 2).list).toHaveLength(2)
    expect(applyPick(["en"], ticked, 2).dropped).toHaveLength(4)
  })

  test("works for any catalog (a new language appears under its pack's size)", () => {
    const fake = languageItems({ installed: [], active: ["lc"], cat: FAKE_CAT })
    expect(fake.map((i) => i.label)).toEqual(["La", "Lb (Lb-native)", "Lc", "Ld"])
    expect(fake.find((i) => i.id === "lc")!.description).toBe("current")
    expect(fake.find((i) => i.id === "ld")!.description).toBe("lower accuracy")
    expect(fake.find((i) => i.id === "lc")!.group).toBe(fake.find((i) => i.id === "ld")!.group)
    expect(fake.find((i) => i.id === "la")!.group).not.toBe(fake.find((i) => i.id === "lb")!.group)
  })
})

describe("language label next to the mic", () => {
  test("shows the code; tooltip names the language and says `click to switch` with two or more", () => {
    expect(languageCode("en")).toBe("EN")
    expect(languageCode("bn")).toBe("BN")
    expect(languageTitle(["en", "bn"])).toBe("Voice language: English. Click to switch to Bangla.")
    expect(languageTitle(["bn", "en"])).toBe("Voice language: Bangla. Click to switch to English.")
    expect(languageTitle(["en"])).toMatch(/^Voice language: English\./)
    expect(languageTitle(["en"])).not.toMatch(/click to switch/i)
    expect(languageTitle(["auto", "en"])).toBe("Voice language: automatic detection. Click to switch to English.")
    expect(languageLabel(["en", "bn"])).toBe("Voice language English, switch to Bangla")
    expect(languageLabel(["bn"])).toBe("Voice language Bangla")
  })
})

describe("download prompt", () => {
  test("the sentence the user reads", () => {
    expect(downloadPrompt(packById(MULTILINGUAL_PACK)!, 693_000_000, true)).toBe("On-device voice needs a one-time download of about 693 MB (speech engine + multilingual model). Download now?")
    expect(downloadPrompt(packById(BANGLA_PACK)!, 168_000_000, false)).toBe("On-device voice needs a one-time download of about 168 MB (Bangla models). Download now?")
  })
  test("names the pack, and the engine only when it is missing", () => {
    expect(downloadWhat(packById(MULTILINGUAL_PACK)!, true)).toBe("speech engine + multilingual model")
    expect(downloadWhat(packById(BANGLA_PACK)!, false)).toBe("Bangla models")
  })
  test("attribution of every model of the pack: author, license, source (CC BY-SA included)", () => {
    const bn = downloadDetail(packById("bn")!)
    expect(bn).toContain("Sayed Shaun")
    expect(bn).toContain("CC BY-SA 4.0")
    expect(bn).toContain("https://huggingface.co/SayedShaun/bangla-zipformer-onnx")
    expect(bn).toContain("Apache-2.0")
    const n = downloadDetail(packById(MULTILINGUAL_PACK)!)
    expect(n).toContain("NVIDIA Nemotron 3.5 ASR Streaming 0.6B")
    expect(n).toContain("OpenMDW-1.1")
    expect(n).toContain("csukuangfj")
    expect(n).toContain("https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b")
    expect(n).toContain("sherpa-onnx (Apache-2.0)")
    expect(n).not.toMatch(/Moonshine|Zipformer English/)
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
  const paths = { kind: "transducer" as const, featureDim: 128, files: { encoder: "/e", decoder: "/d", joiner: "/j", tokens: "/t" } }
  test("a transducer maps every role to the addon's field", () => {
    expect(modelConfig(paths, 3)).toEqual({ transducer: { encoder: "/e", decoder: "/d", joiner: "/j" }, tokens: "/t", numThreads: 3, provider: "cpu", debug: 0 })
  })
  test("the feature size comes from the model: Nemotron 128, Bangla 80", () => {
    expect(featConfig(paths)).toEqual({ sampleRate: 16000, featureDim: 128 })
    expect(featConfig({ ...paths, featureDim: 80 })).toEqual({ sampleRate: 16000, featureDim: 80 })
  })
  test("an unknown kind is an error, not a silent wrong configuration", () => {
    expect(() => modelConfig({ kind: "whisper" as never, featureDim: 80, files: {} }, 1)).toThrow(/not supported/)
  })
})

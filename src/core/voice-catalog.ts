/**
 * The catalog of on-device voice: LANGUAGES (what the user picks: the language they speak) and PACKS (what is
 * downloaded: one or two models). Several languages can share one pack: the multilingual Nemotron pack serves
 * every language except Bangla, so it is downloaded once. Pure data plus small pure helpers (no `vscode`, no
 * `node:*`): the companion downloads and runs the models, the main extension shows the choice.
 *
 * ADDING A LANGUAGE of an existing pack is one line in `LANGUAGES`. ADDING A PACK is data-only too:
 *   1. Append an entry to `LANGUAGE_PACKS` below (models pinned to a Hugging Face commit; size and sha256 from
 *      `https://huggingface.co/api/models/<repo>/tree/<rev>?recursive=1`, where `lfs.oid` is the sha256; for files that
 *      are not LFS hash the downloaded file) and the languages that use it in `LANGUAGES`.
 *   2. Add the ids (and label/description) to `opencode.voice.localLanguages` in `package.json`.
 *   3. List the model in `companion/NOTICE`, `companion/README.md` and `docs/local-voice.md`.
 * `test/unit/voice-catalog.test.ts` fails when the catalog is invalid or `package.json` is out of step.
 * A model of a kind that `src/companion/sherpa.ts` cannot load yet (paraformer, NeMo CTC, Whisper, …) also needs one
 * `ModelKind` here (its required roles) and one loader branch there.
 *
 * Models are never part of the vsix: the user's own computer downloads them, and every file is verified by size and
 * SHA-256. Two packs that use the same model id share the download and the folder on disk.
 */

/** How sherpa-onnx has to be configured for a model. Add a kind here + a branch in `sherpa.ts` for a new family. */
export type ModelKind = "transducer"

/** What a file is for. A kind needs every role in `REQUIRED_ROLES[kind]`. */
export type ModelRole = "encoder" | "decoder" | "joiner" | "tokens"

export const REQUIRED_ROLES: Record<ModelKind, readonly ModelRole[]> = {
  transducer: ["encoder", "decoder", "joiner", "tokens"],
}

/** Kinds that can give live text while speaking (sherpa's online recognizer; `sherpa.ts` builds it). */
export const STREAMING_KINDS: readonly ModelKind[] = ["transducer"]
/** Kinds that can re-decode a finished segment (sherpa's offline recognizer). */
export const OFFLINE_KINDS: readonly ModelKind[] = ["transducer"]

/** `path` is the file in the repo, `name` the file name on disk (unique within the model). */
export type ModelFile = { path: string; name: string; role: ModelRole; size: number; sha256: string }

export type ModelSpec = {
  /** Folder name under `models/`: stable. Change it (and `rev`) when the pinned files change. */
  id: string
  kind: ModelKind
  /** Shown in the download prompt, with `author` and `license`. */
  title: string
  author: string
  /** SPDX-style name as shown to the user, e.g. `Apache-2.0`, `CC BY-SA 4.0`, `MIT`. */
  license: string
  licenseUrl: string
  /** Where the model comes from (its model card or project page): the attribution link. */
  source: string
  /** Hugging Face repo and the commit the files are pinned to. */
  repo: string
  rev: string
  /** Mel filter-bank size of the feature extractor (`featConfig.featureDim`): 80 for most models, 128 for Nemotron. */
  featureDim: number
  /**
   * Seconds of silence fed to the live model when recording stops, so the last word is decoded (default 0.5 s). Models
   * that decode in big chunks need more: Nemotron's 560 ms chunks lost the last word of a sentence at 0.5 s.
   */
  tailSeconds?: number
  files: ModelFile[]
}

/** A download: one or two models (live text, and an optional second model that re-decodes each finished segment). */
export type LanguagePack = {
  id: string
  /** English name, shown in the QuickPick group and the download prompt. */
  name: string
  /** What the download prompt calls it: "speech engine + <noun>" (e.g. `multilingual model`, `Bangla models`). */
  noun: string
  /** Live text while speaking. */
  streaming: ModelSpec
  /** Optional: decodes each finished segment again at a pause (better words, usually punctuation). */
  offline?: ModelSpec
}

/** `ready`: highest accuracy. `broad`: works, lower accuracy. `weak`: noticeably weaker (shown with a warning). */
export type Tier = "ready" | "broad" | "weak"

/** What the user picks: the language they speak. `pack` is the download that serves it. */
export type Language = {
  /** Value in `opencode.voice.localLanguages`: lower-case ISO 639-1 code, or `auto`. */
  id: string
  /** English name and the name in the language itself. */
  name: string
  native: string
  pack: string
  /** Multilingual packs: the value of the stream's `language` option (a model locale like `es-US`, or `auto`). */
  locale?: string
  tier: Tier
}

export type Catalog = { packs: readonly LanguagePack[]; languages: readonly Language[]; defaultLanguage: string }

const APACHE = "https://www.apache.org/licenses/LICENSE-2.0"
const CC_BY_SA = "https://creativecommons.org/licenses/by-sa/4.0/"
const OPENMDW = "https://openmdw.ai/license/1-1/"

/* ------------------------------------------------------------ Bangla (the ids are folder names on disk: keep them so existing downloads are reused) */

const BN_STREAMING: ModelSpec = {
  id: "streaming-bn-vosk-501097a",
  kind: "transducer",
  title: "Vosk small streaming Bengali",
  author: "Alpha Cephei",
  license: "Apache-2.0",
  licenseUrl: APACHE,
  source: "https://huggingface.co/alphacep/vosk-model-small-streaming-bn",
  repo: "alphacep/vosk-model-small-streaming-bn",
  rev: "501097ae5257e5859d7956b50e4ba53a3f2be106",
  featureDim: 80,
  files: [
    { path: "am-onnx/encoder.onnx", name: "encoder.onnx", role: "encoder", size: 90_994_145, sha256: "779f2412d6fa56f76be9fe71349cdf3edd10434ae9b1fc5e49834fb904320516" },
    { path: "am-onnx/decoder.onnx", name: "decoder.onnx", role: "decoder", size: 2_093_080, sha256: "fc03e8ca154593b95748198a56de115d4e6048d97c41692f93dfefb05f3693b4" },
    { path: "am-onnx/joiner.onnx", name: "joiner.onnx", role: "joiner", size: 1_026_462, sha256: "1df7319f4f9c36d7130cacaf629e1d52e904070e7a14bca9d4f209edeb162da6" },
    { path: "lang/tokens.txt", name: "tokens.txt", role: "tokens", size: 6_252, sha256: "6f3a4d64d7da07e7dd7f3fd679e07607be3ec149d1b807726dbb8bbcc80a9fe1" },
  ],
}

/** CC-BY-SA-4.0, © Sayed Shaun: attribution is in the download prompt, `companion/NOTICE`, the README and docs/local-voice.md. */
const BN_OFFLINE: ModelSpec = {
  id: "offline-bn-sayed-16bec01",
  kind: "transducer",
  title: "bangla-zipformer-onnx",
  author: "Sayed Shaun",
  license: "CC BY-SA 4.0",
  licenseUrl: CC_BY_SA,
  source: "https://huggingface.co/SayedShaun/bangla-zipformer-onnx",
  repo: "SayedShaun/bangla-zipformer-onnx",
  rev: "16bec01c5f554d3f0dc8f0139de3a00839a72efc",
  featureDim: 80,
  files: [
    { path: "int8/encoder.onnx", name: "encoder.onnx", role: "encoder", size: 72_828_389, sha256: "43d5bdfc8e956c8137b8652fca347a4deb8ae6742cc0a2840db47c02a5c4cd4a" },
    { path: "int8/decoder.onnx", name: "decoder.onnx", role: "decoder", size: 540_689, sha256: "a183a765346a050c8577dc947cb96e69beecb8a83a73ebef48ad0cdd387e18df" },
    { path: "int8/joiner.onnx", name: "joiner.onnx", role: "joiner", size: 259_417, sha256: "bd9d5b3a02b0550fc09e55f222dce6ac72d38396b5c5087c462d67d0cb840fb4" },
    { path: "tokens.txt", name: "tokens.txt", role: "tokens", size: 6_578, sha256: "8edb5b3ef2587207c86cc3966f3f729ec3845250d3b040e5ba916ce935fcae2b" },
  ],
}

/* ------------------------------------------------------------ Nemotron (the default: one multilingual model) */

/**
 * NVIDIA Nemotron 3.5 ASR Streaming 0.6B (FastConformer cache-aware RNN-T with a language prompt), sherpa-onnx int8
 * export with 560 ms chunks by csukuangfj. ONE model: it writes cased, punctuated text itself, so there is no second
 * "refine" model. `featureDim` is 128 (not sherpa's usual 80); the spoken language goes in per stream (`Language.locale`).
 * Measured on a Ryzen 5 5600: RTF 0.32 at 2 threads, so live text keeps up (see docs/local-voice.md); the 1120 ms export
 * is faster but its text arrives 0.5 s later and it loses the last words more easily.
 */
const NEMOTRON: ModelSpec = {
  id: "streaming-nemotron-3.5-0.6b-560ms-ab43d89",
  kind: "transducer",
  title: "NVIDIA Nemotron 3.5 ASR Streaming 0.6B (int8)",
  author: "NVIDIA; sherpa-onnx int8 export by csukuangfj",
  license: "OpenMDW-1.1",
  licenseUrl: OPENMDW,
  source: "https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b",
  repo: "csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11",
  rev: "ab43d895f5985b1bbab8b6eac8607fcdc05343f3",
  featureDim: 128,
  tailSeconds: 0.8,
  files: [
    { path: "encoder.int8.onnx", name: "encoder.int8.onnx", role: "encoder", size: 657_601_403, sha256: "012e9321373af99021415e0b0eb3ec827b4be3153be6f30d9b448fe65e896e68" },
    { path: "decoder.int8.onnx", name: "decoder.int8.onnx", role: "decoder", size: 14_978_075, sha256: "19f9c98fc6d0a2c33a65a43b36fdb2e914c26c0aa9764be3aebc502a1e982fb0" },
    { path: "joiner.int8.onnx", name: "joiner.int8.onnx", role: "joiner", size: 9_504_438, sha256: "4101c7c679a0bc30483794b27a059e34e79232aa2068d78d51231a22c8b0d7ce" },
    { path: "tokens.txt", name: "tokens.txt", role: "tokens", size: 131_440, sha256: "729cc103155bafa785f9cd45746cd41cabe97eab7182fc04d594129587958f8a" },
  ],
}

/* ------------------------------------------------------------ the catalog */

export const MULTILINGUAL_PACK = "multilingual"
export const BANGLA_PACK = "bn"

export const LANGUAGE_PACKS: readonly LanguagePack[] = [
  { id: MULTILINGUAL_PACK, name: "Multilingual model", noun: "multilingual model", streaming: NEMOTRON },
  { id: BANGLA_PACK, name: "Bangla", noun: "Bangla models", streaming: BN_STREAMING, offline: BN_OFFLINE },
]

const lang = (id: string, name: string, native: string, locale: string, tier: Tier): Language => ({ id, name, native, pack: MULTILINGUAL_PACK, locale, tier })

/**
 * Languages, in the order the picker shows them. Locale = what the model takes as `language`: its tokens file lists
 * `<en-US>`, `<es-US>`, … and sherpa also accepts the bare code. Where the model has two locales for a language the
 * more widely used one is chosen: en-US (not en-GB), es-US (Latin American Spanish; es-ES is also understood by the
 * model), fr-FR (not fr-CA), pt-BR (not pt-PT). Tiers are the model card's: transcription-ready, broad coverage (lower
 * accuracy); Mandarin is broad coverage but measured weak. The model's adaptation-ready languages (el, lt, lv, mt, sl, he,
 * th, nn) do not transcribe out of the box and are not offered. Bangla is not a Nemotron language: its own pack.
 */
export const LANGUAGES: readonly Language[] = [
  lang("auto", "Detect automatically", "Detect automatically", "auto", "ready"),
  lang("en", "English", "English", "en-US", "ready"),
  lang("es", "Spanish", "Español", "es-US", "ready"),
  lang("fr", "French", "Français", "fr-FR", "ready"),
  lang("de", "German", "Deutsch", "de-DE", "ready"),
  lang("it", "Italian", "Italiano", "it-IT", "ready"),
  lang("pt", "Portuguese", "Português", "pt-BR", "ready"),
  lang("nl", "Dutch", "Nederlands", "nl-NL", "ready"),
  lang("tr", "Turkish", "Türkçe", "tr-TR", "ready"),
  lang("ru", "Russian", "Русский", "ru-RU", "ready"),
  lang("uk", "Ukrainian", "Українська", "uk-UA", "ready"),
  lang("ar", "Arabic", "العربية", "ar-AR", "ready"),
  lang("hi", "Hindi", "हिन्दी", "hi-IN", "ready"),
  lang("ja", "Japanese", "日本語", "ja-JP", "ready"),
  lang("ko", "Korean", "한국어", "ko-KR", "ready"),
  lang("vi", "Vietnamese", "Tiếng Việt", "vi-VN", "ready"),
  lang("pl", "Polish", "Polski", "pl-PL", "broad"),
  lang("sv", "Swedish", "Svenska", "sv-SE", "broad"),
  lang("cs", "Czech", "Čeština", "cs-CZ", "broad"),
  lang("nb", "Norwegian Bokmål", "Norsk bokmål", "nb-NO", "broad"),
  lang("da", "Danish", "Dansk", "da-DK", "broad"),
  lang("bg", "Bulgarian", "Български", "bg-BG", "broad"),
  lang("fi", "Finnish", "Suomi", "fi-FI", "broad"),
  lang("hr", "Croatian", "Hrvatski", "hr-HR", "broad"),
  lang("sk", "Slovak", "Slovenčina", "sk-SK", "broad"),
  lang("hu", "Hungarian", "Magyar", "hu-HU", "broad"),
  lang("ro", "Romanian", "Română", "ro-RO", "broad"),
  lang("et", "Estonian", "Eesti", "et-EE", "broad"),
  lang("zh", "Mandarin Chinese", "中文", "zh-CN", "weak"),
  { id: "bn", name: "Bangla", native: "বাংলা", pack: BANGLA_PACK, tier: "ready" },
]

/** Nemotron's own detection works on most languages but can pick the wrong one (tested), so English is the default. */
export const DEFAULT_LANGUAGE = "en"

export const CATALOG: Catalog = { packs: LANGUAGE_PACKS, languages: LANGUAGES, defaultLanguage: DEFAULT_LANGUAGE }

/** `opencode.voice.maxLanguages`: default, and the largest value the setting allows. */
export const DEFAULT_MAX_LANGUAGES = 2
export const MAX_LANGUAGES_LIMIT = 5

/* ------------------------------------------------------------ helpers */

export const modelUrl = (m: ModelSpec, f: ModelFile): string => `https://huggingface.co/${m.repo}/resolve/${m.rev}/${f.path}`

export const modelBytes = (m: ModelSpec): number => m.files.reduce((n, f) => n + f.size, 0)

export const megabytes = (bytes: number): string => (bytes / 1e6).toFixed(bytes < 10e6 ? 1 : 0)

export const packById = (id: string, cat: Catalog = CATALOG): LanguagePack | undefined => cat.packs.find((p) => p.id === id)

export const languageById = (id: string, cat: Catalog = CATALOG): Language | undefined => cat.languages.find((l) => l.id === id)

/** A language id from a setting value; anything unknown (or missing) is the default language. Case and spaces are forgiven. */
export function normalizeLanguage(raw: unknown, cat: Catalog = CATALOG): string {
  const id = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  return cat.languages.some((l) => l.id === id) ? id : cat.defaultLanguage
}

/** The language of a setting value (unknown → the default; a catalog whose default is missing → its first language). */
export const languageFor = (raw: unknown, cat: Catalog = CATALOG): Language => languageById(normalizeLanguage(raw, cat), cat) ?? cat.languages[0]!

/** The pack that serves a language setting value. */
export const packFor = (raw: unknown, cat: Catalog = CATALOG): LanguagePack => packById(languageFor(raw, cat).pack, cat) ?? cat.packs[0]!

/** `Bangla (বাংলা)`, or just `English` when both names are the same. */
export const displayName = (l: Pick<Language, "name" | "native">): string => (l.name === l.native ? l.name : `${l.name} (${l.native})`)

/** The short label next to the mic: `EN`, `BN`, `AUTO`. */
export const languageCode = (id: string): string => id.toUpperCase()

/* ---- the list of active languages (`opencode.voice.localLanguages`) */

export function clampMaxLanguages(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(MAX_LANGUAGES_LIMIT, Math.max(1, Math.round(n))) : DEFAULT_MAX_LANGUAGES
}

/**
 * The active languages, first = the one that records. `raw`: the value of `opencode.voice.localLanguages` as the user
 * set it (`undefined` when they never did); `legacy`: the old single `opencode.voice.localLanguage`, used only while
 * the list was never set (`en` / `bn` carry over). Unknown ids are dropped, duplicates removed (first one wins), the
 * list is cut to `max`; an empty result is the default language.
 */
export function normalizeLanguages(raw: unknown, o: { max?: unknown; legacy?: unknown; cat?: Catalog } = {}): string[] {
  const cat = o.cat ?? CATALOG
  const max = clampMaxLanguages(o.max)
  const known = (v: unknown): string | undefined => {
    const id = typeof v === "string" ? v.trim().toLowerCase() : ""
    return cat.languages.some((l) => l.id === id) ? id : undefined
  }
  const fromList = Array.isArray(raw) ? raw.map(known).filter((id): id is string => !!id) : []
  const list = fromList.length ? fromList : [known(o.legacy)].filter((id): id is string => !!id)
  const unique = list.filter((id, i) => list.indexOf(id) === i).slice(0, max)
  return unique.length ? unique : [languageFor(undefined, cat).id]
}

/** Click on the language label: the next active language becomes the current one (the list rotates; one language: unchanged). */
export const cycleLanguages = (list: readonly string[]): string[] => (list.length > 1 ? [...list.slice(1), list[0]!] : [...list])

/** `id` becomes the current language: first in the list. A language that was not active joins at the front (the list stays within `max`). */
export function withCurrent(list: readonly string[], id: string, max: number): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, clampMaxLanguages(max))
}

/**
 * The list after the user picked `picked` in the multi-select: languages that were active and are still picked keep
 * their place (so the current one stays current), new ones follow in the picker's order. Cut to `max`; `dropped` are
 * the picks that did not fit.
 */
export function applyPick(active: readonly string[], picked: readonly string[], max: number): { list: string[]; dropped: string[] } {
  const keep = active.filter((id) => picked.includes(id))
  const all = [...keep, ...picked.filter((id) => !keep.includes(id))].filter((id, i, a) => a.indexOf(id) === i)
  const cap = clampMaxLanguages(max)
  return { list: all.slice(0, cap), dropped: all.slice(cap) }
}

/** The models of a pack, each once (a model used for both roles, or shared with another pack, is one download). Streaming first. */
export function packModels(p: LanguagePack): ModelSpec[] {
  const all = p.offline ? [p.streaming, p.offline] : [p.streaming]
  return all.filter((m, i) => all.findIndex((x) => x.id === m.id) === i)
}

/** Model download of a pack in bytes (without the speech engine). */
export const packBytes = (p: LanguagePack, have: { models?: Iterable<string> } = {}): number => {
  const done = new Set(have.models ?? [])
  return packModels(p).reduce((n, m) => (done.has(m.id) ? n : n + modelBytes(m)), 0)
}

/**
 * What choosing `pack` still has to download, in bytes: the models that are not on disk yet (a model shared with
 * another installed pack counts once, as nothing) plus the speech engine unless it is installed.
 */
export const downloadBytes = (target: { bytes: number }, pack: LanguagePack, have: { native?: boolean; models?: Iterable<string> } = {}): number =>
  (have.native ? 0 : target.bytes) + packBytes(pack, have)

/** Folder names of every model of the catalog: any other folder under `models/` is left over from an older version (see `removeUnknownModels`). */
export const knownModelIds = (cat: Catalog = CATALOG): string[] => cat.packs.flatMap((p) => packModels(p).map((m) => m.id)).filter((id, i, a) => a.indexOf(id) === i)

/**
 * Models that can be deleted when the user removes `remove` (pack ids): their models, except those another still
 * installed pack uses. `installed` are the ids of all packs on disk.
 */
export function modelsToRemove(remove: readonly string[], installed: readonly string[], packs: readonly LanguagePack[] = LANGUAGE_PACKS): ModelSpec[] {
  const keep = new Set(packs.filter((p) => installed.includes(p.id) && !remove.includes(p.id)).flatMap((p) => packModels(p).map((m) => m.id)))
  const out: ModelSpec[] = []
  for (const p of packs) {
    if (!remove.includes(p.id)) continue
    for (const m of packModels(p)) if (!keep.has(m.id) && !out.some((x) => x.id === m.id)) out.push(m)
  }
  return out
}

/* ------------------------------------------------------------ texts */

const modelLine = (m: ModelSpec): string => `${m.title} by ${m.author} (${m.license}, ${m.source})`

/** Attribution shown in the download prompt: every model of the pack with its author, licence and source. */
export function downloadDetail(p: LanguagePack): string {
  const models = packModels(p).map(modelLine).join("; ")
  return `Free and offline after that. The speech engine is sherpa-onnx (Apache-2.0). Models: ${models}.`
}

/** What the download prompt says is being downloaded: "speech engine + multilingual model" / "Bangla models". */
export function downloadWhat(p: LanguagePack, engineMissing: boolean): string {
  return engineMissing ? `speech engine + ${p.noun}` : p.noun
}

/** The sentence of the download prompt (the same for the companion and for tests). */
export const downloadPrompt = (p: LanguagePack, bytes: number, engineMissing: boolean): string =>
  `On-device voice needs a one-time download of about ${megabytes(bytes)} MB (${downloadWhat(p, engineMissing)}). Download now?`

/** Short note for a language of lower accuracy. */
export const tierNote = (t: Tier): string => (t === "broad" ? "lower accuracy" : t === "weak" ? "weak, expect many mistakes" : "")

export type LanguageItem = {
  id: string
  label: string
  description: string
  detail: string
  /** The QuickPick group (separator) this item sits under. */
  group: string
  picked: boolean
}

/** Separator titles of the language picker. The size is that of the pack's models (the speech engine, ~11 MB, comes once). */
export const groupTitle = (p: LanguagePack): string =>
  p.id === MULTILINGUAL_PACK ? `Multilingual model (≈${megabytes(packBytes(p))} MB, shared by all these languages)` : `${p.name} (separate download ≈${megabytes(packBytes(p))} MB)`

/**
 * Items of the "Choose Voice Language" multi-select QuickPick, grouped by pack (a group's items follow each other).
 * `installed` are the pack ids already on this computer; `undefined` means unknown (no companion, or an older one that
 * does not say), and then nothing is marked as downloaded. `active` are ticked; the first is the current one.
 */
export function languageItems(o: { installed?: readonly string[]; active: readonly string[]; cat?: Catalog }): LanguageItem[] {
  const cat = o.cat ?? CATALOG
  const out: LanguageItem[] = []
  for (const p of cat.packs) {
    const have = o.installed?.includes(p.id) === true
    const group = groupTitle(p)
    for (const l of cat.languages.filter((x) => x.pack === p.id)) {
      const parts = [l.id === o.active[0] ? "current" : "", have ? "downloaded" : "", tierNote(l.tier)].filter(Boolean)
      const detail = l.id === "auto" ? "The model picks the language it hears. Can guess wrong on short phrases; choose a language for best results." : `${p.streaming.title} (${p.streaming.license})`
      out.push({ id: l.id, label: l.id === "auto" ? l.name : displayName(l), description: parts.join(" · "), detail, group, picked: o.active.includes(l.id) })
    }
  }
  return out
}

const spoken = (id: string, cat: Catalog): string => {
  const l = languageFor(id, cat)
  return l.id === "auto" ? "automatic detection" : l.name
}

/** Tooltip of the language label next to the mic: names the language; with two or more active it says what a click does. */
export function languageTitle(list: readonly string[], cat: Catalog = CATALOG): string {
  const now = spoken(list[0] ?? cat.defaultLanguage, cat)
  if (list.length > 1) return `Voice language: ${now}. Click to switch to ${spoken(list[1]!, cat)}.`
  return `Voice language: ${now}. Add a second language (OpenCode: Choose Voice Language) to switch quickly.`
}

/** Accessible name of the language label. */
export const languageLabel = (list: readonly string[], cat: Catalog = CATALOG): string =>
  list.length > 1 ? `Voice language ${spoken(list[0]!, cat)}, switch to ${spoken(list[1]!, cat)}` : `Voice language ${spoken(list[0] ?? cat.defaultLanguage, cat)}`

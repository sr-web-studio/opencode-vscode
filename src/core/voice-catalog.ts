/**
 * The catalog of on-device voice languages ("language packs"). Pure data plus small pure helpers (no `vscode`, no
 * `node:*`): the companion downloads and runs the models, the main extension shows the choice.
 *
 * ADDING A LANGUAGE is a data-only change:
 *   1. Append an entry to `LANGUAGE_PACKS` below (models pinned to a Hugging Face commit; size and sha256 from
 *      `https://huggingface.co/api/models/<repo>/tree/<rev>?recursive=1`, where `lfs.oid` is the sha256; for files that
 *      are not LFS hash the downloaded file).
 *   2. Add its id (and label/description) to `opencode.voice.localLanguage` in `package.json`.
 *   3. List it in `companion/NOTICE`, `companion/README.md` and `docs/local-voice.md`.
 * `test/unit/voice-catalog.test.ts` fails when the catalog is invalid or `package.json` is out of step.
 * A model of a kind that `src/companion/sherpa.ts` cannot load yet (paraformer, NeMo, Whisper, …) also needs one
 * `ModelKind` here (its required roles) and one loader branch there.
 *
 * Models are never part of the vsix: the user's own computer downloads them, and every file is verified by size and
 * SHA-256. Two packs that use the same model id share the download and the folder on disk.
 */

/** How sherpa-onnx has to be configured for a model. Add a kind here + a branch in `sherpa.ts` for a new family. */
export type ModelKind = "transducer" | "moonshine"

/** What a file is for. A kind needs every role in `REQUIRED_ROLES[kind]`. */
export type ModelRole = "encoder" | "decoder" | "joiner" | "tokens" | "preprocessor" | "uncachedDecoder" | "cachedDecoder"

export const REQUIRED_ROLES: Record<ModelKind, readonly ModelRole[]> = {
  transducer: ["encoder", "decoder", "joiner", "tokens"],
  moonshine: ["preprocessor", "encoder", "uncachedDecoder", "cachedDecoder", "tokens"],
}

/** Kinds that can give live text while speaking (sherpa's online recognizer; `sherpa.ts` builds it). */
export const STREAMING_KINDS: readonly ModelKind[] = ["transducer"]
/** Kinds that can re-decode a finished segment (sherpa's offline recognizer). */
export const OFFLINE_KINDS: readonly ModelKind[] = ["transducer", "moonshine"]

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
  files: ModelFile[]
}

export type LanguagePack = {
  /** Short code, also the value of `opencode.voice.localLanguage` (e.g. `en`, `bn`). */
  id: string
  /** English name and the name in the language itself. */
  name: string
  native: string
  /** Live text while speaking. */
  streaming: ModelSpec
  /** Optional: decodes each finished segment again at a pause (better words, usually punctuation). */
  offline?: ModelSpec
  /** The streaming model writes ALL CAPS: show it in lower case (the offline text replaces it at the pause). */
  streamingText?: "lowercase"
}

const APACHE = "https://www.apache.org/licenses/LICENSE-2.0"
const CC_BY_SA = "https://creativecommons.org/licenses/by-sa/4.0/"

/* ------------------------------------------------------------ Bangla (unchanged ids and paths: existing downloads are reused) */

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
  files: [
    { path: "int8/encoder.onnx", name: "encoder.onnx", role: "encoder", size: 72_828_389, sha256: "43d5bdfc8e956c8137b8652fca347a4deb8ae6742cc0a2840db47c02a5c4cd4a" },
    { path: "int8/decoder.onnx", name: "decoder.onnx", role: "decoder", size: 540_689, sha256: "a183a765346a050c8577dc947cb96e69beecb8a83a73ebef48ad0cdd387e18df" },
    { path: "int8/joiner.onnx", name: "joiner.onnx", role: "joiner", size: 259_417, sha256: "bd9d5b3a02b0550fc09e55f222dce6ac72d38396b5c5087c462d67d0cb840fb4" },
    { path: "tokens.txt", name: "tokens.txt", role: "tokens", size: 6_578, sha256: "8edb5b3ef2587207c86cc3966f3f729ec3845250d3b040e5ba916ce935fcae2b" },
  ],
}

/* ------------------------------------------------------------ English */

/** Icefall LibriSpeech streaming Zipformer (int8, chunk 16, left context 64), converted for sherpa-onnx by k2-fsa. */
const EN_STREAMING: ModelSpec = {
  id: "streaming-en-zipformer-672fbf1",
  kind: "transducer",
  title: "Streaming Zipformer English (icefall, LibriSpeech)",
  author: "the icefall authors (k2-fsa), converted by csukuangfj",
  license: "Apache-2.0",
  licenseUrl: APACHE,
  source: "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26",
  repo: "csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26",
  rev: "672fbf1b30579d6585301139bb363f42a0ad4a24",
  files: [
    { path: "encoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx", name: "encoder.onnx", role: "encoder", size: 71_082_637, sha256: "0d072fd4ef956294ba9db9e9a71a541ac70659095ec4934c8453d8b2fe740187" },
    { path: "decoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx", name: "decoder.onnx", role: "decoder", size: 1_307_236, sha256: "98da299f471e38bb4e1a8df579b8cc9122d6039576a77e357b3c60f17dd83b02" },
    { path: "joiner-epoch-99-avg-1-chunk-16-left-64.int8.onnx", name: "joiner.onnx", role: "joiner", size: 259_335, sha256: "d944208d660d67c8d72cd2acaeac971fa5ceb8c80e76c1968148846fedd6e297" },
    { path: "tokens.txt", name: "tokens.txt", role: "tokens", size: 5_048, sha256: "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb" },
  ],
}

/** Moonshine tiny English (int8), MIT, by Useful Sensors / Moonshine AI; writes cased, punctuated text. */
const EN_OFFLINE: ModelSpec = {
  id: "offline-en-moonshine-tiny-bf2b762",
  kind: "moonshine",
  title: "Moonshine Tiny English (int8)",
  author: "Useful Sensors (Moonshine AI)",
  license: "MIT",
  licenseUrl: "https://github.com/moonshine-ai/moonshine/blob/main/LICENSE",
  source: "https://github.com/moonshine-ai/moonshine",
  repo: "csukuangfj/sherpa-onnx-moonshine-tiny-en-int8",
  rev: "bf2b762c076d8ea61e2af0b3851c9564fb77552e",
  files: [
    { path: "preprocess.onnx", name: "preprocess.onnx", role: "preprocessor", size: 6_800_738, sha256: "f33addce61a143460fe753b5ee5b7db255e5140b5b779c065b94f6c83ff0bf4e" },
    { path: "encode.int8.onnx", name: "encode.int8.onnx", role: "encoder", size: 18_249_187, sha256: "8774dfba578de027ec6595c2c654a0836434489bc963a0db124a7f181f571acb" },
    { path: "uncached_decode.int8.onnx", name: "uncached_decode.int8.onnx", role: "uncachedDecoder", size: 53_216_096, sha256: "216737000dd5881a17aa043f6bbd286add33e4c3b0ae257153e2ec15438bdc41" },
    { path: "cached_decode.int8.onnx", name: "cached_decode.int8.onnx", role: "cachedDecoder", size: 45_264_830, sha256: "2aff28bba6a03d8dcf5c9feac45462629bae37317442299f28115ad09da773f6" },
    { path: "tokens.txt", name: "tokens.txt", role: "tokens", size: 436_688, sha256: "1165c2aeb9f72f457a83be2d459a09054f27490acd9b41bd43794dfd25e296ea" },
  ],
}

/* ------------------------------------------------------------ the catalog: the first entry is not special, `DEFAULT_LANGUAGE` is */

export const LANGUAGE_PACKS: readonly LanguagePack[] = [
  { id: "en", name: "English", native: "English", streaming: EN_STREAMING, offline: EN_OFFLINE, streamingText: "lowercase" },
  { id: "bn", name: "Bangla", native: "বাংলা", streaming: BN_STREAMING, offline: BN_OFFLINE },
]

export const DEFAULT_LANGUAGE = "en"

/* ------------------------------------------------------------ helpers */

export const modelUrl = (m: ModelSpec, f: ModelFile): string => `https://huggingface.co/${m.repo}/resolve/${m.rev}/${f.path}`

export const modelBytes = (m: ModelSpec): number => m.files.reduce((n, f) => n + f.size, 0)

export const megabytes = (bytes: number): string => (bytes / 1e6).toFixed(bytes < 10e6 ? 1 : 0)

export const packById = (id: string, packs: readonly LanguagePack[] = LANGUAGE_PACKS): LanguagePack | undefined => packs.find((p) => p.id === id)

/** The pack for a setting value; anything unknown (or missing) is the default language. */
export function normalizeLanguage(raw: unknown, packs: readonly LanguagePack[] = LANGUAGE_PACKS): string {
  const id = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  return packs.some((p) => p.id === id) ? id : DEFAULT_LANGUAGE
}

export const packFor = (raw: unknown, packs: readonly LanguagePack[] = LANGUAGE_PACKS): LanguagePack => packById(normalizeLanguage(raw, packs), packs) ?? packs[0]!

/** `Bangla (বাংলা)`, or just `English` when both names are the same. */
export const displayName = (p: LanguagePack): string => (p.name === p.native ? p.name : `${p.name} (${p.native})`)

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

/** The text style a pack asks for. */
export const applyTextStyle = (style: LanguagePack["streamingText"], text: string): string => (style === "lowercase" ? text.toLowerCase() : text)

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

/** What the download prompt says is being downloaded. */
export function downloadWhat(p: LanguagePack, engineMissing: boolean): string {
  return engineMissing ? `speech engine + ${p.name} models` : `${p.name} models`
}

export type LanguageItem = { id: string; label: string; description: string; detail: string }

/**
 * Items of the "Choose Voice Language" QuickPick. `installed` are the pack ids already on this computer; `undefined`
 * means unknown (no companion, or an older one that does not say), and then nothing is marked as downloaded.
 */
export function languageItems(o: { installed?: readonly string[]; current: string; packs?: readonly LanguagePack[] }): LanguageItem[] {
  return (o.packs ?? LANGUAGE_PACKS).map((p) => {
    const have = o.installed?.includes(p.id) === true
    const parts = [p.id === o.current ? "current" : "", have ? "downloaded" : `${megabytes(packBytes(p))} MB download`].filter(Boolean)
    const models = packModels(p)
    const live = `Live text: ${p.streaming.title} (${p.streaming.license})`
    const detail = p.offline && p.offline.id !== p.streaming.id ? `${live}. Refined at each pause: ${p.offline.title} (${p.offline.license}).` : `${live}.`
    return { id: p.id, label: displayName(p), description: parts.join(" · "), detail: models.length ? detail : "" }
  })
}

/** Prompt attachments: pure helpers, no `vscode` and no Node. */

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export type Attachment = {
  /** Local id for keyed rendering and removal. */
  id: string
  /** `file://…` or `data:<mime>;base64,…` */
  uri: string
  name: string
  mime?: string
  /** Small preview for images (the data URI itself, or undefined for file:// images). */
  thumb?: string
}

export type PromptFile = { uri: string; name?: string }

const IMAGE = /^image\//i

export const isImageMime = (mime: string | undefined): boolean => !!mime && IMAGE.test(mime)

/**
 * `file://` URI for a local path. POSIX (`/home/a b/x.ts`) and Windows (`C:\Users\me\a b.png`, `\\server\share\x`)
 * paths both work. This mirrors `vscode.Uri.file(path).toString()`, which the host uses for real picks; the helper
 * exists so drops and tests can build the same string without `vscode`.
 */
export function fileUri(path: string): string {
  let p = path.replace(/\\/g, "/")
  let authority = ""
  if (p.startsWith("//")) {
    const rest = p.slice(2)
    const slash = rest.indexOf("/")
    authority = slash === -1 ? rest : rest.slice(0, slash)
    p = slash === -1 ? "/" : rest.slice(slash)
  } else if (/^[A-Za-z]:/.test(p)) {
    p = `/${p[0]!.toLowerCase()}:${p.slice(2)}`
  } else if (!p.startsWith("/")) p = `/${p}`
  const encoded = p
    .split("/")
    .map((seg, i) => (i === 1 && /^[a-z]:$/.test(seg) ? seg.replace(":", "%3A") : encodeURIComponent(seg)))
    .join("/")
  return `file://${authority}${encoded}`
}

/** Last path segment of a path or URI, decoded. */
export function baseName(pathOrUri: string): string {
  const clean = pathOrUri.split(/[?#]/)[0]!.replace(/[\\/]+$/, "")
  const last = clean.split(/[\\/]/).pop() ?? clean
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/** Bytes of the decoded payload of a base64 string. */
export const base64Bytes = (b64: string): number => {
  const clean = b64.replace(/\s+/g, "")
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0
  return Math.floor((clean.length * 3) / 4) - pad
}

export const dataUri = (mime: string, base64: string): string => `data:${mime};base64,${base64}`

export type AttachmentCheck = { ok: true } | { ok: false; reason: string }

/** A pasted or dropped blob: only images (or any file with a mime) up to 20 MiB are accepted. */
export function checkBlob(input: { mime: string; bytes: number; name?: string }): AttachmentCheck {
  if (input.bytes <= 0) return { ok: false, reason: `${input.name ?? "The file"} is empty.` }
  if (input.bytes > MAX_ATTACHMENT_BYTES) return { ok: false, reason: `${input.name ?? "The file"} is larger than 20 MB.` }
  return { ok: true }
}

/** Does the current model accept images? Unknown capabilities count as yes, so we only warn on a known "no". */
export function modelTakesImages(input: ReadonlyArray<string> | undefined): boolean {
  return !input || input.length === 0 || input.includes("image")
}

/** What goes to `session.prompt({ files })`. */
export const toPromptFiles = (list: readonly Attachment[]): PromptFile[] => list.map((a) => ({ uri: a.uri, name: a.name }))

export const attachmentFromUri = (id: string, uri: string, name?: string, mime?: string): Attachment => ({
  id,
  uri,
  name: name ?? baseName(uri),
  mime,
  thumb: uri.startsWith("data:image/") ? uri : undefined,
})

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
}

/** A guess from the extension, enough for the chip icon and the image warning. The server reads the real type. */
export function mimeFromName(name: string): string | undefined {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase()
  return ext ? MIME[ext] : undefined
}

/**
 * `file:` URIs from a drag out of the VS Code Explorer. Depending on the VS Code version the payload arrives as
 * `text/uri-list`, `application/vnd.code.uri-list`, a `resourceurls` JSON array, or plain text.
 */
export function droppedFileUris(data: { uriList?: string; codeUriList?: string; resourceUrls?: string; text?: string }): string[] {
  const out: string[] = []
  const push = (u: string) => {
    const t = u.trim()
    if (/^file:\/\//i.test(t) && !out.includes(t)) out.push(t)
  }
  for (const list of [data.uriList, data.codeUriList]) for (const line of (list ?? "").split(/\r?\n/)) if (!line.startsWith("#")) push(line)
  if (data.resourceUrls) {
    try {
      const parsed: unknown = JSON.parse(data.resourceUrls)
      if (Array.isArray(parsed)) for (const u of parsed) if (typeof u === "string") push(u)
    } catch {
      // not JSON: ignore
    }
  }
  for (const line of (data.text ?? "").split(/\r?\n/)) push(line)
  return out
}

/** `data:<mime>;base64,<data>` split into its parts. Undefined for anything that is not a base64 data URI. */
export function parseDataUri(uri: string): { mime: string; base64: string } | undefined {
  const m = /^data:([^;,]+)((?:;[^;,]+)*),([\s\S]*)$/.exec(uri)
  if (!m || !/;base64/i.test(m[2]!)) return undefined
  return { mime: m[1]!, base64: m[3]! }
}

export const isFileUri = (s: string): boolean => /^file:\/\//i.test(s)

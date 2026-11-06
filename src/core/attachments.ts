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

/**
 * Sent images: where their bytes come from, the names of preview files, and thumbnail sizes.
 * Pure (no `vscode`, no Node, no DOM), so the naming and the source rules are tested without a host.
 */
import { baseName, isFileUri, isImageMime, mimeFromName, parseDataUri } from "./attachments"

/** Which attachment of which user message. The state carries only this; the host serves the bytes. */
export type ImageRef = { messageID: string; index: number }

/** Where the bytes of a stored or live attachment are. */
export type AttachmentSource = { kind: "data"; mime: string; base64: string } | { kind: "uri"; uri: string; mime?: string }

/**
 * The bytes of an attachment, from a stored message file (`{ data, mime, name, source }`) or a live prompt file
 * (`{ uri, name }`). Inline `data` wins; a `file://` URI is read by the host; anything else has no usable source.
 */
export function attachmentSource(f: unknown): AttachmentSource | undefined {
  const file = (f ?? {}) as { data?: unknown; mime?: unknown; name?: unknown; uri?: unknown; source?: { uri?: unknown } }
  const name = typeof file.name === "string" ? file.name : ""
  const mime = typeof file.mime === "string" && file.mime ? file.mime : undefined
  if (typeof file.data === "string" && file.data) {
    const parsed = file.data.startsWith("data:") ? parseDataUri(file.data) : undefined
    if (parsed) return { kind: "data", ...parsed }
    const type = mime ?? mimeFromName(name)
    return type ? { kind: "data", mime: type, base64: file.data } : undefined
  }
  const uri = typeof file.source?.uri === "string" ? file.source.uri : typeof file.uri === "string" ? file.uri : ""
  const parsed = uri.startsWith("data:") ? parseDataUri(uri) : undefined
  if (parsed) return { kind: "data", ...parsed }
  if (isFileUri(uri)) return { kind: "uri", uri, mime: mime ?? mimeFromName(name || baseName(uri)) }
  return undefined
}

/** Only well-formed image types are sent to the webview as `data:` URIs. */
export const safeImageMime = (mime: string | undefined): mime is string => !!mime && isImageMime(mime) && /^image\/[A-Za-z0-9.+-]+$/.test(mime)

const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/bmp": "bmp", "image/svg+xml": "svg", "image/avif": "avif",
}

/** File name of a preview in `globalStorageUri/previews/`: `<messageID>-<index>.<ext>`. */
export function previewName(ref: ImageRef, mime?: string, name?: string): string {
  const id = ref.messageID.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "msg"
  const ext = (mime && EXT[mime.toLowerCase()]) || /\.([A-Za-z0-9]{1,5})$/.exec(name ?? "")?.[1]?.toLowerCase() || "png"
  return `${id}-${Math.max(0, Math.floor(ref.index))}.${ext}`
}

const PREVIEW_FILE = /^[A-Za-z0-9_-]+-\d+\.[a-z0-9]{1,5}$/
export const PREVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Preview files older than `maxAgeMs`. Files that do not look like previews are never listed, so nothing foreign is deleted. */
export function stalePreviews(entries: ReadonlyArray<{ name: string; mtime: number }>, now: number, maxAgeMs = PREVIEW_MAX_AGE_MS): string[] {
  return entries.filter((e) => PREVIEW_FILE.test(e.name) && now - e.mtime > maxAgeMs).map((e) => e.name)
}

/** Thumbnails show about 64px high; twice that many pixels keep them sharp on high-density screens. */
export const THUMB_HEIGHT = 64
export const THUMB_PIXELS = THUMB_HEIGHT * 2

/** Size to draw a thumbnail at: never larger than the source, `THUMB_PIXELS` high at most. `scaled` is false when no resize is needed. */
export function thumbSize(width: number, height: number, maxHeight = THUMB_PIXELS): { width: number; height: number; scaled: boolean } {
  if (!(width > 0) || !(height > 0) || height <= maxHeight) return { width, height, scaled: false }
  const k = maxHeight / height
  return { width: Math.max(1, Math.round(width * k)), height: maxHeight, scaled: true }
}

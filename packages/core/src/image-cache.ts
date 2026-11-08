/**
 * Serves the bytes of sent images to the UI, so the state itself never carries base64.
 *
 * An image is addressed by `{ messageID, index }`. Bytes come from three places, in this order: the cache, the live
 * prompt event that was just seen (`seed`, so a pasted image keeps its picture until the server's copy exists), and the
 * stored message (`message.get`) or the `file://` URI it points to. The cache is bounded by size and drops the least
 * recently used entry first. Pure: the two loaders are injected by the extension host.
 */
import { attachmentSource, type ImageRef } from "./images"

export type ImageBytes = { mime: string; base64: string }

export type ImageLoaders = {
  /** A stored message (`session.message.get`). Rejects or returns nothing when it is gone. */
  message(sessionID: string, messageID: string): Promise<unknown>
  /** Read a `file://` URI. Undefined when it cannot be read. */
  file(uri: string): Promise<{ mime?: string; base64: string } | undefined>
}

/** About 48 MB of base64 text kept at most. */
export const DEFAULT_CACHE_CHARS = 48 * 1024 * 1024

const keyOf = (ref: ImageRef) => `${ref.messageID}:${ref.index}`

export class ImageCache {
  private readonly entries = new Map<string, ImageBytes>()
  private readonly inflight = new Map<string, Promise<ImageBytes | undefined>>()
  private chars = 0

  constructor(
    private readonly loaders: ImageLoaders,
    private readonly maxChars = DEFAULT_CACHE_CHARS,
  ) {}

  get size(): number {
    return this.entries.size
  }

  /** Remember the files of a live prompt (`session.inbox.enqueued`). The user message later has the same id. */
  seed(messageID: string, files: unknown): void {
    if (!Array.isArray(files)) return
    files.forEach((f, index) => {
      const src = attachmentSource(f)
      if (src?.kind === "data") this.put(keyOf({ messageID, index }), { mime: src.mime, base64: src.base64 })
    })
  }

  async get(sessionID: string, ref: ImageRef): Promise<ImageBytes | undefined> {
    const key = keyOf(ref)
    const hit = this.entries.get(key)
    if (hit) {
      this.entries.delete(key)
      this.entries.set(key, hit)
      return hit
    }
    const pending = this.inflight.get(key)
    if (pending) return pending
    const job = this.load(sessionID, ref).finally(() => this.inflight.delete(key))
    this.inflight.set(key, job)
    return job
  }

  clear(): void {
    this.entries.clear()
    this.chars = 0
  }

  private async load(sessionID: string, ref: ImageRef): Promise<ImageBytes | undefined> {
    let message: { files?: unknown } | undefined
    try {
      message = (await this.loaders.message(sessionID, ref.messageID)) as { files?: unknown } | undefined
    } catch {
      return undefined
    }
    const file = Array.isArray(message?.files) ? message.files[ref.index] : undefined
    const src = attachmentSource(file)
    if (!src) return undefined
    let bytes: ImageBytes | undefined
    if (src.kind === "data") bytes = { mime: src.mime, base64: src.base64 }
    else {
      const read = await this.loaders.file(src.uri).catch(() => undefined)
      const mime = read?.mime ?? src.mime
      bytes = read && mime ? { mime, base64: read.base64 } : undefined
    }
    if (bytes) this.put(keyOf(ref), bytes)
    return bytes
  }

  private put(key: string, bytes: ImageBytes): void {
    const old = this.entries.get(key)
    if (old) {
      this.chars -= old.base64.length
      this.entries.delete(key)
    }
    // One image larger than the whole budget is served but not kept.
    if (bytes.base64.length > this.maxChars) return
    this.entries.set(key, bytes)
    this.chars += bytes.base64.length
    for (const [k, v] of this.entries) {
      if (this.chars <= this.maxChars) break
      this.entries.delete(k)
      this.chars -= v.base64.length
    }
  }
}

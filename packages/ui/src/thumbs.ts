import type { ImageRef } from "@occ/core/images"

const MAX_THUMBS = 120
const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string | undefined>>()

/**
 * The thumbnail of a sent image as a small `data:` URI. Asked from the host once per image and kept in memory
 * (bounded), so scrolling past a chip again or re-rendering it costs nothing.
 */
export function thumbFor(
  ref: ImageRef,
  fetchData: (ref: ImageRef) => Promise<string | undefined>,
  downscale: (dataUri: string) => Promise<string>,
): Promise<string | undefined> {
  const key = `${ref.messageID}:${ref.index}`
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(key)
  if (pending) return pending
  const job = (async () => {
    const full = await fetchData(ref)
    if (!full) return undefined
    const small = await downscale(full)
    cache.set(key, small)
    if (cache.size > MAX_THUMBS) cache.delete(cache.keys().next().value as string)
    return small
  })().finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

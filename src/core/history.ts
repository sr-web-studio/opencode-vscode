/**
 * History paging for a session transcript.
 *
 * `message.list` is read newest-first. A chunk ends at the first completed compaction (that message is
 * included, so the summary is shown, together with the prompt it ran under) or at a size cap when there is none. "Show earlier messages"
 * loads the next chunk with the saved state. Pure: the caller passes a function that fetches one page.
 */

export type RawMessage = { id?: string; type?: string; status?: string; [k: string]: unknown }

export type MessagePage = { data: ReadonlyArray<RawMessage>; cursor?: { next?: string | null } }
/**
 * One `message.list` page. The server rejects `order` together with `cursor` ("Cursor cannot be combined with order"):
 * the first page asks for `order: "desc"`, later pages pass only the cursor, which keeps the first page's order.
 */
export type FetchPage = (input: { limit: number } & ({ order: "desc"; cursor?: undefined } | { cursor: string; order?: undefined })) => Promise<MessagePage>

export type HistoryState = {
  /** Fetched but not yet used, newest first (the rest of a page that crossed a chunk boundary). */
  leftover: ReadonlyArray<RawMessage>
  /** Cursor for the next (older) page. */
  cursor?: string
  /** True once the server has no older page. */
  exhausted: boolean
}

export const initialHistory: HistoryState = { leftover: [], exhausted: false }

export type Chunk = {
  /** Oldest first, ready for `viewFromMessages`. */
  messages: RawMessage[]
  state: HistoryState
  /** True when older messages exist (a "Show earlier messages" link is useful). */
  hasMore: boolean
}

export const HISTORY_CAP = 300
export const PAGE_SIZE = 100

export const isCompletedCompaction = (m: RawMessage): boolean => m.type === "compaction" && m.status === "completed"

export type ChunkOptions = { cap?: number; pageSize?: number }

/**
 * Collect the next chunk, newest first, then return it oldest first.
 *
 * Stop rules, in order: a completed compaction is taken and ends the chunk, except that the chunk then also takes
 * the older messages back to and including the nearest user message (an auto compaction happens inside a turn, so
 * the prompt belongs with it), unless an `idle` message lies in between. Once `cap` messages are collected
 * the chunk ends at the next user message, so it begins at the start of a turn. That user message is taken too,
 * and a hard stop at twice the cap keeps one huge turn from loading everything.
 */
export async function loadChunk(fetchPage: FetchPage, from: HistoryState = initialHistory, options: ChunkOptions = {}): Promise<Chunk> {
  const cap = options.cap ?? HISTORY_CAP
  const limit = options.pageSize ?? PAGE_SIZE
  const out: RawMessage[] = []
  let queue: ReadonlyArray<RawMessage> = from.leftover
  let cursor = from.cursor
  let exhausted = from.exhausted

  // After a completed compaction: keep going back to the prompt it happened under (an auto compaction runs inside a turn).
  let toPrompt = false

  for (;;) {
    let stopped = false
    let used = queue.length
    for (let i = 0; i < queue.length; i++) {
      const m = queue[i]!
      if (toPrompt) {
        // An `idle` message means the compaction stands between turns: nothing more belongs to it. It is left for the next chunk.
        if (m.type === "idle") {
          used = i
          stopped = true
          break
        }
        out.push(m)
        if (m.type === "user" || out.length >= cap * 2) {
          used = i + 1
          stopped = true
          break
        }
        continue
      }
      out.push(m)
      if (isCompletedCompaction(m)) {
        toPrompt = true
        continue
      }
      if ((out.length >= cap && m.type === "user") || out.length >= cap * 2) {
        used = i + 1
        stopped = true
        break
      }
    }
    if (stopped) {
      queue = queue.slice(used)
      break
    }
    queue = []
    if (exhausted) break
    const page = await fetchPage(cursor ? { limit, cursor } : { order: "desc", limit })
    cursor = page.cursor?.next ?? undefined
    if (!cursor || page.data.length === 0) exhausted = true
    queue = page.data
  }

  return {
    messages: out.reverse(),
    state: { leftover: queue, cursor, exhausted },
    hasMore: queue.length > 0 || !exhausted,
  }
}

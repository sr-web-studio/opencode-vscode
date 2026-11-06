import { describe, expect, test } from "bun:test"
import { initialHistory, loadChunk, type FetchPage, type RawMessage } from "../../src/core/history"

const msg = (n: number, type = "assistant", extra: Record<string, unknown> = {}): RawMessage => ({ id: `m${n}`, type, ...extra })
const compaction = (n: number, status = "completed"): RawMessage => msg(n, "compaction", { status, summary: `summary ${n}` })

/** Fake `message.list`: `all` is oldest first; pages are served newest first with string cursors. */
function fake(all: RawMessage[], pageSize = 4) {
  const calls: Array<{ cursor?: string; limit: number }> = []
  const desc = [...all].reverse()
  const fetch: FetchPage = async ({ limit, cursor }) => {
    calls.push({ cursor, limit })
    const start = cursor ? Number(cursor) : 0
    const size = Math.min(limit, pageSize)
    const data = desc.slice(start, start + size)
    const next = start + size < desc.length ? String(start + size) : null
    return { data, cursor: { next } }
  }
  return { fetch, calls }
}

const ids = (c: { messages: RawMessage[] }) => c.messages.map((m) => m.id)

describe("history paging", () => {
  test("stops at the newest completed compaction and includes it, oldest first", async () => {
    const all = [msg(1), msg(2), compaction(3), msg(4), msg(5), msg(6)]
    const { fetch } = fake(all)
    const chunk = await loadChunk(fetch)
    expect(ids(chunk)).toEqual(["m3", "m4", "m5", "m6"])
    expect(chunk.hasMore).toBe(true)
  })

  test("a running or failed compaction does not stop the chunk", async () => {
    const all = [msg(1), compaction(2, "running"), msg(3), compaction(4, "failed"), msg(5)]
    const { fetch } = fake(all)
    const chunk = await loadChunk(fetch)
    expect(ids(chunk)).toEqual(["m1", "m2", "m3", "m4", "m5"])
    expect(chunk.hasMore).toBe(false)
  })

  test("without a compaction, a short session loads completely and has nothing earlier", async () => {
    const { fetch, calls } = fake([msg(1, "user"), msg(2), msg(3)])
    const chunk = await loadChunk(fetch)
    expect(ids(chunk)).toEqual(["m1", "m2", "m3"])
    expect(chunk.hasMore).toBe(false)
    expect(calls.length).toBe(1)
  })

  test("the cap ends the chunk at a user message so it starts at the start of a turn", async () => {
    const all: RawMessage[] = []
    for (let t = 0; t < 40; t++) all.push(msg(t * 3, "user"), msg(t * 3 + 1), msg(t * 3 + 2, "idle"))
    const { fetch } = fake(all, 10)
    const chunk = await loadChunk(fetch, initialHistory, { cap: 30, pageSize: 10 })
    expect(chunk.messages[0]!.type).toBe("user")
    expect(chunk.messages.length).toBeGreaterThanOrEqual(30)
    expect(chunk.messages.length).toBeLessThan(40)
    expect(chunk.hasMore).toBe(true)
  })

  test("a single huge turn is cut at twice the cap", async () => {
    const all = [msg(0, "user"), ...Array.from({ length: 100 }, (_, i) => msg(i + 1))]
    const { fetch } = fake(all, 10)
    const chunk = await loadChunk(fetch, initialHistory, { cap: 10, pageSize: 10 })
    expect(chunk.messages.length).toBe(20)
    expect(chunk.hasMore).toBe(true)
  })

  test("'Show earlier messages' continues from the saved state, with no gap and no overlap", async () => {
    const all = [msg(1), msg(2), compaction(3), msg(4), msg(5), compaction(6), msg(7), msg(8)]
    const { fetch, calls } = fake(all, 3)
    const first = await loadChunk(fetch)
    expect(ids(first)).toEqual(["m6", "m7", "m8"])
    const second = await loadChunk(fetch, first.state)
    expect(ids(second)).toEqual(["m3", "m4", "m5"])
    const third = await loadChunk(fetch, second.state)
    expect(ids(third)).toEqual(["m1", "m2"])
    expect(third.hasMore).toBe(false)
    const all3 = [...third.messages, ...second.messages, ...first.messages].map((m) => m.id)
    expect(all3).toEqual(all.map((m) => m.id))
    // The saved cursor is used: later calls do not start again from the newest message.
    expect(calls.slice(1).every((c) => c.cursor !== undefined)).toBe(true)
  })

  test("leftover messages of a page that crossed a boundary are used before fetching again", async () => {
    const all = [msg(1), compaction(2), msg(3), compaction(4), msg(5)]
    const { fetch, calls } = fake(all, 10)
    const first = await loadChunk(fetch)
    expect(ids(first)).toEqual(["m4", "m5"])
    expect(first.state.leftover.length).toBe(3)
    const second = await loadChunk(fetch, first.state)
    expect(ids(second)).toEqual(["m2", "m3"])
    expect(calls.length).toBe(1)
    expect(second.hasMore).toBe(true)
  })

  test("an empty session returns an empty chunk", async () => {
    const { fetch } = fake([])
    const chunk = await loadChunk(fetch)
    expect(chunk.messages).toEqual([])
    expect(chunk.hasMore).toBe(false)
  })

  test("pages are requested newest first with the given limit", async () => {
    const { fetch, calls } = fake([msg(1), msg(2)])
    await loadChunk(fetch, initialHistory, { pageSize: 50 })
    expect(calls[0]).toEqual({ cursor: undefined, limit: 50 })
  })
})

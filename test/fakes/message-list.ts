import type { RawMessage } from "../../src/core/history"

export type ListInput = { sessionID?: string; limit?: number; order?: "asc" | "desc"; cursor?: string }

/**
 * A fake `client.message.list` that enforces the OpenCode 2.2.5 rules, so no test can pass with a request the real
 * server rejects. `all` is oldest first. The first page is newest first; later pages continue from the cursor and keep
 * that order. `order` together with `cursor` is an error, exactly like the server.
 */
export function messageListFake(all: ReadonlyArray<RawMessage>, pageSize = 4) {
  const calls: ListInput[] = []
  const desc = [...all].reverse()
  const list = async (input: ListInput) => {
    calls.push({ ...input })
    if (input.cursor !== undefined && input.order !== undefined) throw new Error("Cursor cannot be combined with order")
    const limit = Math.min(input.limit ?? pageSize, pageSize)
    const start = input.cursor !== undefined ? Number(input.cursor) : 0
    const data = desc.slice(start, start + limit)
    const next = start + limit < desc.length ? String(start + limit) : null
    return { data, cursor: { next } }
  }
  return { list, calls }
}

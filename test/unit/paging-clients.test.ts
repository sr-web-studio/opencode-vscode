import { describe, expect, test } from "bun:test"
import { SessionFeed } from "@occ/core/feed"
import type { RawMessage } from "@occ/core/history"
import { WorkerTab } from "@occ/core/worker-tab"
import { messageListFake } from "../fakes/message-list"

const msg = (n: number, type: string, extra: Record<string, unknown> = {}): RawMessage => ({ id: `m${n}`, type, time: { created: n * 1000 }, ...extra })
/** Two chunks: m1..m5 (before the compaction) and m6..m12 (the compaction, then a few turns). */
const history = (): RawMessage[] => [
  msg(1, "user", { text: "one" }),
  msg(2, "assistant", { content: [{ type: "text", text: "a" }] }),
  msg(3, "user", { text: "two" }),
  msg(4, "assistant", { content: [{ type: "text", text: "b" }] }),
  msg(5, "idle", { outcome: "succeeded" }),
  msg(6, "compaction", { status: "completed", summary: "sum" }),
  msg(7, "user", { text: "three" }),
  msg(8, "assistant", { content: [{ type: "text", text: "c" }] }),
  msg(9, "idle", { outcome: "succeeded" }),
  msg(10, "user", { text: "four" }),
  msg(11, "assistant", { content: [{ type: "text", text: "d" }] }),
  msg(12, "idle", { outcome: "succeeded" }),
]

describe("the fake enforces the server rule", () => {
  test("cursor together with order is rejected", async () => {
    const { list } = messageListFake(history())
    await expect(list({ order: "desc", cursor: "1" })).rejects.toThrow("Cursor cannot be combined with order")
  })
})

describe("SessionFeed paging against a strict message.list", () => {
  test("load, then loadEarlier: first page sends order, every later page only the cursor", async () => {
    const fake = messageListFake(history(), 3)
    const client = { message: { list: fake.list } } as never
    const errors: string[] = []
    const feed = new SessionFeed(
      () => {},
      (m) => errors.push(m),
    )
    await feed.load(client, "ses_x")
    expect(errors).toEqual([])
    expect(feed.view.loaded).toBe(true)
    expect(feed.hasEarlier).toBe(true)
    expect(feed.view.turns.some((t) => t.compaction)).toBe(true)

    await feed.loadEarlier(client, "ses_x")
    expect(errors).toEqual([])
    expect(feed.hasEarlier).toBe(false)
    expect(feed.view.turns.flatMap((t) => (t.user ? [t.user.text] : []))).toEqual(["one", "two", "three", "four"])

    expect(fake.calls[0]).toMatchObject({ sessionID: "ses_x", order: "desc" })
    expect(fake.calls.length).toBeGreaterThan(2)
    for (const c of fake.calls.slice(1)) {
      expect(c.order).toBeUndefined()
      expect(c.cursor).toEqual(expect.any(String))
    }
  })
})

describe("WorkerTab paging against a strict message.list", () => {
  test("opens, loads since the last compaction, then loads earlier, with no error shown", async () => {
    const fake = messageListFake(history(), 3)
    const client = { message: { list: fake.list }, session: { get: async () => ({ id: "ses_w", title: "Worker title", agent: "developer" }) } }
    const controller = {
      api: client,
      observe: () => () => {},
      subscribe: () => () => {},
      snapshot: () => ({ target: { kind: "draft" }, features: { revert: true, rename: true }, workers: [], running: [] }),
      permissionsOf: () => [],
    }
    const tab = new WorkerTab(controller as never, "ses_w")
    await tab.start()
    let s = tab.snapshot()
    expect(s.error).toBeUndefined()
    expect(s.readOnly).toBe(true)
    expect(s.workerTitle).toBe("Worker title")
    expect(s.view.loaded).toBe(true)
    expect(s.hasEarlier).toBe(true)

    await tab.dispatch({ type: "loadEarlier" } as never)
    s = tab.snapshot()
    expect(s.error).toBeUndefined()
    expect(s.hasEarlier).toBe(false)
    expect(s.view.turns.length).toBeGreaterThan(3)
    for (const c of fake.calls.slice(1)) expect(c.order).toBeUndefined()
    tab.dispose()
  })
})

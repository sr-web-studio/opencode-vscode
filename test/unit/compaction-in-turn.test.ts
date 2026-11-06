import { describe, expect, test } from "bun:test"
import { SessionFeed } from "../../src/core/feed"
import { initialHistory, loadChunk, type FetchPage, type RawMessage } from "../../src/core/history"
import { Controller } from "../../src/core/controller"
import { applyEvent, viewFromMessages } from "../../src/core/transcript/reducer"
import { WorkerTab } from "../../src/core/worker-tab"
import { messageListFake } from "../fakes/message-list"
import shape from "../fixtures/compaction-in-turn.json"

const all = shape.messages as RawMessage[]
const ids = (c: { messages: RawMessage[] }) => c.messages.map((m) => m.id)
const text = (id: string, type: string, created: number, t: string): RawMessage =>
  type === "user" ? { id, type, text: t, time: { created } } : { id, type, time: { created }, content: [{ type: "text", text: t }], finish: "stop" }

describe("loadChunk with a compaction inside a turn", () => {
  test("takes the prompt the compaction ran under, and stops there", async () => {
    const { list } = messageListFake(all, 3)
    const chunk = await loadChunk((i) => list({ sessionID: "s", ...i }) as never)
    expect(ids(chunk)).toEqual(["msg_06", "msg_07", "msg_08", "msg_09", "msg_10"])
    expect(chunk.hasMore).toBe(true)
  })
  test("the older chunk continues right before the prompt: no gap, no duplicate", async () => {
    const { list } = messageListFake(all, 3)
    const fetch: FetchPage = (i) => list({ sessionID: "s", ...i }) as never
    const first = await loadChunk(fetch)
    const second = await loadChunk(fetch, first.state)
    expect([...ids(second), ...ids(first)]).toEqual(all.map((m) => m.id))
    expect(ids(second)).toEqual(["msg_01", "msg_02", "msg_03", "msg_04", "msg_05"])
    expect(second.hasMore).toBe(false)
  })
  test("an idle message between the prompt and the compaction ends the chunk at the compaction", async () => {
    const between: RawMessage[] = [
      { id: "a", type: "user" },
      { id: "b", type: "assistant" },
      { id: "c", type: "idle", outcome: "succeeded" },
      { id: "d", type: "compaction", status: "completed", reason: "manual" },
      { id: "e", type: "user" },
    ]
    const { list } = messageListFake(between, 10)
    const chunk = await loadChunk((i) => list({ sessionID: "s", ...i }) as never)
    expect(ids(chunk)).toEqual(["d", "e"])
    const rest = await loadChunk((i) => list({ sessionID: "s", ...i }) as never, chunk.state)
    expect(ids(rest)).toEqual(["a", "b", "c"])
  })
  test("a compaction with no user message before it (an older chunk) takes everything older", async () => {
    const { list } = messageListFake([{ id: "x", type: "assistant" }, { id: "y", type: "compaction", status: "completed" }, { id: "z", type: "assistant" }], 10)
    const chunk = await loadChunk((i) => list({ sessionID: "s", ...i }) as never)
    expect(ids(chunk)).toEqual(["x", "y", "z"])
    expect(chunk.hasMore).toBe(false)
  })
  test("a running compaction does not start the search for a prompt", async () => {
    const { list } = messageListFake([{ id: "a", type: "user" }, { id: "b", type: "compaction", status: "running" }, { id: "c", type: "assistant" }], 10)
    expect(ids(await loadChunk((i) => list({ sessionID: "s", ...i }) as never))).toEqual(["a", "b", "c"])
  })
  test("initial state is untouched by the new rule for plain sessions", async () => {
    const { list } = messageListFake([{ id: "a", type: "user" }, { id: "b", type: "assistant" }], 10)
    const chunk = await loadChunk((i) => list({ sessionID: "s", ...i }) as never, initialHistory)
    expect(ids(chunk)).toEqual(["a", "b"])
  })
})

describe("the view renders the compaction as a step of the turn", () => {
  test("prompt, then the compaction line, then the answer: one turn", () => {
    const v = viewFromMessages(all.slice(5) as never)
    expect(v.turns.length).toBe(1)
    const turn = v.turns[0]!
    expect(turn.user?.id).toBe("msg_06")
    expect(turn.compacted).toMatchObject({ reason: "auto", created: 3018 })
    expect(turn.compaction).toBeUndefined()
    expect(turn.steps.map((s) => s.id)).toEqual(["msg_08", "msg_09"])
    expect(turn.outcome).toBe("succeeded")
  })
  test("a compaction between turns (after an idle) stays a marker turn", () => {
    const v = viewFromMessages([...all.slice(0, 3), { id: "k", type: "compaction", status: "completed", reason: "manual", time: { created: 1500 } }] as never)
    expect(v.turns.map((t) => (t.compaction ? "marker" : "turn"))).toEqual(["turn", "marker"])
  })
  test("a live compaction inside the running turn is a line of that turn", () => {
    let v = viewFromMessages([all[3], all[4]] as never)
    v = applyEvent(v, { id: "e1", type: "session.compaction.ended", created: 5, data: { sessionID: "s", text: "sum", reason: "auto" } } as never)
    expect(v.turns.length).toBe(1)
    expect(v.turns[0]!.compacted).toMatchObject({ summary: "sum", reason: "auto" })
  })
  test("a live compaction between turns is a marker turn", () => {
    let v = viewFromMessages(all.slice(0, 3) as never)
    v = applyEvent(v, { id: "e1", type: "session.compaction.ended", created: 5, data: { sessionID: "s", text: "sum", reason: "manual" } } as never)
    expect(v.turns.map((t) => !!t.compaction)).toEqual([false, true])
  })
})

/** Old turns, then a turn that compacts live. */
const live = [
  text("m1", "user", 1, "one"), text("m2", "assistant", 2, "a"), { id: "m3", type: "idle", outcome: "succeeded", time: { created: 3 } } as RawMessage,
  text("m4", "user", 4, "two"), text("m5", "assistant", 5, "b"), { id: "m6", type: "idle", outcome: "succeeded", time: { created: 6 } } as RawMessage,
  text("m7", "user", 7, "three"),
]
const compactionEnded = { id: "ev", type: "session.compaction.ended", created: 8, data: { sessionID: "s", text: "sum", reason: "auto" } } as never

describe("live compaction trims the view, history stays reachable", () => {
  async function loaded() {
    const fake = messageListFake(live, 100)
    const feed = new SessionFeed(() => {}, () => {})
    await feed.load({ message: { list: fake.list } } as never, "s")
    return { feed, client: { message: { list: fake.list } } as never }
  }
  test("the compaction event marks a trim as pending; nothing is dropped by itself", async () => {
    const { feed } = await loaded()
    expect(feed.trimPending).toBe(false)
    feed.apply(compactionEnded)
    expect(feed.trimPending).toBe(true)
    expect(feed.view.turns.length).toBe(3)
  })
  test("trim drops the turns before the compaction turn and offers them again", async () => {
    const { feed, client } = await loaded()
    feed.apply(compactionEnded)
    expect(feed.trim()).toBe(true)
    expect(feed.trimPending).toBe(false)
    expect(feed.view.turns.map((t) => t.user?.id)).toEqual(["m7"])
    expect(feed.hasEarlier).toBe(true)
    const tick = feed.earlierTick
    await feed.loadEarlier(client, "s")
    expect(feed.view.turns.flatMap((t) => (t.user ? [t.user.text] : []))).toEqual(["one", "two", "three"])
    expect(feed.earlierTick).toBe(tick + 1)
    expect(feed.hasEarlier).toBe(false)
  })
  test("trimming twice, or with nothing before the compaction, changes nothing", async () => {
    const { feed } = await loaded()
    feed.apply(compactionEnded)
    feed.trim()
    expect(feed.trim()).toBe(false)
    expect(feed.view.turns.length).toBe(1)
  })
  test("a second live compaction stacks onto what was trimmed", async () => {
    const { feed, client } = await loaded()
    feed.apply(compactionEnded)
    feed.trim()
    feed.apply({ id: "x", type: "session.execution.succeeded", created: 9, data: { sessionID: "s" } } as never)
    feed.apply({ id: "p", type: "session.inbox.enqueued", created: 10, data: { sessionID: "s", inboxID: "m8", item: { type: "user", payload: { text: "four" } } } } as never)
    feed.apply({ id: "d", type: "session.inbox.delivered", created: 11, data: { sessionID: "s", inboxID: "m8" } } as never)
    feed.apply({ ...(compactionEnded as object), id: "ev2" } as never)
    feed.trim()
    expect(feed.view.turns.map((t) => t.user?.text)).toEqual(["four"])
    await feed.loadEarlier(client, "s")
    expect(feed.view.turns.flatMap((t) => (t.user ? [t.user.text] : []))).toEqual(["one", "two", "three", "four"])
  })
  test("a reset forgets the trimmed turns", async () => {
    const { feed } = await loaded()
    feed.apply(compactionEnded)
    feed.trim()
    feed.reset()
    expect(feed.trimPending).toBe(false)
    expect(feed.hasEarlier).toBe(false)
  })
})

describe("the same trim in a worker tab", () => {
  test("the state says a trim is pending, and trimCompacted applies it", async () => {
    const fake = messageListFake(live, 100)
    const ctl = {
      api: { message: { list: fake.list }, session: { get: async () => ({ id: "ses_w", title: "W" }) } },
      snapshot: () => ({ features: {}, permissions: [] }) as never,
      permissionsOf: () => [],
      observe: () => () => {},
      subscribe: () => () => {},
    } as unknown as Controller
    const tab = new WorkerTab(ctl, "ses_w")
    await tab.start()
    const sid = { sessionID: "ses_w" }
    ;(tab as unknown as { onEvent(e: unknown): void }).onEvent({ id: "c", type: "session.compaction.ended", created: 8, data: { text: "sum", reason: "auto", ...sid } })
    expect(tab.snapshot().trimPending).toBe(true)
    expect(tab.snapshot().view.turns.length).toBe(3)
    await tab.dispatch({ type: "trimCompacted" })
    expect(tab.snapshot().trimPending).toBe(false)
    expect(tab.snapshot().view.turns.length).toBe(1)
    expect(tab.snapshot().hasEarlier).toBe(true)
    tab.dispose()
  })
})

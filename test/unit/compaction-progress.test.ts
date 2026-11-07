import { describe, expect, test } from "bun:test"
import { SessionFeed } from "../../src/core/feed"
import { applyEvent, isCompacting, isRunning, viewFromMessages } from "../../src/core/transcript/reducer"
import { contentSignature } from "../../src/core/transcript/signature"
import { emptyView, type SessionView } from "../../src/core/transcript/types"

/** Event shapes as observed live on server 2.2.5: `started`/`failed` carry `reason`, `delta` only `text`, `ended` the full `text`. */
let n = 0
const ev = (type: string, data: object = {}, created = 100 + n) => ({ id: `e${++n}`, type, created, data: { sessionID: "s", ...data } }) as never
const started = (reason = "manual", created?: number) => ev("session.compaction.started", { reason }, created)
const delta = (text: string) => ev("session.compaction.delta", { text })
const ended = (text: string, reason = "manual") => ev("session.compaction.ended", { text, reason })
const failed = (error: { type: string; message: string }, reason = "manual") => ev("session.compaction.failed", { reason, error })
const apply = (view: SessionView, ...events: never[]) => events.reduce((v, e) => applyEvent(v, e), view)

/** A session with one finished turn, as after a normal prompt. */
const settled = (): SessionView =>
  viewFromMessages([
    { id: "u1", type: "user", text: "hi", time: { created: 1 } },
    { id: "a1", type: "assistant", time: { created: 2 }, content: [{ type: "text", text: "ok" }], finish: "stop" },
    { id: "i1", type: "idle", outcome: "succeeded", time: { created: 3 } },
  ] as never)

const compactionLines = (v: SessionView) => v.turns.filter((t) => t.compaction || t.compacted).length

describe("compaction between turns: started → delta → ended", () => {
  test("started opens a pending marker turn and the session counts as running", () => {
    const v = apply(settled(), started("manual", 1000))
    expect(v.turns).toHaveLength(2)
    const marker = v.turns[1]!
    expect(marker.compaction).toMatchObject({ status: "running", summary: "", reason: "manual", created: 1000 })
    expect(marker.outcome).toBeUndefined()
    expect(isCompacting(v)).toBe(true)
    expect(isRunning(v)).toBe(true)
  })

  test("deltas accumulate the summary being written", () => {
    const v = apply(settled(), started(), delta("## Goal\n"), delta("Fix the "), delta("bug"))
    expect(v.turns[1]!.compaction).toMatchObject({ status: "running", summary: "## Goal\nFix the bug" })
    expect(v.turns).toHaveLength(2)
  })

  test("ended replaces the pending line with the final one: same turn, no duplicate, no status", () => {
    const v = apply(settled(), started(), delta("partial"), ended("final summary"), ev("session.execution.succeeded"))
    expect(compactionLines(v)).toBe(1)
    expect(v.turns).toHaveLength(2)
    const marker = v.turns[1]!
    expect(marker.compaction?.status).toBeUndefined()
    expect(marker.compaction?.summary).toBe("final summary")
    expect(marker.outcome).toBe("succeeded")
    expect(isCompacting(v)).toBe(false)
    expect(isRunning(v)).toBe(false)
  })

  test("a repeated started does not add a second pending line", () => {
    const v = apply(settled(), started(), delta("a"), started())
    expect(v.turns).toHaveLength(2)
    expect(v.turns[1]!.compaction?.summary).toBe("a")
  })

  test("ended without a started (events missed) still shows one line", () => {
    const v = apply(settled(), ended("sum"))
    expect(compactionLines(v)).toBe(1)
    expect(v.turns[1]!.compaction?.summary).toBe("sum")
  })

  test("a delta without a started opens the pending line", () => {
    const v = apply(settled(), delta("late"))
    expect(v.turns[1]!.compaction).toMatchObject({ status: "running", summary: "late" })
  })

  test("a prompt delivered after the compaction keeps the marker and starts its own turn", () => {
    let v = apply(settled(), started(), ended("sum"))
    v = apply(v, ev("session.inbox.enqueued", { inboxID: "q1", item: { type: "user", payload: { text: "next" }, delivery: "queue" } }), ev("session.inbox.delivered", { inboxID: "q1" }))
    expect(v.turns.map((t) => (t.compaction ? "marker" : t.user?.text ?? "?"))).toEqual(["hi", "marker", "next"])
  })
})

describe("compaction between turns: started → failed", () => {
  test("a provider error becomes a short error line and the session is no longer compacting", () => {
    const v = apply(settled(), started(), delta("half"), failed({ type: "provider", message: "Context window exceeded" }), ev("session.execution.failed", { error: { message: "x" } }))
    expect(v.turns).toHaveLength(2)
    expect(v.turns[1]!.compaction).toMatchObject({ status: "failed", error: "Context window exceeded" })
    expect(v.turns[1]!.outcome).toBe("succeeded")
    expect(isCompacting(v)).toBe(false)
    expect(isRunning(v)).toBe(false)
  })

  test("the user pressing Stop (error type aborted) is a quiet cancelled line, not an error", () => {
    const v = apply(settled(), started(), failed({ type: "aborted", message: "Compaction cancelled" }), ev("session.execution.interrupted", { reason: "user" }))
    expect(v.turns[1]!.compaction).toMatchObject({ status: "cancelled" })
    expect(v.turns[1]!.compaction?.error).toBeUndefined()
    expect(v.turns).toHaveLength(2)
  })

  test("failed with no started still shows the failure once", () => {
    const v = apply(settled(), failed({ type: "x", message: "boom" }))
    expect(compactionLines(v)).toBe(1)
    expect(v.turns[1]!.compaction).toMatchObject({ status: "failed", error: "boom" })
  })

  test("the execution ending while the line is pending (ended/failed lost) settles it", () => {
    const stopped = apply(settled(), started(), ev("session.execution.interrupted"))
    expect(stopped.turns[1]!.compaction?.status).toBe("cancelled")
    const failedRun = apply(settled(), started(), ev("session.execution.failed", { error: { message: "server down" } }))
    expect(failedRun.turns[1]!.compaction).toMatchObject({ status: "failed", error: "server down" })
    const done = apply(settled(), started(), delta("kept"), ev("session.execution.succeeded"))
    expect(done.turns[1]!.compaction?.status).toBeUndefined()
    expect(done.turns[1]!.compaction?.summary).toBe("kept")
  })
})

/** A running turn: prompt delivered, one step started. */
const running = (): SessionView =>
  apply(
    emptyView(),
    ev("session.inbox.enqueued", { inboxID: "u2", item: { type: "user", payload: { text: "work" }, delivery: "steer" } }),
    ev("session.inbox.delivered", { inboxID: "u2" }),
    ev("session.step.started", { assistantMessageID: "m1", agent: "build" }),
  )

describe("compaction inside a running turn (auto, or /compact while the agent works)", () => {
  test("started puts the pending line in the open turn; no marker turn", () => {
    const v = apply(running(), started("auto", 500))
    expect(v.turns).toHaveLength(1)
    expect(v.turns[0]!.compacted).toMatchObject({ status: "running", reason: "auto", created: 500 })
    expect(v.turns[0]!.compaction).toBeUndefined()
    expect(v.turns[0]!.outcome).toBeUndefined()
    expect(isCompacting(v)).toBe(true)
  })

  test("deltas fill it, ended turns it into the usual line of the same turn", () => {
    const v = apply(running(), started("auto"), delta("one "), delta("two"), ended("final", "auto"))
    expect(v.turns).toHaveLength(1)
    expect(v.turns[0]!.compacted).toMatchObject({ summary: "final", reason: "auto" })
    expect(v.turns[0]!.compacted?.status).toBeUndefined()
    expect(compactionLines(v)).toBe(1)
    expect(isCompacting(v)).toBe(false)
    expect(isRunning(v)).toBe(true)
  })

  test("the answer that follows stays in the same turn", () => {
    const v = apply(running(), started("auto"), ended("sum", "auto"), ev("session.step.started", { assistantMessageID: "m2", agent: "build" }), ev("session.execution.succeeded"))
    expect(v.turns).toHaveLength(1)
    expect(v.turns[0]!.steps.map((s) => s.id)).toEqual(["m1", "m2"])
    expect(v.turns[0]!.outcome).toBe("succeeded")
  })

  test("failed turns the pending line into an error line and the turn goes on", () => {
    const v = apply(running(), started("auto"), failed({ type: "provider", message: "No quota" }, "auto"))
    expect(v.turns).toHaveLength(1)
    expect(v.turns[0]!.compacted).toMatchObject({ status: "failed", error: "No quota" })
    expect(v.turns[0]!.outcome).toBeUndefined()
  })
})

describe("history with a compaction that is not finished", () => {
  test("a running compaction after a finished turn is a pending marker turn", () => {
    const v = viewFromMessages([
      { id: "u1", type: "user", text: "hi" },
      { id: "a1", type: "assistant", content: [] },
      { id: "i1", type: "idle", outcome: "succeeded" },
      { id: "c1", type: "compaction", status: "running", reason: "manual", summary: "", time: { created: 900 } },
    ] as never)
    expect(v.turns).toHaveLength(2)
    expect(v.turns[1]!.compaction).toMatchObject({ status: "running", reason: "manual", created: 900 })
    expect(v.turns[1]!.outcome).toBeUndefined()
    expect(isCompacting(v)).toBe(true)
    expect(isRunning(v)).toBe(true)
  })

  test("a running compaction inside an open turn is a pending line of that turn", () => {
    const v = viewFromMessages([
      { id: "u1", type: "user", text: "work" },
      { id: "a1", type: "assistant", content: [{ type: "text", text: "..." }] },
      { id: "c1", type: "compaction", status: "running", reason: "auto", summary: "" },
    ] as never)
    expect(v.turns).toHaveLength(1)
    expect(v.turns[0]!.compacted).toMatchObject({ status: "running", reason: "auto" })
  })

  test("deltas and the end then continue what history showed, with no duplicate", () => {
    let v = viewFromMessages([
      { id: "i1", type: "idle", outcome: "succeeded" },
      { id: "c1", type: "compaction", status: "running", reason: "manual", summary: "" },
    ] as never)
    v = apply(v, started(), delta("abc"))
    expect(v.turns).toHaveLength(1)
    expect(v.turns[0]!.compaction).toMatchObject({ status: "running", summary: "abc" })
    v = apply(v, ended("abcdef"))
    expect(compactionLines(v)).toBe(1)
    expect(v.turns[0]!.compaction).toMatchObject({ summary: "abcdef" })
    expect(v.turns[0]!.compaction?.status).toBeUndefined()
  })

  test("completed stays the plain line; a failed or cancelled one shows its state", () => {
    const v = viewFromMessages([
      { id: "c1", type: "compaction", status: "completed", reason: "manual", summary: "s" },
      { id: "c2", type: "compaction", status: "failed", reason: "manual", summary: "", error: { type: "provider", message: "Nope" } },
      { id: "c3", type: "compaction", status: "failed", reason: "manual", summary: "", error: { type: "aborted", message: "Compaction cancelled" } },
    ] as never)
    expect(v.turns.map((t) => t.compaction?.status)).toEqual([undefined, "failed", "cancelled"])
    expect(v.turns[1]!.compaction?.error).toBe("Nope")
    expect(v.turns.every((t) => t.outcome === "succeeded")).toBe(true)
    expect(isRunning(v)).toBe(false)
  })

  test("a feed that loaded a pending compaction does not replay deltas over it twice", () => {
    const feed = new SessionFeed(() => {}, () => {})
    feed.view = viewFromMessages([{ id: "c1", type: "compaction", status: "running", summary: "" }] as never)
    expect(feed.apply(started())).toBe(false)
    expect(feed.apply(delta("x"))).toBe(true)
    expect(feed.view.turns[0]!.compaction?.summary).toBe("x")
  })
})

describe("feed behaviour around a live compaction", () => {
  test("trim is only requested when the compaction ends, not while it is pending", () => {
    const feed = new SessionFeed(() => {}, () => {})
    feed.view = settled()
    feed.apply(started())
    feed.apply(delta("a"))
    expect(feed.trimPending).toBe(false)
    feed.apply(ended("done"))
    expect(feed.trimPending).toBe(true)
  })

  test("the scroll signature changes when the line appears and settles, not for each delta", () => {
    const a = apply(settled(), started())
    const b = apply(a, delta("more text"))
    const c = apply(b, ended("sum"))
    expect(contentSignature(b)).toBe(contentSignature(a))
    expect(contentSignature(c)).not.toBe(contentSignature(b))
  })
})

import { describe, expect, test } from "bun:test"
import { backgroundSummary, deriveWorkers, matchChild, sessionIDFromOutput, toolChildID, type ChildSession } from "../../src/core/workers"
import { applyEvent, viewFromMessages } from "../../src/core/transcript/reducer"
import { emptyView, type SessionView, type ToolItem } from "../../src/core/transcript/types"
import fixture from "../fixtures/grep-glob-subagent-question.json"
import lead from "../fixtures/lead-continues-worker.json"

const tool = (over: Partial<ToolItem> & { id: string }): ToolItem => ({
  kind: "tool", name: "subagent", status: "completed", input: {}, metadata: {}, output: "", ...over,
})
const viewOf = (...tools: ToolItem[]): SessionView => ({
  ...emptyView(),
  loaded: true,
  turns: [{ id: "t1", steps: [{ id: "s1", items: tools }] }],
})
const child = (id: string, over: Partial<ChildSession> = {}): ChildSession => ({ id, time: { created: 1000, updated: 1000 }, ...over })
const none = new Set<string>()

describe("child session id of a subagent tool", () => {
  test("metadata wins, also while the tool is still running", () => {
    expect(toolChildID(tool({ id: "a", status: "running", metadata: { sessionID: "ses_run", status: "running" } }))).toBe("ses_run")
  })
  test("falls back to the <subagent sessionID> marker in the result text", () => {
    const out = '<subagent sessionID="ses_abc123" state="completed">\nanswer\n</subagent>'
    expect(sessionIDFromOutput(out)).toBe("ses_abc123")
    expect(toolChildID(tool({ id: "a", output: out }))).toBe("ses_abc123")
  })
  test("other tools and unknown output give nothing", () => {
    expect(toolChildID(tool({ id: "a", name: "shell", metadata: { sessionID: "ses_x" } }))).toBeUndefined()
    expect(toolChildID(tool({ id: "a" }))).toBeUndefined()
  })
  test("the id arrives with session.tool.progress, before the tool completes", () => {
    let v = applyEvent(emptyView(), { type: "session.tool.input.started", created: 1, data: { assistantMessageID: "m1", id: "c1", name: "subagent" } })
    v = applyEvent(v, { type: "session.tool.called", created: 2, data: { assistantMessageID: "m1", id: "c1", input: { agent: "explore", description: "Look" } } })
    v = applyEvent(v, { type: "session.tool.progress", created: 3, data: { assistantMessageID: "m1", id: "c1", metadata: { sessionID: "ses_live", status: "running" } } })
    const t = v.turns[0]!.steps[0]!.items[0] as ToolItem
    expect(t.status).toBe("running")
    expect(toolChildID(t)).toBe("ses_live")
  })
  test("the real fixture exposes the child id from history and from replayed events", () => {
    const hist = viewFromMessages(fixture.messages as never)
    const live = (fixture.events as never[]).reduce((v: SessionView, e) => applyEvent(v, e), emptyView())
    for (const view of [hist, live]) {
      const ids = view.turns.flatMap((t) => t.steps.flatMap((s) => s.items)).flatMap((i) => (i.kind === "tool" ? [toolChildID(i)] : [])).filter(Boolean)
      expect(ids).toContain("ses_e514ca27dffe4xfZPSTu9QR5hC")
    }
  })
})

describe("matching a child when the tool has no id yet", () => {
  test("same agent and a title containing the description", () => {
    const t = tool({ id: "a", input: { agent: "explore", description: "List files" }, created: 5000 })
    const kids = [child("ses_other", { agent: "build", title: "List files" }), child("ses_right", { agent: "explore", title: "List files in directory (@explore subagent)" })]
    expect(matchChild(t, kids, none)?.id).toBe("ses_right")
  })
  test("otherwise the first same-agent child created at or after the call", () => {
    const t = tool({ id: "a", input: { agent: "explore", description: "Zzz" }, created: 5000 })
    const kids = [child("ses_old", { agent: "explore", time: { created: 100, updated: 100 } }), child("ses_new", { agent: "explore", time: { created: 5200, updated: 5200 } })]
    expect(matchChild(t, kids, none)?.id).toBe("ses_new")
  })
  test("never takes a child another tool already claimed, and gives up when nothing fits", () => {
    const t = tool({ id: "a", input: { agent: "explore", description: "Look" }, created: 5000 })
    const kids = [child("ses_taken", { agent: "explore", title: "Look" })]
    expect(matchChild(t, kids, new Set(["ses_taken"]))).toBeUndefined()
    expect(matchChild(tool({ id: "b", input: { agent: "explore" } }), [child("ses_x", { agent: "explore" })], none)).toBeUndefined()
  })
})

describe("deriveWorkers", () => {
  test("a running tool line with progress metadata is openable and running", () => {
    const v = viewOf(tool({ id: "a", status: "running", input: { agent: "explore", description: "Scan" }, metadata: { sessionID: "ses_1", status: "running" }, created: 10 }))
    const [w] = deriveWorkers({ view: v, children: [], running: none })
    expect(w).toMatchObject({ key: "ses_1", calls: 1, sessionID: "ses_1", toolID: "a", agent: "explore", description: "Scan", status: "running" })
  })
  test("without an id the child list supplies it", () => {
    const v = viewOf(tool({ id: "a", status: "running", input: { agent: "explore", description: "Scan" }, created: 10 }))
    const [w] = deriveWorkers({ view: v, children: [child("ses_2", { agent: "explore", title: "Scan the repo" })], running: new Set(["ses_2"]) })
    expect(w!.sessionID).toBe("ses_2")
    expect(w!.status).toBe("running")
  })
  test("a background worker whose tool call returned at once is running until its session is idle, then done", () => {
    const v = viewOf(tool({ id: "a", status: "completed", input: { agent: "explore", description: "Long job", background: true }, metadata: { sessionID: "ses_bg", status: "running" } }))
    const c = child("ses_bg", { agent: "explore" })
    expect(deriveWorkers({ view: v, children: [c], running: new Set(["ses_bg"]) })[0]!.status).toBe("running")
    expect(deriveWorkers({ view: v, children: [{ ...c, outcome: "succeeded" }], running: none })[0]!.status).toBe("done")
  })
  test("children that no visible tool line explains still appear (older turns, folded history)", () => {
    const v = viewOf()
    const ws = deriveWorkers({ view: v, children: [child("ses_a", { agent: "explore", title: "Earlier work", outcome: "succeeded" })], running: none })
    expect(ws).toHaveLength(1)
    expect(ws[0]).toMatchObject({ sessionID: "ses_a", agent: "explore", description: "Earlier work", status: "done" })
    expect(ws[0]!.toolID).toBeUndefined()
  })
  test("a tool and its child are listed once, and failed/stopped outcomes are shown", () => {
    const v = viewOf(
      tool({ id: "a", input: { agent: "x", description: "one" }, metadata: { sessionID: "ses_a" }, created: 1 }),
      tool({ id: "b", input: { agent: "x", description: "two" }, metadata: { sessionID: "ses_b" }, created: 2 }),
    )
    const ws = deriveWorkers({ view: v, children: [child("ses_a", { outcome: "failed" }), child("ses_b", { outcome: "interrupted" })], running: none })
    expect(ws.map((w) => [w.sessionID, w.status])).toEqual([["ses_a", "failed"], ["ses_b", "stopped"]])
  })
  test("an errored tool with no child is failed; ordering is oldest first", () => {
    const v = viewOf(
      tool({ id: "late", status: "completed", input: { agent: "x", description: "b" }, created: 50 }),
      tool({ id: "early", status: "error", input: { agent: "x", description: "a" }, created: 10 }),
    )
    const ws = deriveWorkers({ view: v, children: [], running: none })
    expect(ws.map((w) => [w.toolID, w.status])).toEqual([["early", "failed"], ["late", "done"]])
  })
  test("summary counts workers, running ones and shells", () => {
    const ws = deriveWorkers({ view: viewOf(tool({ id: "a", status: "running", metadata: { sessionID: "ses_1" } })), children: [child("ses_9", { outcome: "succeeded" })], running: none })
    expect(backgroundSummary(ws, 1)).toEqual({ workers: 2, running: 1, shells: 1 })
  })
})

describe("one worker session continued by many subagent calls", () => {
  const leadTools = (): ToolItem[] =>
    lead.calls.map((c) => tool({ id: c.id, status: c.status as ToolItem["status"], input: c.input as Record<string, unknown>, metadata: c.metadata as Record<string, unknown>, created: c.created, completed: c.completed }))
  const kid = child(lead.worker, { agent: "developer", title: "Task 15", outcome: "succeeded", time: { created: 1_000_000, updated: 1_900_000 } })

  test("15 calls to 1 session give 1 row, with the latest description and the call count", () => {
    const ws = deriveWorkers({ view: viewOf(...leadTools()), children: [kid], running: none })
    expect(ws).toHaveLength(1)
    expect(ws[0]).toMatchObject({ key: lead.worker, sessionID: lead.worker, calls: 15, description: "Task 15", agent: "developer", status: "done", toolID: "call_15" })
    expect(ws[0]!.toolIDs).toHaveLength(15)
  })

  test("the row follows the child: running while the child executes, even though every tool call returned", () => {
    const ws = deriveWorkers({ view: viewOf(...leadTools()), children: [{ ...kid, outcome: undefined }], running: new Set([lead.worker]) })
    expect(ws).toHaveLength(1)
    expect(ws[0]!.status).toBe("running")
  })

  test("without the child list the row still exists and is openable", () => {
    const ws = deriveWorkers({ view: viewOf(...leadTools()), children: [], running: none })
    expect(ws).toHaveLength(1)
    expect(ws[0]!.sessionID).toBe(lead.worker)
  })

  test("keys are unique by construction, also with calls that have no session yet", () => {
    const pending = [tool({ id: "p1", status: "running", input: { agent: "x", description: "a" }, created: 5 }), tool({ id: "p2", status: "running", input: { agent: "x", description: "b" }, created: 6 })]
    const ws = deriveWorkers({ view: viewOf(...leadTools(), ...pending), children: [kid, child("ses_other", { agent: "zzz", outcome: "succeeded" })], running: none })
    const keys = ws.map((w) => w.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(expect.arrayContaining([lead.worker, "tool:p1", "tool:p2", "ses_other"]))
    expect(ws.every((w) => w.sessionID || w.key.startsWith("tool:"))).toBe(true)
  })

  test("two workers, one continued twice: two rows, counts per row", () => {
    const v = viewOf(
      tool({ id: "a", input: { agent: "x", description: "one" }, metadata: { sessionID: "ses_a" }, created: 1 }),
      tool({ id: "b", input: { agent: "x", description: "two" }, metadata: { sessionID: "ses_b" }, created: 2 }),
      tool({ id: "c", input: { agent: "x", description: "one again", sessionID: "ses_a" }, metadata: { sessionID: "ses_a" }, created: 3 }),
    )
    const ws = deriveWorkers({ view: v, children: [], running: none })
    expect(ws.map((w) => [w.sessionID, w.calls, w.description])).toEqual([["ses_a", 2, "one again"], ["ses_b", 1, "two"]])
    expect(ws[0]!.toolIDs).toEqual(["a", "c"])
    expect(ws[0]!.started).toBe(1)
  })

  test("a tool line finds its row through toolIDs (every call opens the same tab)", () => {
    const ws = deriveWorkers({ view: viewOf(...leadTools()), children: [kid], running: none })
    for (const c of lead.calls) expect(ws.find((w) => w.toolIDs.includes(c.id))?.sessionID).toBe(lead.worker)
  })

  test("the fixture holds no prompt text or real ids", () => {
    const text = JSON.stringify(lead)
    expect(text).not.toMatch(/ses_e5|toolu_|"prompt"/)
  })
})

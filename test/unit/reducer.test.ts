import { describe, expect, test } from "bun:test"
import fixtureA from "../fixtures/simple-edit-shell.json"
import fixtureB from "../fixtures/grep-glob-subagent-question.json"
import fixtureC from "../fixtures/shell-exit-and-error.json"
import { applyEvent, isRunning, viewFromMessages } from "../../src/core/transcript/reducer"
import { emptyView, type SessionView, type ToolItem } from "../../src/core/transcript/types"
import { splitTurn, foldLabel, countSteps } from "../../src/core/transcript/turn"
import { summarizeTool } from "../../src/core/transcript/tools"

type Fixture = { events: any[]; messages: any[] }

const replay = (f: Fixture): SessionView => f.events.reduce((v, e) => applyEvent(v, e), emptyView())
const tools = (v: SessionView): ToolItem[] => v.turns.flatMap((t) => t.steps.flatMap((s) => s.items.filter((i): i is ToolItem => i.kind === "tool")))

describe("live events and history agree", () => {
  for (const [name, f] of [["simple-edit-shell", fixtureA], ["grep-glob-subagent-question", fixtureB], ["shell-exit-and-error", fixtureC]] as const) {
    test(name, () => {
      const live = replay(f as Fixture)
      const hist = viewFromMessages((f as Fixture).messages)
      expect(live.turns.length).toBe(hist.turns.length)
      expect(live.turns.map((t) => t.user?.text)).toEqual(hist.turns.map((t) => t.user?.text))
      expect(live.turns.map((t) => t.outcome)).toEqual(hist.turns.map((t) => t.outcome))
      // Same tools, in the same order, with the same final state.
      const key = (t: ToolItem) => [t.name, t.status, JSON.stringify(t.input)]
      expect(tools(live).map(key)).toEqual(tools(hist).map(key))
      for (let i = 0; i < live.turns.length; i++) {
        const texts = (v: SessionView) => v.turns[i]!.steps.flatMap((s) => s.items.filter((x) => x.kind === "text").map((x: any) => x.text))
        expect(texts(live)).toEqual(texts(hist))
      }
    })
  }
})

describe("history view", () => {
  test("a turn spans from the user message to the idle marker", () => {
    const v = viewFromMessages((fixtureA as Fixture).messages)
    expect(v.turns).toHaveLength(2)
    expect(v.turns[0]!.user?.text).toBe("Reply with the word ok and nothing else.")
    expect(v.turns[0]!.outcome).toBe("succeeded")
    expect(v.turns[1]!.steps.length).toBeGreaterThan(1)
    expect(isRunning(v)).toBe(false)
  })

  test("a turn without an idle marker is running", () => {
    const messages = (fixtureB as Fixture).messages
    const cut = messages.slice(0, messages.findIndex((m) => m.type === "idle"))
    expect(isRunning(viewFromMessages(cut))).toBe(true)
  })

  test("shell nonzero exit and tool error are kept", () => {
    const t = tools(viewFromMessages((fixtureC as Fixture).messages))
    const shell = t.find((x) => x.name === "shell")!
    expect(shell.metadata.exit).toBe(3)
    const read = t.find((x) => x.name === "read")!
    expect(read.status).toBe("error")
    expect(read.error).toContain("File not found")
  })
})

describe("live streaming", () => {
  const ev = (type: string, data: any, created = 1000) => ({ type, created, data })

  test("text deltas accumulate, ended carries the full text", () => {
    let v = emptyView()
    v = applyEvent(v, ev("session.step.started", { assistantMessageID: "a1", agent: "build", started: 1000 }))
    v = applyEvent(v, ev("session.text.started", { assistantMessageID: "a1", ordinal: 0 }))
    v = applyEvent(v, ev("session.text.delta", { assistantMessageID: "a1", ordinal: 0, delta: "Hel" }))
    v = applyEvent(v, ev("session.text.delta", { assistantMessageID: "a1", ordinal: 0, delta: "lo" }))
    const item = v.turns[0]!.steps[0]!.items[0] as any
    expect(item.text).toBe("Hello")
    expect(item.streaming).toBe(true)
    v = applyEvent(v, ev("session.text.ended", { assistantMessageID: "a1", ordinal: 0, text: "Hello!" }))
    expect((v.turns[0]!.steps[0]!.items[0] as any).text).toBe("Hello!")
    expect((v.turns[0]!.steps[0]!.items[0] as any).streaming).toBe(false)
  })

  test("a tool goes streaming → running → completed", () => {
    let v = emptyView()
    v = applyEvent(v, ev("session.tool.input.started", { assistantMessageID: "a1", id: "t1", name: "shell" }))
    expect(tools(v)[0]!.status).toBe("streaming")
    v = applyEvent(v, ev("session.tool.called", { assistantMessageID: "a1", id: "t1", input: { command: "ls" } }))
    expect(tools(v)[0]!.status).toBe("running")
    v = applyEvent(v, ev("session.tool.progress", { assistantMessageID: "a1", id: "t1", metadata: { shellID: "sh_1" } }))
    v = applyEvent(v, ev("session.tool.success", { assistantMessageID: "a1", id: "t1", content: [{ type: "text", text: "a\n" }], metadata: { exit: 0 } }))
    const t = tools(v)[0]!
    expect(t.status).toBe("completed")
    expect(t.metadata).toEqual({ shellID: "sh_1", exit: 0 })
    expect(t.output).toBe("a\n")
  })

  test("a steered message delivered mid-turn does not start a new turn", () => {
    let v = emptyView()
    v = applyEvent(v, ev("session.inbox.enqueued", { inboxID: "m1", item: { type: "user", payload: { text: "first" } } }))
    expect(v.queued).toHaveLength(1)
    v = applyEvent(v, ev("session.inbox.delivered", { inboxID: "m1" }))
    expect(v.queued).toHaveLength(0)
    expect(v.turns).toHaveLength(1)
    v = applyEvent(v, ev("session.step.started", { assistantMessageID: "a1", started: 1 }))
    v = applyEvent(v, ev("session.inbox.enqueued", { inboxID: "m2", item: { type: "user", payload: { text: "steer" } } }))
    v = applyEvent(v, ev("session.inbox.delivered", { inboxID: "m2" }))
    expect(v.turns).toHaveLength(1)
  })

  test("execution end closes the turn and stops streaming flags", () => {
    let v = emptyView()
    v = applyEvent(v, ev("session.text.delta", { assistantMessageID: "a1", ordinal: 0, delta: "x" }))
    v = applyEvent(v, ev("session.execution.failed", { error: { type: "x", message: "boom" } }, 2000))
    expect(v.turns[0]!.outcome).toBe("failed")
    expect(v.turns[0]!.error).toBe("boom")
    expect((v.turns[0]!.steps[0]!.items[0] as any).streaming).toBe(false)
    // A later turn starts fresh.
    v = applyEvent(v, ev("session.step.started", { assistantMessageID: "a2", started: 3000 }))
    expect(v.turns).toHaveLength(2)
  })

  test("unknown events return the same object", () => {
    const v = emptyView()
    expect(applyEvent(v, ev("session.usage.updated", {}))).toBe(v)
  })
})

describe("turn folding", () => {
  test("final answer is separated from the work", () => {
    const v = viewFromMessages((fixtureA as Fixture).messages)
    const turn = v.turns[1]!
    const { work, answer } = splitTurn(turn)
    expect(answer?.text.length).toBeGreaterThan(0)
    expect(countSteps(work)).toBeGreaterThan(0)
    expect(foldLabel(turn, work)).toMatch(/^\d+ steps? completed( · \d+s| · \d+m \d+s)?$/)
    // The answer is not repeated inside the folded steps.
    const folded = work.flatMap((s) => s.items.filter((i) => i.kind === "text").map((i: any) => i.text))
    expect(folded).not.toContain(answer!.text)
  })

  test("a plain reply folds nothing", () => {
    const v = viewFromMessages((fixtureA as Fixture).messages)
    const { work, answer } = splitTurn(v.turns[0]!)
    expect(answer?.text).toBeTruthy()
    expect(foldLabel(v.turns[0]!, work)).toBe("")
  })
})

describe("tool lines", () => {
  const cwd = "/tmp/opencode/occ-test"
  const all = [fixtureA, fixtureB, fixtureC].flatMap((f) => tools(viewFromMessages((f as Fixture).messages)))

  test("every real tool produces one short line", () => {
    for (const t of all) {
      const line = summarizeTool(t, cwd)
      expect(line.label.length).toBeGreaterThan(0)
      expect(line.target).not.toContain("\n")
      expect(line.result).not.toContain("\n")
    }
  })

  test("edit shows additions and deletions, paths are relative", () => {
    const edit = all.find((t) => t.name === "edit")
    expect(edit).toBeDefined()
    const line = summarizeTool(edit!, cwd)
    expect(line.result).toMatch(/^\+\d+ −\d+$/)
    expect(line.target.startsWith("/")).toBe(false)
    expect(line.path).toBeTruthy()
  })

  test("shell exit codes", () => {
    const sh = all.filter((t) => t.name === "shell")
    const bad = summarizeTool(sh.find((t) => t.metadata.exit === 3)!, cwd)
    expect(bad.result).toBe("✗ exit 3")
    expect(bad.tone).toBe("error")
    const ok = summarizeTool(sh.find((t) => t.metadata.exit === 0)!, cwd)
    expect(ok.result).toBe("✓ exit 0")
  })

  test("failed tool shows the error", () => {
    const read = all.find((t) => t.status === "error")!
    expect(summarizeTool(read, cwd).result.startsWith("✗ ")).toBe(true)
  })

  test("grep/glob counts, mcp names", () => {
    const grep = all.find((t) => t.name === "grep")!
    expect(summarizeTool(grep, cwd).result).toMatch(/match/)
    const mcp: ToolItem = { kind: "tool", id: "x", name: "fal_list_models", status: "running", input: { q: "a" }, metadata: {}, output: "" }
    expect(summarizeTool(mcp, cwd).label).toBe("fal · list models")
  })
})

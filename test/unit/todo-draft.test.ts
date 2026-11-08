import { describe, expect, test } from "bun:test"
import todoLive from "../fixtures/todowrite-live.json"
import { latestTodos, parseTodos, summarizeTodos, todoBar, todosOf } from "@occ/core/todo"
import { applyEvent, viewFromMessages } from "@occ/core/transcript/reducer"
import { initialTarget, planNewSession, showEmptyState } from "@occ/core/draft"
import { emptyView, type SessionView, type ToolItem } from "@occ/core/transcript/types"
import { folderName, looksLikePath, relativeTo, shortenHome, splitLine } from "@occ/core/paths"

const todoTool = (todos: unknown, status: ToolItem["status"] = "completed"): ToolItem => ({
  kind: "tool",
  id: Math.random().toString(),
  name: "todowrite",
  status,
  input: { todos } as any,
  metadata: {},
  output: "",
})
const viewWith = (...tools: ToolItem[]): SessionView => ({
  ...emptyView(),
  turns: tools.map((t, i) => ({ id: `t${i}`, steps: [{ id: `s${i}`, items: [t] }] })),
})

describe("todo parser (shape captured live from OpenCode 2.2.5 with experimental.todo on)", () => {
  test("drops entries without content, defaults unknown status to pending", () => {
    expect(parseTodos([{ content: "a", status: "completed" }, { content: "" }, { status: "pending" }, { content: "b", status: "weird" }, null, 3])).toEqual([
      { content: "a", status: "completed" },
      { content: "b", status: "pending" },
    ])
    expect(parseTodos("nope")).toEqual([])
  })
  test("live fixture: history and replayed events give the same list", () => {
    const hist = viewFromMessages(todoLive.messages as any)
    const live = (todoLive.events as any[]).reduce((v, e) => applyEvent(v, e), emptyView())
    for (const view of [hist, live]) {
      const items = latestTodos(view)!
      expect(items).toEqual([
        { content: "First task", status: "in_progress" },
        { content: "Second task", status: "pending" },
      ])
      const bar = todoBar(view, false)!
      expect([bar.done, bar.total, bar.current]).toEqual([0, 2, "First task"])
    }
  })
  test("live tool state carries metadata.todos next to the input", () => {
    const tool = viewFromMessages(todoLive.messages as any)
      .turns[0]!.steps.flatMap((s) => s.items)
      .find((i) => i.kind === "tool" && i.name === "todowrite") as ToolItem
    expect(tool.status).toBe("completed")
    expect(tool.metadata.todos).toEqual(tool.input.todos)
    expect(tool.output).toMatch(/^Todos updated: 0\/2 completed, 1 in progress, 1 pending/)
  })
  test("falls back to metadata.todos when the input has no list", () => {
    const meta = [{ content: "m", status: "in_progress" as const }]
    expect(todosOf({ input: {}, metadata: { todos: meta } })).toEqual(meta)
    expect(todosOf({ input: { todos: [{ content: "i", status: "pending" }] }, metadata: { todos: meta } })).toEqual([{ content: "i", status: "pending" }])
    expect(todosOf({ input: { todos: [] }, metadata: { todos: meta } })).toEqual([])
    expect(todosOf({ input: {}, metadata: {} })).toEqual([])
  })
  test("latest completed todowrite wins; running calls are ignored", () => {
    const v = viewWith(todoTool([{ content: "old", status: "pending" }]), todoTool([{ content: "new", status: "in_progress" }]), todoTool([{ content: "x", status: "pending" }], "running"))
    expect(latestTodos(v)?.map((t) => t.content)).toEqual(["new"])
    expect(latestTodos(emptyView())).toBeUndefined()
  })
  test("summary counts and current item", () => {
    const s = summarizeTodos(
      parseTodos([
        { content: "a", status: "completed" },
        { content: "b", status: "in_progress" },
        { content: "c", status: "pending" },
      ]),
    )
    expect([s.done, s.total, s.current]).toEqual([1, 3, "b"])
    expect(s.progress).toBeCloseTo(1 / 3)
  })
  test("bar hides when all finished and the turn ended, stays while running", () => {
    const done = viewWith(
      todoTool([
        { content: "a", status: "completed" },
        { content: "b", status: "cancelled" },
      ]),
    )
    expect(todoBar(done, false)).toBeUndefined()
    expect(todoBar(done, true)?.total).toBe(2)
    expect(todoBar(viewWith(todoTool([{ content: "a", status: "pending" }])), false)).toBeDefined()
    expect(todoBar(viewWith(todoTool([])), false)).toBeUndefined()
    expect(todoBar(emptyView(), true)).toBeUndefined()
  })
})

describe("draft sessions", () => {
  test("+ never creates; in an empty draft it only focuses", () => {
    expect(planNewSession({ kind: "draft" }, false)).toEqual({ action: "focus" })
    expect(planNewSession({ kind: "draft" }, true)).toEqual({ action: "open-draft" })
    expect(planNewSession({ kind: "session", id: "s" }, false)).toEqual({ action: "open-draft" })
    expect(planNewSession(undefined, false)).toEqual({ action: "open-draft" })
  })
  test("startup target", () => {
    expect(initialTarget([])).toEqual({ kind: "draft" })
    expect(initialTarget(["a", "b"])).toEqual({ kind: "session", id: "a" })
    expect(initialTarget(["a", "b"], "b")).toEqual({ kind: "session", id: "b" })
    expect(initialTarget(["a"], "gone")).toEqual({ kind: "session", id: "a" })
  })
  test("empty state", () => {
    expect(showEmptyState({ kind: "draft" }, 4)).toBe(true)
    expect(showEmptyState({ kind: "session", id: "a" }, 0)).toBe(true)
    expect(showEmptyState({ kind: "session", id: "a" }, 1)).toBe(false)
  })
})

describe("paths", () => {
  test("relative, home, folder, line", () => {
    expect(relativeTo("/p/a/b.ts", "/p/a")).toBe("b.ts")
    expect(relativeTo("/q/b.ts", "/p/a")).toBe("/q/b.ts")
    expect(shortenHome("/home/me/work/x", "/home/me")).toBe("~/work/x")
    expect(shortenHome("/opt/x", "/home/me")).toBe("/opt/x")
    expect(folderName("/a/b/c/")).toBe("c")
    expect(splitLine("src/a.ts:42")).toEqual({ path: "src/a.ts", line: 42 })
    expect(splitLine("src/a.ts")).toEqual({ path: "src/a.ts" })
  })
  test("inline path detection is conservative", () => {
    expect(looksLikePath("src/core/a.ts")).toBe(true)
    expect(looksLikePath("package.json")).toBe(true)
    expect(looksLikePath("src/a.ts:12")).toBe(true)
    expect(looksLikePath("https://x.dev/a.ts")).toBe(false)
    expect(looksLikePath("foo bar.ts")).toBe(false)
    expect(looksLikePath("console.log")).toBe(false)
    expect(looksLikePath("e.g.")).toBe(false)
  })
})

import { describe, expect, test } from "bun:test"
import { deriveWorkers, modelLabel, modelTitle, type ChildSession, type Worker } from "@occ/core/workers"
import { HIDDEN_PER_PARENT, addHidden, clearable, forgetSession, normalizeHidden, pruneHidden, removeHidden, visibleWorkers } from "@occ/core/worker-hidden"
import { emptyView, type SessionView, type ToolItem } from "@occ/core/transcript/types"

const models = [
  { id: "claude-sonnet-5-5", modelID: "claude-sonnet-5-5", providerID: "cli-proxy-api", name: "Claude Sonnet 5.5" },
  { id: "x/y", modelID: "y", providerID: "other", name: "Why" },
]
const sonnet = { id: "claude-sonnet-5-5", providerID: "cli-proxy-api", variant: "high" }

describe("modelLabel", () => {
  test("uses the model list name and appends the variant in display casing (like the model picker)", () => {
    expect(modelLabel(sonnet, models)).toBe("Claude Sonnet 5.5 · High")
    expect(modelLabel({ ...sonnet, variant: "xhigh" }, models)).toBe("Claude Sonnet 5.5 · X-High")
  })
  test("short form drops the vendor word and joins with a space", () => {
    expect(modelLabel(sonnet, models, { short: true })).toBe("Sonnet 5.5 High")
  })
  test("falls back to the model id when the list does not have it", () => {
    expect(modelLabel({ id: "gpt-9", providerID: "p" }, models)).toBe("gpt-9")
    expect(modelLabel({ id: "claude-sonnet-5-5", providerID: "other-provider" }, models)).toBe("claude-sonnet-5-5")
    expect(modelLabel(sonnet, [])).toBe("claude-sonnet-5-5 · High")
  })
  test("matches modelID too", () => {
    expect(modelLabel({ id: "y", providerID: "other" }, models)).toBe("Why")
  })
  test("no model, no label", () => {
    expect(modelLabel(undefined, models)).toBe("")
    expect(modelLabel(null, models)).toBe("")
    expect(modelTitle(undefined)).toBe("")
    expect(modelTitle(sonnet)).toBe("cli-proxy-api/claude-sonnet-5-5 (high)")
  })
})

const tool = (id: string, over: Partial<ToolItem> = {}): ToolItem => ({ kind: "tool", id, name: "subagent", status: "completed", input: { agent: "developer", description: id }, metadata: {}, output: "", ...over })
const viewOf = (...tools: ToolItem[]): SessionView => ({ ...emptyView(), loaded: true, turns: [{ id: "t1", steps: [{ id: "s1", items: tools }] }] })
const child = (id: string, over: Partial<ChildSession> = {}): ChildSession => ({ id, time: { created: 1000, updated: 1000 }, ...over })

describe("deriveWorkers carries the model", () => {
  test("from the child session, for a worker with a tool line", () => {
    const w = deriveWorkers({ view: viewOf(tool("a", { metadata: { sessionID: "ses_1" } })), children: [child("ses_1", { model: sonnet })], running: new Set() })
    expect(w[0]!.model).toEqual(sonnet)
  })
  test("from the child session, for an unexplained child", () => {
    const w = deriveWorkers({ view: viewOf(), children: [child("ses_2", { agent: "explore", model: sonnet })], running: new Set() })
    expect(w[0]!.model).toEqual(sonnet)
  })
  test("a continued worker keeps one model; none known gives undefined", () => {
    const w = deriveWorkers({ view: viewOf(tool("a", { metadata: { sessionID: "ses_1" } }), tool("b", { metadata: { sessionID: "ses_1" } })), children: [child("ses_1", { model: sonnet })], running: new Set() })
    expect(w).toHaveLength(1)
    expect(w[0]!.model).toEqual(sonnet)
    expect(deriveWorkers({ view: viewOf(tool("a")), children: [], running: new Set() })[0]!.model).toBeUndefined()
  })
})

const worker = (key: string, status: Worker["status"]): Worker => ({ key, toolIDs: [], calls: 1, agent: "developer", description: key, status })

describe("hiding workers", () => {
  const list = [worker("ses_a", "done"), worker("ses_b", "failed"), worker("ses_c", "running"), worker("ses_d", "stopped")]

  test("visibleWorkers drops hidden finished workers", () => {
    expect(visibleWorkers(list, ["ses_a"]).map((w) => w.key)).toEqual(["ses_b", "ses_c", "ses_d"])
    expect(visibleWorkers(list, new Set(["ses_a", "ses_b"])).map((w) => w.key)).toEqual(["ses_c", "ses_d"])
  })
  test("a running worker is never hidden, even with its key stored", () => {
    expect(visibleWorkers(list, ["ses_c"]).map((w) => w.key)).toContain("ses_c")
  })
  test("clearable is every worker that is not running", () => {
    expect(clearable(list).map((w) => w.key)).toEqual(["ses_a", "ses_b", "ses_d"])
    expect(clearable([worker("x", "running")])).toEqual([])
    expect(clearable([])).toEqual([])
  })
  test("everything hidden leaves an empty list", () => {
    const done = [worker("a", "done"), worker("b", "failed")]
    expect(visibleWorkers(done, clearable(done).map((w) => w.key))).toEqual([])
  })
})

describe("hidden worker storage", () => {
  test("normalizes anything storage hands back", () => {
    expect(normalizeHidden(undefined)).toEqual({})
    expect(normalizeHidden("x")).toEqual({})
    expect(normalizeHidden(["a"])).toEqual({})
    expect(normalizeHidden({ p: ["a", 3, "a", "", null, "b"], q: "no", r: [] })).toEqual({ p: ["a", "b"] })
  })
  test("addHidden is unique, per parent and capped to the newest keys", () => {
    let h = addHidden({}, "p", ["a", "b"])
    h = addHidden(h, "p", ["b", "c"])
    h = addHidden(h, "q", ["z"])
    expect(h).toEqual({ p: ["a", "b", "c"], q: ["z"] })
    const many = Array.from({ length: HIDDEN_PER_PARENT + 20 }, (_, i) => `k${i}`)
    const capped = addHidden({}, "p", many)
    expect(capped.p).toHaveLength(HIDDEN_PER_PARENT)
    expect(capped.p![HIDDEN_PER_PARENT - 1]).toBe(`k${HIDDEN_PER_PARENT + 19}`)
    expect(capped.p![0]).toBe("k20")
  })
  test("removeHidden un-hides, drops empty parents and keeps identity when nothing changes", () => {
    const h = { p: ["a", "b"], q: ["z"] }
    expect(removeHidden(h, "p", ["a"])).toEqual({ p: ["b"], q: ["z"] })
    expect(removeHidden(h, "q", ["z"])).toEqual({ p: ["a", "b"] })
    expect(removeHidden(h, "p", ["nope"])).toBe(h)
    expect(removeHidden(h, "none", ["a"])).toBe(h)
  })
  test("forgetSession drops a deleted parent and a deleted child", () => {
    expect(forgetSession({ p: ["ses_a", "ses_b"], q: ["ses_a"] }, "ses_a")).toEqual({ p: ["ses_b"] })
    expect(forgetSession({ p: ["ses_a"], q: ["x"] }, "p")).toEqual({ q: ["x"] })
  })
  test("pruneHidden drops sessions the server no longer lists, only for a complete list", () => {
    const h = { p: ["ses_a", "ses_gone", "tool:c1"] }
    expect(pruneHidden(h, "p", ["ses_a"], true)).toEqual({ p: ["ses_a", "tool:c1"] })
    expect(pruneHidden(h, "p", ["ses_a"], false)).toBe(h)
    expect(pruneHidden(h, "other", [], true)).toBe(h)
  })
})

import { describe, expect, test } from "bun:test"
import type { SlimModel } from "@occ/core/api"
import { contextLabel, contextTitle, contextUsage, tokenTotal } from "@occ/core/context-usage"
import { viewFromMessages } from "@occ/core/transcript/reducer"
import { applyEvent } from "@occ/core/transcript/reducer"
import { emptyView } from "@occ/core/transcript/types"

const tokens = (input: number, output = 0, reasoning = 0, read = 0, write = 0) => ({ input, output, reasoning, cache: { read, write } })
const model = { id: "m", providerID: "p" }
const catalog = (contextLimit?: number): SlimModel[] => [{ id: "m", modelID: "m", providerID: "p", name: "M", enabled: true, variants: [], ...(contextLimit ? { contextLimit } : {}) }]
const user = (id: string) => ({ type: "user", id, text: id, time: { created: 1 } })
const assistant = (id: string, total: number | undefined) => ({ type: "assistant", id, model, content: [], time: { created: 2 }, ...(total === undefined ? {} : { tokens: tokens(total) }) })
const compaction = (id: string, created = 10) => ({ type: "compaction", id, status: "completed", summary: "s", time: { created } })
const view = (...messages: unknown[]) => viewFromMessages(messages as never)

describe("tokenTotal", () => {
  test("adds input, output, reasoning and both cache kinds", () => {
    expect(tokenTotal(tokens(100, 20, 3, 40, 5))).toBe(168)
  })
  test("nothing for a step without usage", () => {
    expect(tokenTotal(undefined)).toBeUndefined()
  })
})

describe("contextUsage", () => {
  test("is the last step that reported usage, with the percentage of the window", () => {
    const usage = contextUsage(view(user("u1"), assistant("a1", 1000), assistant("a2", undefined), assistant("a3", 12_000)), catalog(200_000))
    expect(usage).toEqual({ total: 12_000, limit: 200_000, percent: 6 })
  })
  test("only the count when the model's window is unknown", () => {
    const usage = contextUsage(view(user("u1"), assistant("a1", 5000)), catalog())
    expect(usage).toEqual({ total: 5000 })
    expect(contextLabel(usage!)).toBe("5k")
  })
  test("nothing before the first reported usage", () => {
    expect(contextUsage(view(user("u1"), assistant("a1", undefined)), catalog(1000))).toBeUndefined()
    expect(contextUsage(emptyView(), catalog(1000))).toBeUndefined()
  })
  test("steps before a completed compaction no longer count", () => {
    const messages = [user("u1"), assistant("a1", 90_000), compaction("c1"), user("u2")]
    expect(contextUsage(view(...messages), catalog(100_000))).toBeUndefined()
    expect(contextUsage(view(...messages, assistant("a2", 8000)), catalog(100_000))).toEqual({ total: 8000, limit: 100_000, percent: 8 })
  })
  test("an auto compaction inside a turn drops the steps from before it", () => {
    const before = { ...assistant("a1", 90_000), time: { created: 2 } }
    const after = { ...assistant("a2", 7000), time: { created: 20 } }
    expect(contextUsage(view(user("u1"), before, compaction("c1", 10)), catalog(100_000))).toBeUndefined()
    expect(contextUsage(view(user("u1"), before, compaction("c1", 10), after), catalog(100_000))).toEqual({ total: 7000, limit: 100_000, percent: 7 })
  })
  test("a staged revert hides the steps from its boundary on", () => {
    const base = view(user("u1"), assistant("a1", 3000), user("u2"), assistant("a2", 50_000))
    expect(contextUsage({ ...base, revert: { messageID: "u2", files: 0 } }, catalog(100_000))).toEqual({ total: 3000, limit: 100_000, percent: 3 })
    expect(contextUsage({ ...base, revert: { messageID: "u1", files: 0 } }, catalog(100_000))).toBeUndefined()
  })
  test("a step that reported zero tokens still counts: the count shows 0", () => {
    expect(contextUsage(view(user("u1"), assistant("a1", 4000), assistant("a2", 0)), catalog(1000))).toEqual({ total: 0, limit: 1000, percent: 0 })
  })
  test("a staged revert whose boundary is not in the view gives nothing", () => {
    const base = view(user("u1"), assistant("a1", 3000))
    expect(contextUsage({ ...base, revert: { messageID: "gone", files: 0 } }, catalog(100_000))).toBeUndefined()
  })
  test("a failed step keeps the tokens it reported", () => {
    let v = emptyView()
    v = applyEvent(v, { type: "session.step.started", created: 5, data: { assistantMessageID: "a1", agent: "build", model, started: 5 } })
    v = applyEvent(v, { type: "session.step.failed", created: 6, data: { assistantMessageID: "a1", error: { message: "boom" }, tokens: tokens(700) } })
    expect(contextUsage(v, catalog(1000))).toEqual({ total: 700, limit: 1000, percent: 70 })
  })
  test("a compaction boundary holds without any step timestamps", () => {
    const bare = (id: string, total: number) => {
      const { time: _t, ...rest } = assistant(id, total)
      return rest
    }
    expect(contextUsage(view(user("u1"), bare("a1", 90_000), compaction("c1", 10)), catalog(100_000))).toBeUndefined()
    expect(contextUsage(view(user("u1"), bare("a1", 90_000), compaction("c1", 10), bare("a2", 6000)), catalog(100_000))).toEqual({ total: 6000, limit: 100_000, percent: 6 })
  })
  test("a missing or zero context window gives the count alone", () => {
    expect(contextUsage(view(user("u1"), assistant("a1", 900)), [])).toEqual({ total: 900 })
    expect(contextUsage(view(user("u1"), assistant("a1", 900)), catalog(0))).toEqual({ total: 900 })
  })
  test("a live step takes its model from step.started and its tokens from step.ended", () => {
    let v = emptyView()
    v = applyEvent(v, { type: "session.step.started", created: 5, data: { assistantMessageID: "a1", agent: "build", model, started: 5 } })
    expect(contextUsage(v, catalog(1000))).toBeUndefined()
    v = applyEvent(v, { type: "session.step.ended", created: 6, data: { assistantMessageID: "a1", finish: "stop", tokens: tokens(250) } })
    expect(contextUsage(v, catalog(1000))).toEqual({ total: 250, limit: 1000, percent: 25 })
  })
})

describe("context text", () => {
  test("the label is compact, and the title has the full numbers", () => {
    const usage = { total: 12_345, limit: 200_000, percent: 6 }
    expect(contextLabel(usage)).toBe("12k · 6%")
    expect(contextTitle(usage)).toBe("12,345 tokens in the context · 6% of 200,000")
    expect(contextTitle({ total: 900 })).toBe("900 tokens in the context")
  })
})

import { describe, expect, test } from "bun:test"
import type { TurnView } from "@occ/core/transcript/types"
import { renderDue, STREAM_RENDER_MS } from "@occ/ui/markdown-stream"
import { turnToolIds } from "@occ/ui/transcript-index"

function turn(id: string, items: TurnView["steps"][number]["items"]): TurnView {
  return { id, steps: [{ id: `${id}-step`, items }] }
}

describe("streaming markdown throttle", () => {
  test("a finished answer renders at once, whatever the last render cost", () => {
    expect(STREAM_RENDER_MS).toBe(250)
    expect(renderDue(false, 0)).toBe(true)
    expect(renderDue(false, STREAM_RENDER_MS * 10)).toBe(true)
  })

  test("a streaming answer renders at most once per interval", () => {
    expect(renderDue(true, 0)).toBe(false)
    expect(renderDue(true, STREAM_RENDER_MS - 1)).toBe(false)
    expect(renderDue(true, STREAM_RENDER_MS)).toBe(true)
  })
})

describe("transcript tool ids", () => {
  test("keeps the tool ids in order and ignores text, reasoning and other turns", () => {
    const first = turn("t1", [
      { kind: "text", key: "a", text: "hi", streaming: false },
      { kind: "tool", id: "tool_a", name: "read", status: "completed", input: {}, metadata: {}, output: "" },
      { kind: "reasoning", key: "b", text: "hm", streaming: false },
    ])
    const second = turn("t2", [{ kind: "tool", id: "tool_b", name: "bash", status: "running", input: {}, metadata: {}, output: "" }])
    expect(turnToolIds(first)).toEqual(["tool_a"])
    expect(turnToolIds(second)).toEqual(["tool_b"])
  })

  test("a turn object is scanned once, an untouched turn keeps its ids across deltas", () => {
    const first = turn("t1", [{ kind: "tool", id: "tool_a", name: "read", status: "running", input: {}, metadata: {}, output: "" }])
    const once = turnToolIds(first)
    expect(turnToolIds(first)).toBe(once)
    // The reducer shares every turn a delta did not touch; a new object is a real change.
    const copy = turn("t1", first.steps[0]!.items)
    expect(turnToolIds(copy)).not.toBe(once)
    expect(turnToolIds(copy)).toEqual(["tool_a"])
  })

  test("a turn without tools has no ids", () => {
    expect(turnToolIds({ id: "t3", steps: [] })).toEqual([])
  })
})

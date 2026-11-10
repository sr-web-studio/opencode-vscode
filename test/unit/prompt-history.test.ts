import { describe, expect, test } from "bun:test"
import { PROMPT_HISTORY_LIMIT, promptHistory, recallNewer, recallOlder } from "@occ/core/prompt-history"
import { emptyView, type SessionView, type TurnView } from "@occ/core/transcript/types"

const turn = (id: string, text?: string): TurnView => ({ id, ...(text === undefined ? {} : { user: { id: `u-${id}`, text } }), steps: [] })
const view = (turns: TurnView[], revert?: { messageID: string; files: number }): SessionView => ({
  ...emptyView(),
  turns,
  loaded: true,
  ...(revert ? { revert } : {}),
})

describe("promptHistory", () => {
  test("newest first, only the user's own prompts", () => {
    const v = view([turn("1", "first prompt"), turn("2", "second prompt"), turn("3")])
    expect(promptHistory(v)).toEqual(["second prompt", "first prompt"])
  })

  test("a compaction marker and an empty prompt are skipped", () => {
    const v = view([turn("1", "real"), turn("2", "   "), { id: "3", compaction: { summary: "summary" }, steps: [] }, turn("4", "after")])
    expect(promptHistory(v)).toEqual(["after", "real"])
  })

  test("the same prompt sent twice in a row is kept once", () => {
    const v = view([turn("1", "build"), turn("2", "build"), turn("3", "test"), turn("4", "build")])
    expect(promptHistory(v)).toEqual(["build", "test", "build"])
  })

  test("the exact text is kept, spaces and lines included", () => {
    const v = view([turn("1", "  keep\n\nthese  ")])
    expect(promptHistory(v)).toEqual(["  keep\n\nthese  "])
  })

  test("a staged revert hides the prompts it would bring back", () => {
    const v = view([turn("1", "one"), turn("2", "two"), turn("3", "three")], { messageID: "u-2", files: 0 })
    expect(promptHistory(v)).toEqual(["one"])
  })

  test("the list is capped", () => {
    const turns = Array.from({ length: PROMPT_HISTORY_LIMIT + 20 }, (_, i) => turn(String(i), `p${i}`))
    const list = promptHistory(view(turns))
    expect(list.length).toBe(PROMPT_HISTORY_LIMIT)
    expect(list[0]).toBe(`p${PROMPT_HISTORY_LIMIT + 19}`)
    expect(promptHistory(view(turns), 3)).toEqual([`p${PROMPT_HISTORY_LIMIT + 19}`, `p${PROMPT_HISTORY_LIMIT + 18}`, `p${PROMPT_HISTORY_LIMIT + 17}`])
  })

  test("a draft or an empty session has no history", () => {
    expect(promptHistory(view([]))).toEqual([])
  })
})

describe("walking the history", () => {
  const history = ["newest", "middle", "oldest"]

  test("up starts at the newest and goes one prompt older each time", () => {
    expect(recallOlder(history, -1)).toEqual({ index: 0, text: "newest" })
    expect(recallOlder(history, 0)).toEqual({ index: 1, text: "middle" })
    expect(recallOlder(history, 1)).toEqual({ index: 2, text: "oldest" })
  })

  test("up at the oldest prompt has nothing to show", () => {
    expect(recallOlder(history, 2)).toBeUndefined()
    expect(recallOlder([], -1)).toBeUndefined()
  })

  test("down goes forward again and finally back to the empty box", () => {
    expect(recallNewer(history, 2)).toEqual({ index: 1, text: "middle" })
    expect(recallNewer(history, 1)).toEqual({ index: 0, text: "newest" })
    expect(recallNewer(history, 0)).toEqual({ index: -1, text: "" })
    expect(recallNewer(history, -1)).toEqual({ index: -1, text: "" })
  })

  test("an index past the list (the session changed under the walk) goes back to empty", () => {
    expect(recallNewer(history, 9)).toEqual({ index: -1, text: "" })
    expect(recallOlder(history, 9)).toBeUndefined()
  })
})

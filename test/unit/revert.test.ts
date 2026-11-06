import { describe, expect, test } from "bun:test"
import { applyEvent, viewFromMessages } from "../../src/core/transcript/reducer"
import { boundaryMissing, canRevert, hiddenTurnCount, revertBarText, revertedPrompt, revertFromServer, visibleTurns } from "../../src/core/transcript/revert"

const msgs = (): any[] => [
  { id: "u1", type: "user", text: "make a.txt", time: { created: 1 } },
  { id: "a1", type: "assistant", content: [{ type: "text", text: "ok" }], time: { created: 2 } },
  { id: "i1", type: "idle", outcome: "succeeded", time: { created: 3 } },
  { id: "u2", type: "user", text: "edit a.txt", time: { created: 4 } },
  { id: "a2", type: "assistant", content: [{ type: "text", text: "done" }], time: { created: 5 } },
  { id: "i2", type: "idle", outcome: "succeeded", time: { created: 6 } },
  { id: "u3", type: "user", text: "third", time: { created: 7 } },
  { id: "a3", type: "assistant", content: [], time: { created: 8 } },
  { id: "i3", type: "idle", outcome: "succeeded", time: { created: 9 } },
]
const ev = (type: string, data: unknown): any => ({ id: "e", type, created: 10, data })
const ids = (v: ReturnType<typeof viewFromMessages>) => visibleTurns(v).map((t) => t.user?.id)

describe("revert reducer", () => {
  test("staged hides the boundary prompt and everything after it, but keeps the data for Redo", () => {
    const v = applyEvent(viewFromMessages(msgs()), ev("session.revert.staged", { sessionID: "s", revert: { messageID: "u2", files: [{ file: "a.txt" }] } }))
    expect(v.revert).toEqual({ messageID: "u2", files: 1 })
    expect(ids(v)).toEqual(["u1"])
    expect(v.turns.length).toBe(3)
    expect(hiddenTurnCount(v)).toBe(2)
    expect(revertedPrompt(v)).toBe("edit a.txt")
  })

  test("staging the first prompt hides the whole conversation", () => {
    const v = applyEvent(viewFromMessages(msgs()), ev("session.revert.staged", { revert: { messageID: "u1" } }))
    expect(ids(v)).toEqual([])
  })

  test("cleared (Redo) shows everything again", () => {
    const staged = applyEvent(viewFromMessages(msgs()), ev("session.revert.staged", { revert: { messageID: "u2" } }))
    const v = applyEvent(staged, ev("session.revert.cleared", { sessionID: "s" }))
    expect(v.revert).toBeUndefined()
    expect(ids(v)).toEqual(["u1", "u2", "u3"])
  })

  test("committed drops the hidden messages for good", () => {
    const staged = applyEvent(viewFromMessages(msgs()), ev("session.revert.staged", { revert: { messageID: "u2" } }))
    const v = applyEvent(staged, ev("session.revert.committed", { sessionID: "s", to: "u2" }))
    expect(v.revert).toBeUndefined()
    expect(v.turns.map((t) => t.user?.id)).toEqual(["u1"])
  })

  test("committed without a known boundary uses the staged one; without either it changes nothing", () => {
    const staged = applyEvent(viewFromMessages(msgs()), ev("session.revert.staged", { revert: { messageID: "u3" } }))
    expect(applyEvent(staged, ev("session.revert.committed", {})).turns.length).toBe(2)
    const plain = viewFromMessages(msgs())
    expect(applyEvent(plain, ev("session.revert.committed", {})).turns.length).toBe(3)
  })

  test("a new prompt after commit appends after the kept turns", () => {
    const staged = applyEvent(viewFromMessages(msgs()), ev("session.revert.staged", { revert: { messageID: "u2" } }))
    const committed = applyEvent(staged, ev("session.revert.committed", { to: "u2" }))
    const next = applyEvent(committed, ev("session.inbox.enqueued", { inboxID: "n1", item: { type: "user", payload: { text: "again" } } }))
    expect(next.queued.length).toBe(1)
    expect(committed.turns.length).toBe(1)
  })

  test("cleared with nothing staged and unrelated events return the same object", () => {
    const v = viewFromMessages(msgs())
    expect(applyEvent(v, ev("session.revert.cleared", {}))).toBe(v)
    expect(applyEvent(v, ev("session.revert.staged", { revert: {} }))).toBe(v)
  })

  test("a boundary that is not in the loaded history is reported, and nothing is hidden by guess", () => {
    const v = applyEvent(viewFromMessages(msgs()), ev("session.revert.staged", { revert: { messageID: "old" } }))
    expect(boundaryMissing(v)).toBe(true)
    expect(visibleTurns(v).length).toBe(3)
  })
})

describe("revert bar text", () => {
  test("reports restored files only when the server restored some", () => {
    expect(revertBarText({ messageID: "u", files: 3 })).toBe("Reverted · 3 files restored")
    expect(revertBarText({ messageID: "u", files: 1 })).toBe("Reverted · 1 file restored")
  })
  test("never claims files were restored when there were none", () => {
    expect(revertBarText({ messageID: "u", files: 0 })).toBe("Conversation reverted · files not restored")
    expect(revertBarText(revertFromServer({ messageID: "u", files: [] })!)).not.toContain("restored ·")
    expect(revertBarText(revertFromServer({ messageID: "u" })!)).toBe("Conversation reverted · files not restored")
  })
  test("Session.Info.revert with a numeric or array files field", () => {
    expect(revertFromServer({ messageID: "u", files: 2 })).toEqual({ messageID: "u", files: 2 })
    expect(revertFromServer(null)).toBeUndefined()
    expect(revertFromServer({})).toBeUndefined()
  })
})

describe("feature detection", () => {
  test("older servers without session.revert hide the button", () => {
    expect(canRevert({ session: {} })).toBe(false)
    expect(canRevert({})).toBe(false)
    expect(canRevert({ session: { revert: { stage: () => {} } } })).toBe(true)
  })
})

describe("attachments on user turns", () => {
  test("history and live prompts carry chips (names only, never the data)", () => {
    const v = viewFromMessages([
      { id: "u", type: "user", text: "look", files: [{ data: "AAAA", mime: "image/png", source: { type: "uri", uri: "file:///c%3A/Users/me/shot%201.png" }, name: "shot 1.png" }, { data: "x", mime: "text/plain", source: { type: "inline" } }] },
    ] as any)
    expect(v.turns[0]!.user!.files).toEqual([{ name: "shot 1.png", mime: "image/png" }, { name: "file", mime: "text/plain" }])
    const live = applyEvent(
      { turns: [], queued: [], loaded: true },
      { id: "e", type: "session.inbox.enqueued", created: 1, data: { inboxID: "i1", item: { type: "user", payload: { text: "hi", files: [{ uri: "data:image/png;base64,AAAA", name: "pasted.png" }] } } } },
    )
    expect(live.queued[0]!.files).toEqual([{ name: "pasted.png", mime: "image/png" }])
    const delivered = applyEvent(live, { id: "e2", type: "session.inbox.delivered", created: 2, data: { inboxID: "i1" } })
    expect(delivered.turns[0]!.user!.files).toEqual([{ name: "pasted.png", mime: "image/png" }])
  })
})

import { describe, expect, test } from "bun:test"
import { applyEvent, viewFromMessages } from "@occ/core/transcript/reducer"
import { contentSignature } from "@occ/core/transcript/signature"

const base = () => viewFromMessages([{ id: "u", type: "user", text: "x" }, { id: "a", type: "assistant", content: [{ type: "text", text: "hi" }] }] as any)
const ev = (type: string, data: unknown): any => ({ id: "e", type, created: 1, data })

describe("contentSignature", () => {
  test("a structurally identical copy has the same signature (no false 'new content')", () => {
    expect(contentSignature(base())).toBe(contentSignature(JSON.parse(JSON.stringify(base()))))
  })
  test("streamed text, a new tool and a new turn each change it", () => {
    const a = base()
    const b = applyEvent(a, ev("session.text.delta", { assistantMessageID: "a", ordinal: 0, delta: " more" }))
    const c = applyEvent(b, ev("session.tool.called", { assistantMessageID: "a", id: "t1", input: {} }))
    const d = applyEvent(c, ev("session.execution.succeeded", { sessionID: "s" }))
    const sigs = [a, b, c, d].map((v) => contentSignature(v))
    expect(new Set(sigs).size).toBe(4)
  })
  test("staging a revert changes it, an unrelated event does not", () => {
    const a = base()
    expect(contentSignature(applyEvent(a, ev("session.revert.staged", { revert: { messageID: "u" } })))).not.toBe(contentSignature(a))
    expect(contentSignature(applyEvent(a, ev("session.step.streamed", { assistantMessageID: "a" })))).toBe(contentSignature(a))
  })
})

import { describe, expect, test } from "bun:test"
import { withoutTurnError } from "../../src/core/transcript/turn"
import type { StepView } from "../../src/core/transcript/types"

const denied = "Model 'claude-opus-5-5' is not allowed for this key"
const step = (id: string, error?: string): StepView => ({ id, items: [], error })

describe("withoutTurnError", () => {
  test("a step that failed with the turn's error drops its copy", () => {
    const out = withoutTurnError([step("a"), step("b", denied)], denied)
    expect(out.map((s) => s.error)).toEqual([undefined, undefined])
  })

  test("whitespace differences still count as the same error", () => {
    expect(withoutTurnError([step("a", `${denied}\n`)], `  ${denied}`)[0]?.error).toBeUndefined()
  })

  test("a different step error stays", () => {
    const out = withoutTurnError([step("a", "Step failed"), step("b", denied)], denied)
    expect(out.map((s) => s.error)).toEqual(["Step failed", undefined])
  })

  test("without a turn error the steps are returned unchanged", () => {
    const steps = [step("a", denied)]
    expect(withoutTurnError(steps, undefined)).toBe(steps)
    expect(withoutTurnError(steps, "  ")).toBe(steps)
  })
})

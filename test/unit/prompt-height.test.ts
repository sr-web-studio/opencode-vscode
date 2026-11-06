import { describe, expect, test } from "bun:test"
import { promptHeight, TOLERANCE_PX } from "../../src/core/prompt-height"

const at = (scrollHeight: number, lineHeight = 22.4) => promptHeight({ scrollHeight, lineHeight, minLines: 2, maxLines: 12 })

describe("promptHeight", () => {
  test("empty and one-line content use the two-line minimum, without a scrollbar", () => {
    expect(at(0)).toEqual({ height: 45, overflow: "hidden" }) // ceil(44.8)
    expect(at(22)).toEqual({ height: 45, overflow: "hidden" })
    expect(at(45)).toEqual({ height: 45, overflow: "hidden" })
  })

  test("growing from 1 to 2 lines with a fractional line height never shows a scrollbar", () => {
    // 2 lines of 22.4px = 44.8px, scrollHeight rounds to 45: the box must be at least that tall.
    const two = at(45)
    expect(two.height).toBeGreaterThanOrEqual(45)
    expect(two.overflow).toBe("hidden")
    // 3 lines = 67.2px, scrollHeight 67.
    expect(at(67)).toEqual({ height: 67, overflow: "hidden" })
  })

  test("the height is rounded up so it is never shorter than the content", () => {
    for (const lh of [20.8, 21.6, 22.4, 23.2, 24.5, 25.6]) {
      for (let lines = 1; lines <= 12; lines++) {
        const content = Math.round(lines * lh) // what scrollHeight reports
        const r = promptHeight({ scrollHeight: content, lineHeight: lh, minLines: 2, maxLines: 12 })
        expect(r.height).toBeGreaterThanOrEqual(content)
        expect(r.overflow).toBe("hidden")
      }
    }
  })

  test("exactly 12 lines fits, with no scrollbar even when rounding adds a pixel", () => {
    expect(at(269)).toEqual({ height: 269, overflow: "hidden" }) // 12 * 22.4 = 268.8
    expect(at(270)).toEqual({ height: 269, overflow: "hidden" })
    expect(at(269 + TOLERANCE_PX)).toEqual({ height: 269, overflow: "hidden" })
  })

  test("the scrollbar appears only when the content is more than max + 2px", () => {
    expect(at(269 + TOLERANCE_PX + 1)).toEqual({ height: 269, overflow: "auto" })
    expect(at(1000)).toEqual({ height: 269, overflow: "auto" })
  })

  test("integer line heights", () => {
    const r = promptHeight({ scrollHeight: 40, lineHeight: 20, minLines: 2, maxLines: 12 })
    expect(r).toEqual({ height: 40, overflow: "hidden" })
    expect(promptHeight({ scrollHeight: 242, lineHeight: 20, minLines: 2, maxLines: 12 })).toEqual({ height: 240, overflow: "hidden" })
    expect(promptHeight({ scrollHeight: 243, lineHeight: 20, minLines: 2, maxLines: 12 })).toEqual({ height: 240, overflow: "auto" })
  })

  test("a narrower panel that wraps onto more lines grows the box", () => {
    expect(at(45).height).toBe(45)
    expect(at(112).height).toBe(112) // 5 lines
  })

  test("bad measurements fall back safely", () => {
    expect(promptHeight({ scrollHeight: NaN, lineHeight: NaN, minLines: 2, maxLines: 12 })).toEqual({ height: 40, overflow: "hidden" })
    expect(promptHeight({ scrollHeight: 10, lineHeight: 0, minLines: 2, maxLines: 12 }).height).toBe(40)
    expect(promptHeight({ scrollHeight: 100, lineHeight: 20, minLines: 5, maxLines: 3 }).height).toBe(100)
  })
})

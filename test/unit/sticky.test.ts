import { describe, expect, test } from "bun:test"
import { currentPrompt, promptLabel, promptPosition, type PromptPosition } from "@occ/core/sticky"

const root = { top: 100, bottom: 600 }
const pos = (entries: Array<[string, PromptPosition]>) => new Map(entries)

describe("promptPosition", () => {
  test("intersecting is visible, also when only partly in view", () => {
    expect(promptPosition({ top: 90, bottom: 130 }, root, true)).toBe("visible")
  })
  test("fully above the top edge", () => {
    expect(promptPosition({ top: 20, bottom: 80 }, root, false)).toBe("above")
    expect(promptPosition({ top: 20, bottom: 100 }, root, false)).toBe("above")
  })
  test("below the bottom edge", () => {
    expect(promptPosition({ top: 650, bottom: 700 }, root, false)).toBe("below")
  })
})

describe("currentPrompt", () => {
  const order = ["a", "b", "c", "d"]
  test("the last prompt that is above the top edge", () => {
    expect(
      currentPrompt(
        order,
        pos([
          ["a", "above"],
          ["b", "above"],
          ["c", "visible"],
          ["d", "below"],
        ]),
      ),
    ).toBe("b")
  })
  test("all above: the newest one", () => {
    expect(
      currentPrompt(
        order,
        pos([
          ["a", "above"],
          ["b", "above"],
          ["c", "above"],
          ["d", "above"],
        ]),
      ),
    ).toBe("d")
  })
  test("nothing scrolled out: no bar", () => {
    expect(
      currentPrompt(
        order,
        pos([
          ["a", "visible"],
          ["b", "below"],
          ["c", "below"],
          ["d", "below"],
        ]),
      ),
    ).toBeUndefined()
  })
  test("a visible prompt hides the bar even when an older one is above", () => {
    // The newest visible prompt sits below the older "above" one, so the bar shows the older one only while its turn is under the edge.
    expect(
      currentPrompt(
        order,
        pos([
          ["a", "above"],
          ["b", "visible"],
        ]),
      ),
    ).toBe("a")
  })
  test("unknown positions are skipped; an empty list gives nothing", () => {
    expect(currentPrompt(order, pos([["a", "above"]]))).toBe("a")
    expect(currentPrompt([], pos([]))).toBeUndefined()
  })
  test("order follows the transcript, not the map insertion order", () => {
    expect(
      currentPrompt(
        order,
        pos([
          ["c", "above"],
          ["a", "above"],
        ]),
      ),
    ).toBe("c")
  })
})

describe("promptLabel", () => {
  test("collapses whitespace and newlines to one line", () => {
    expect(promptLabel({ text: "  fix the\n\n  bug   now " })).toBe("fix the bug now")
  })
  test("no text falls back to attachment names, then a placeholder", () => {
    expect(promptLabel({ text: " ", files: [{ name: "a.png" }, { name: "b.png" }] })).toBe("a.png, b.png")
    expect(promptLabel({ text: "" })).toBe("(no text)")
  })
})

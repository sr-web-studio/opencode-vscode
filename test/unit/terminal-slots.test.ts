import { describe, expect, test } from "bun:test"
import { planTerminal, shouldReveal, terminalsToClose, type Slot } from "../../src/core/terminal-slots"

const slot = (id: string, sessionID: string, n: number, busy: boolean, lastUsed = 0): Slot => ({ id, sessionID, slot: n, busy, lastUsed })

describe("planTerminal, session mode", () => {
  test("the first command of a session creates slot 1", () => {
    expect(planTerminal([], "session", "s1")).toEqual({ kind: "create", slot: 1 })
  })
  test("later commands reuse the idle terminal", () => {
    expect(planTerminal([slot("a", "s1", 1, false)], "session", "s1")).toEqual({ kind: "reuse", id: "a" })
  })
  test("a command while the terminal is busy gets #2", () => {
    expect(planTerminal([slot("a", "s1", 1, true)], "session", "s1")).toEqual({ kind: "create", slot: 2 })
  })
  test("the extra terminal is reused once it is idle, and the lowest idle one is preferred", () => {
    const t = [slot("a", "s1", 1, true), slot("b", "s1", 2, false)]
    expect(planTerminal(t, "session", "s1")).toEqual({ kind: "reuse", id: "b" })
    expect(planTerminal([slot("a", "s1", 1, false), slot("b", "s1", 2, false)], "session", "s1")).toEqual({ kind: "reuse", id: "a" })
  })
  test("two busy terminals give #3, and a gap is filled first", () => {
    expect(planTerminal([slot("a", "s1", 1, true), slot("b", "s1", 2, true)], "session", "s1")).toEqual({ kind: "create", slot: 3 })
    expect(planTerminal([slot("a", "s1", 1, true), slot("c", "s1", 3, true)], "session", "s1")).toEqual({ kind: "create", slot: 2 })
  })
  test("other sessions do not interfere", () => {
    const t = [slot("a", "s2", 1, true), slot("b", "s2", 2, false)]
    expect(planTerminal(t, "session", "s1")).toEqual({ kind: "create", slot: 1 })
    expect(planTerminal(t, "session", "s2")).toEqual({ kind: "reuse", id: "b" })
  })
})

describe("planTerminal, perCommand mode", () => {
  test("always creates, with the next free slot", () => {
    expect(planTerminal([], "perCommand", "s1")).toEqual({ kind: "create", slot: 1 })
    expect(planTerminal([slot("a", "s1", 1, false)], "perCommand", "s1")).toEqual({ kind: "create", slot: 2 })
  })
})

describe("terminalsToClose (maxOpen)", () => {
  const all = [slot("a", "s1", 1, false, 10), slot("b", "s2", 1, true, 5), slot("c", "s3", 1, false, 30), slot("d", "s4", 1, false, 20)]
  test("nothing to close within the limit", () => {
    expect(terminalsToClose(all, 4)).toEqual([])
    expect(terminalsToClose(all, 10)).toEqual([])
  })
  test("closes the least recently used idle ones first", () => {
    expect(terminalsToClose(all, 3)).toEqual(["a"])
    expect(terminalsToClose(all, 2)).toEqual(["a", "d"])
  })
  test("never closes a busy terminal, even over the limit", () => {
    expect(terminalsToClose(all, 1)).toEqual(["a", "d", "c"])
    expect(terminalsToClose([slot("r", "s1", 1, true), slot("s", "s2", 1, true)], 1)).toEqual([])
  })
  test("a limit below 1 keeps one", () => {
    expect(terminalsToClose([slot("a", "s1", 1, false), slot("b", "s2", 1, false)], 0)).toEqual(["a"])
  })
})

describe("shouldReveal", () => {
  const base = { reveal: "onStart" as const, explicit: false, activeIsOursOrNone: true }
  test("an explicit Show terminal click always reveals", () => {
    expect(shouldReveal({ ...base, explicit: true, reveal: "never", activeIsOursOrNone: false })).toBe(true)
  })
  test("never switches away from the user's own terminal", () => {
    expect(shouldReveal({ ...base, activeIsOursOrNone: false })).toBe(false)
  })
  test("reveals on start when the panel shows none or one of ours", () => {
    expect(shouldReveal(base)).toBe(true)
  })
  test("never and off do not reveal automatically", () => {
    expect(shouldReveal({ ...base, reveal: "never" })).toBe(false)
    expect(shouldReveal({ ...base, reveal: "off" })).toBe(false)
  })
})

import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@occ/core/api"
import { combineActivity, compareActivity, sessionActivity, sessionState, sortByActivity } from "@occ/core/activity-order"
import type { Activity, ActivityKey, ActivityState } from "@occ/core/activity-order"

const h = 3_600_000
const now = new Date(2026, 10, 6, 15, 0, 0).getTime()

const sets = (running: string[] = [], waiting: string[] = []) => ({ running: new Set(running), waiting: new Set(waiting) })

const session = (id: string, time: Partial<SessionInfo["time"]> & { updated: number }): Pick<SessionInfo, "id" | "time"> => ({
  id,
  time: { created: time.updated, ...time },
})

const key = (state: ActivityState, last: number, title?: string, id = "x"): ActivityKey => ({ state, last, title, id })

describe("session state", () => {
  test("waiting outranks running, running outranks idle", () => {
    expect(sessionState("a", sets(["a"], ["a"]))).toBe("waiting")
    expect(sessionState("a", sets(["a"]))).toBe("running")
    expect(sessionState("a", sets())).toBe("idle")
  })

  test("a session not in a set is idle even when others are busy", () => {
    expect(sessionState("a", sets(["b"], ["c"]))).toBe("idle")
  })
})

describe("session activity", () => {
  test("last activity is time.updated", () => {
    expect(sessionActivity(session("a", { updated: now - h }), sets(["a"]))).toEqual({ state: "running", last: now - h })
  })

  test("the newest state stamp counts when it is later than updated", () => {
    expect(sessionActivity(session("a", { updated: now - 2 * h, idle: now - h }), sets()).last).toBe(now - h)
    expect(sessionActivity(session("a", { updated: now - 2 * h, busy: now - h }), sets()).last).toBe(now - h)
  })

  test("an untouched session falls back to created", () => {
    expect(sessionActivity({ id: "a", time: { created: now - h, updated: 0 } }, sets()).last).toBe(now - h)
  })

  test("viewing a session does not move it", () => {
    expect(sessionActivity(session("a", { updated: now - 5 * h, viewed: now }), sets()).last).toBe(now - 5 * h)
  })
})

describe("project activity", () => {
  const a = (state: ActivityState, last: number): Activity => ({ state, last })

  test("the highest session state wins", () => {
    expect(combineActivity([a("idle", 3), a("running", 2), a("waiting", 1)]).state).toBe("waiting")
    expect(combineActivity([a("idle", 3), a("running", 2)]).state).toBe("running")
    expect(combineActivity([a("idle", 3)]).state).toBe("idle")
  })

  test("the newest activity wins, own record included", () => {
    expect(combineActivity([a("idle", 10), a("running", 40)], 25).last).toBe(40)
    expect(combineActivity([a("idle", 10), a("running", 20)], 35).last).toBe(35)
  })

  test("without an own timestamp only the sessions count", () => {
    expect(combineActivity([a("waiting", 10), a("idle", 30)])).toEqual({ state: "waiting", last: 30 })
  })

  test("nothing known is idle at zero", () => {
    expect(combineActivity([])).toEqual({ state: "idle", last: 0 })
    expect(combineActivity([], 0)).toEqual({ state: "idle", last: 0 })
    expect(combineActivity(new Set<Activity>(), 7)).toEqual({ state: "idle", last: 7 })
  })
})

describe("the shared order", () => {
  test("waiting, then running, then idle, whatever the timestamps", () => {
    const items = [key("idle", now, "A", "1"), key("running", now - 5 * h, "B", "2"), key("waiting", now - 10 * h, "C", "3")]
    expect(sortByActivity(items, (i) => i).map((i) => i.state)).toEqual(["waiting", "running", "idle"])
  })

  test("newest first inside a group", () => {
    const items = [key("running", now - 2 * h, "Old", "1"), key("running", now, "New", "2"), key("waiting", now - 4 * h, "A", "3"), key("waiting", now - h, "B", "4")]
    expect(sortByActivity(items, (i) => i).map((i) => i.title)).toEqual(["B", "A", "New", "Old"])
  })

  test("equal activity falls back to the title, case-insensitively", () => {
    const items = [key("idle", now, "beta", "1"), key("idle", now, "Alpha", "2"), key("idle", now, "gamma", "3")]
    expect(sortByActivity(items, (i) => i).map((i) => i.id)).toEqual(["2", "1", "3"])
    expect(compareActivity(key("idle", now, "Alpha", "1"), key("idle", now, "alpha", "1"))).toBe(0)
  })

  test("equal title falls back to the id", () => {
    const items = [key("idle", now, "Same", "b"), key("idle", now, "same", "a")]
    expect(sortByActivity(items, (i) => i).map((i) => i.id)).toEqual(["a", "b"])
  })

  test("a missing title sorts before a titled one", () => {
    const items = [key("idle", now, "Title", "1"), key("idle", now, undefined, "2")]
    expect(sortByActivity(items, (i) => i).map((i) => i.id)).toEqual(["2", "1"])
  })

  test("complete ties keep the input order", () => {
    const items = [key("idle", now, "Same", "a"), key("idle", now, "Same", "a")]
    expect(sortByActivity(items, (i) => i).map((i) => i.id)).toEqual(["a", "a"])
  })

  test("returns a new array and leaves the input alone", () => {
    const items = [key("idle", now - h, "Old", "1"), key("idle", now, "New", "2")]
    const sorted = sortByActivity(items, (i) => i)
    expect(sorted).not.toBe(items)
    expect(sorted.map((i) => i.id)).toEqual(["2", "1"])
    expect(items.map((i) => i.id)).toEqual(["1", "2"])
  })

  test("an empty list stays empty", () => {
    expect(sortByActivity([], (i: ActivityKey) => i)).toEqual([])
  })
})

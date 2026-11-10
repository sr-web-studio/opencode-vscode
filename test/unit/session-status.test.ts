import { describe, expect, test } from "bun:test"
import { combineStatus, isSeen, isUnread, sessionStatus, statusLabel, unreadCount, type StatusSession } from "@occ/core/session-status"

const idle = 1_000
const seen = { idle, viewed: idle }
const unseen = { idle }

const session = (over: Partial<StatusSession> = {}): StatusSession => ({ id: "s", time: unseen, outcome: "succeeded", ...over })

const sets = (running: string[] = [], waiting: string[] = []) => ({ running: new Set(running), waiting: new Set(waiting) })

describe("seen", () => {
  test("a session with no finished turn has nothing to read", () => {
    expect(isSeen({})).toBe(true)
    expect(isSeen({ viewed: 10 })).toBe(true)
  })

  test("never viewed means the last turn is unseen", () => {
    expect(isSeen({ idle })).toBe(false)
  })

  test("viewed before the last turn ended is unseen; at or after it is seen", () => {
    expect(isSeen({ idle, viewed: idle - 1 })).toBe(false)
    expect(isSeen({ idle, viewed: idle })).toBe(true)
    expect(isSeen({ idle, viewed: idle + 1 })).toBe(true)
  })
})

describe("unread", () => {
  test("a finished turn nobody opened is unread", () => {
    expect(isUnread(session())).toBe(true)
    expect(isUnread(session({ outcome: "interrupted" }))).toBe(true)
  })

  test("a failure is not unread: it has its own icon", () => {
    expect(isUnread(session({ outcome: "failed" }))).toBe(false)
  })

  test("a record without an outcome does not invent an unread state", () => {
    expect(isUnread(session({ outcome: undefined }))).toBe(false)
  })

  test("a seen turn or no finished turn is not unread", () => {
    expect(isUnread(session({ time: seen }))).toBe(false)
    expect(isUnread(session({ time: {} }))).toBe(false)
  })
})

describe("the one status of a session", () => {
  test("waiting outranks everything, then running", () => {
    expect(sessionStatus(session({ outcome: "failed" }), sets([], ["s"]))).toBe("waiting")
    expect(sessionStatus(session({ outcome: "failed" }), sets(["s"]))).toBe("running")
  })

  test("a failed turn the user has not seen is failed; once seen it reads as read", () => {
    expect(sessionStatus(session({ outcome: "failed" }), sets())).toBe("failed")
    expect(sessionStatus(session({ outcome: "failed", time: seen }), sets())).toBe("read")
  })

  test("a failure with no finished turn is not a new failure", () => {
    expect(sessionStatus(session({ outcome: "failed", time: {} }), sets())).toBe("read")
  })

  test("a succeeded or interrupted turn the user has not seen is unread", () => {
    expect(sessionStatus(session(), sets())).toBe("unread")
    expect(sessionStatus(session({ outcome: "interrupted" }), sets())).toBe("unread")
  })

  test("seen, outcome-less and never-finished records are read", () => {
    expect(sessionStatus(session({ time: seen }), sets())).toBe("read")
    expect(sessionStatus(session({ outcome: undefined }), sets())).toBe("read")
    expect(sessionStatus(session({ outcome: undefined, time: {} }), sets())).toBe("read")
  })
})

describe("group aggregation", () => {
  test("a group takes its most urgent status; an empty group reads as read", () => {
    expect(combineStatus([])).toBe("read")
    expect(combineStatus(["read", "unread"])).toBe("unread")
    expect(combineStatus(["unread", "failed"])).toBe("failed")
    expect(combineStatus(["failed", "running"])).toBe("running")
    expect(combineStatus(["running", "waiting"])).toBe("waiting")
  })

  test("only unread sessions are counted; a failure is not a count", () => {
    expect(unreadCount([])).toBe(0)
    expect(unreadCount(["read", "unread", "unread", "failed", "waiting", "running"])).toBe(2)
  })
})

describe("labels", () => {
  test("every icon has its words", () => {
    expect(statusLabel("waiting")).toBe("Needs your answer")
    expect(statusLabel("running")).toBe("Running")
    expect(statusLabel("failed")).toBe("Failed")
    expect(statusLabel("unread")).toBe("New reply")
    expect(statusLabel("read")).toBe("Read")
  })
})

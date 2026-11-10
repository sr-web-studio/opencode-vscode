import { describe, expect, test } from "bun:test"
import { combineStatus, isSeen, isUnread, sessionStatus, statusLabel, unreadCount, UNREAD_WINDOW_MS, type StatusSession } from "@occ/core/session-status"

const idle = 1_000
/** A clock a minute after the turn ended: inside the unread window. */
const now = idle + 60_000
const seen = { idle, viewed: idle }
const unseen = { idle }

const session = (over: Partial<StatusSession> = {}): StatusSession => ({ id: "s", time: unseen, outcome: "succeeded", ...over })

const sets = (running: string[] = [], waiting: string[] = []) => ({ running: new Set(running), waiting: new Set(waiting) })

describe("seen", () => {
  test("a session with no finished turn has nothing to read", () => {
    expect(isSeen({}, now)).toBe(true)
    expect(isSeen({ viewed: 10 }, now)).toBe(true)
  })

  test("never viewed means the last turn is unseen while it is new", () => {
    expect(isSeen({ idle }, now)).toBe(false)
  })

  test("viewed before the last turn ended is unseen; at or after it is seen", () => {
    expect(isSeen({ idle, viewed: idle - 1 }, now)).toBe(false)
    expect(isSeen({ idle, viewed: idle }, now)).toBe(true)
    expect(isSeen({ idle, viewed: idle + 1 }, now)).toBe(true)
  })
})

describe("the 24 hour window for a session no client ever opened", () => {
  test("a turn older than the window counts as seen: an upgrade does not light up the whole history", () => {
    expect(isSeen({ idle }, idle + UNREAD_WINDOW_MS + 1)).toBe(true)
    expect(isUnread(session(), idle + UNREAD_WINDOW_MS + 1)).toBe(false)
  })

  test("a turn inside the window is unseen and unread", () => {
    expect(isSeen({ idle }, idle + UNREAD_WINDOW_MS)).toBe(false)
    expect(isUnread(session(), idle + UNREAD_WINDOW_MS)).toBe(true)
    expect(isUnread(session(), idle + 1)).toBe(true)
  })

  test("a viewed stamp before the turn ended is unread at any age", () => {
    const old = { idle, viewed: idle - 1 }
    expect(isSeen(old, idle + 30 * UNREAD_WINDOW_MS)).toBe(false)
    expect(isUnread(session({ time: old }), idle + 30 * UNREAD_WINDOW_MS)).toBe(true)
  })

  test("a viewed stamp at or after the turn ended is seen at any age", () => {
    expect(isSeen(seen, idle + 30 * UNREAD_WINDOW_MS)).toBe(true)
  })
})

describe("unread", () => {
  test("a finished turn nobody opened is unread", () => {
    expect(isUnread(session(), now)).toBe(true)
    expect(isUnread(session({ outcome: "interrupted" }), now)).toBe(true)
  })

  test("a failure is not unread: it has its own icon", () => {
    expect(isUnread(session({ outcome: "failed" }), now)).toBe(false)
  })

  test("a record without an outcome does not invent an unread state", () => {
    expect(isUnread(session({ outcome: undefined }), now)).toBe(false)
  })

  test("a seen turn or no finished turn is not unread", () => {
    expect(isUnread(session({ time: seen }), now)).toBe(false)
    expect(isUnread(session({ time: {} }), now)).toBe(false)
  })
})

describe("the one status of a session", () => {
  test("waiting outranks everything, then running", () => {
    expect(sessionStatus(session({ outcome: "failed" }), sets([], ["s"]), now)).toBe("waiting")
    expect(sessionStatus(session({ outcome: "failed" }), sets(["s"]), now)).toBe("running")
  })

  test("a failed turn the user has not seen is failed; once seen it reads as read", () => {
    expect(sessionStatus(session({ outcome: "failed" }), sets(), now)).toBe("failed")
    expect(sessionStatus(session({ outcome: "failed", time: seen }), sets(), now)).toBe("read")
  })

  test("an old failure nobody opened is read, like an old reply", () => {
    expect(sessionStatus(session({ outcome: "failed" }), sets(), idle + UNREAD_WINDOW_MS + 1)).toBe("read")
  })

  test("a failure with no finished turn is not a new failure", () => {
    expect(sessionStatus(session({ outcome: "failed", time: {} }), sets(), now)).toBe("read")
  })

  test("a succeeded or interrupted turn the user has not seen is unread", () => {
    expect(sessionStatus(session(), sets(), now)).toBe("unread")
    expect(sessionStatus(session({ outcome: "interrupted" }), sets(), now)).toBe("unread")
  })

  test("seen, outcome-less and never-finished records are read", () => {
    expect(sessionStatus(session({ time: seen }), sets(), now)).toBe("read")
    expect(sessionStatus(session({ outcome: undefined }), sets(), now)).toBe("read")
    expect(sessionStatus(session({ outcome: undefined, time: {} }), sets(), now)).toBe("read")
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

import { describe, expect, test } from "bun:test"
import { flattenGroups, groupName, groupSessions, toRows, upsertSession } from "@occ/core/sessions"
import { relativeTime, formatDuration } from "@occ/core/format"
import type { SessionInfo } from "@occ/core/api"

const now = new Date(2026, 10, 6, 15, 0, 0).getTime()
const h = 3_600_000
const d = 24 * h
const s = (id: string, updated: number, extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({ id, cost: 0, tokens: {} as any, time: { created: updated, updated }, location: { directory: "/p" }, projectID: "p", ...extra }) as SessionInfo

describe("session grouping", () => {
  test("date buckets", () => {
    expect(groupName(now - h, now)).toBe("Today")
    expect(groupName(now - 20 * h, now)).toBe("Yesterday")
    expect(groupName(now - 5 * d, now)).toBe("Last week")
    expect(groupName(now - 30 * d, now)).toBe("Older")
  })

  test("roots only, dots, current, untitled, newest first", () => {
    const rows = toRows({
      sessions: [s("a", now - h, { title: "Alpha" }), s("child", now - h, { parentID: "a" }), s("b", now - 2 * h), s("c", now - 3 * h, { title: "C" })],
      running: new Set(["a", "b"]),
      waiting: new Set(["b"]),
      currentID: "c",
    })
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"])
    expect(rows.map((r) => r.dot)).toEqual(["running", "waiting", "none"])
    expect(rows[1]!.title).toBe("Untitled session")
    expect(rows[2]!.current).toBe(true)
  })

  test("search is case-insensitive and empty groups are dropped", () => {
    const rows = toRows({ sessions: [s("a", now - h, { title: "Fix Login" }), s("b", now - 40 * d, { title: "Docs" })], running: new Set(), waiting: new Set() })
    expect(groupSessions(rows, "", now).map((g) => g.name)).toEqual(["Today", "Older"])
    const hit = groupSessions(rows, "login", now)
    expect(hit).toHaveLength(1)
    expect(flattenGroups(hit)).toEqual(["a"])
  })

  test("archived flag", () => {
    const rows = toRows({ sessions: [s("a", now, { time: { created: 1, updated: now, archived: 5 } })], running: new Set(), waiting: new Set() })
    expect(rows[0]!.archived).toBe(true)
  })

  test("upsert replaces or prepends", () => {
    const list = [s("a", 1), s("b", 2)]
    expect(upsertSession(list, s("b", 9)).map((x) => x.time.updated)).toEqual([1, 9])
    expect(upsertSession(list, s("c", 3))[0]!.id).toBe("c")
  })
})

describe("format", () => {
  test("relative time", () => {
    expect(relativeTime(now - 10_000, now)).toBe("now")
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m")
    expect(relativeTime(now - 3 * h, now)).toBe("3h")
    expect(relativeTime(now - 2 * d, now)).toBe("2d")
    expect(relativeTime(now - 14 * d, now)).toBe("2w")
  })
  test("duration", () => {
    expect(formatDuration(42_000)).toBe("42s")
    expect(formatDuration(65_000)).toBe("1m 05s")
    expect(formatDuration(3_720_000)).toBe("1h 02m")
  })
})

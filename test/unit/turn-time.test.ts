import { describe, expect, test } from "bun:test"
import { compactTime, fullDateTime, startsDay, turnStamp, type TimeEnv } from "../../src/core/turn-time"

// Fixed clock and zone: Friday 6 Nov 2026, 15:30 in Dhaka (UTC+6, no DST). Dhaka midnight is 18:00 UTC.
const dhaka = (y: number, m: number, d: number, h: number, min = 0) => Date.UTC(y, m - 1, d, h - 6, min)
const NOW = dhaka(2026, 11, 6, 15, 30)
const env: TimeEnv = { now: NOW, locale: "en-US", timeZone: "Asia/Dhaka" }

describe("compactTime", () => {
  test("today: time only", () => {
    expect(compactTime(dhaka(2026, 11, 6, 14, 41), env)).toBe("2:41 PM")
    expect(compactTime(dhaka(2026, 11, 6, 0, 5), env)).toBe("12:05 AM")
  })
  test("yesterday, judged by calendar day, not by 24 hours", () => {
    expect(compactTime(dhaka(2026, 11, 5, 14, 41), env)).toBe("Yesterday 2:41 PM")
    // 1h ago but across midnight: still yesterday.
    expect(compactTime(dhaka(2026, 11, 5, 23, 59), { ...env, now: dhaka(2026, 11, 6, 0, 30) })).toBe("Yesterday 11:59 PM")
    // 30h ago on a different calendar day than yesterday would be: two days back.
    expect(compactTime(dhaka(2026, 11, 4, 9, 0), env)).toBe("Nov 4, 9:00 AM")
  })
  test("this year: month and day", () => {
    expect(compactTime(dhaka(2026, 11, 3, 14, 41), env)).toBe("Nov 3, 2:41 PM")
    expect(compactTime(dhaka(2026, 1, 2, 8, 0), env)).toBe("Jan 2, 8:00 AM")
  })
  test("older: with the year", () => {
    expect(compactTime(dhaka(2025, 11, 3, 14, 41), env)).toBe("Nov 3 2025, 2:41 PM")
    expect(compactTime(dhaka(2025, 12, 31, 23, 59), env)).toBe("Dec 31 2025, 11:59 PM")
  })
  test("the zone decides the day: the same instant is yesterday in one zone and today in another", () => {
    const at = Date.UTC(2026, 10, 5, 20, 0) // 5 Nov 20:00 UTC = 6 Nov 02:00 Dhaka = 5 Nov 12:00 Los Angeles
    expect(compactTime(at, env)).toBe("2:00 AM")
    expect(compactTime(at, { ...env, timeZone: "America/Los_Angeles" })).toBe("Yesterday 12:00 PM")
  })
  test("a year boundary: Jan 1 looking back at Dec 31 is yesterday, not 'older'", () => {
    const now = dhaka(2027, 1, 1, 10, 0)
    expect(compactTime(dhaka(2026, 12, 31, 22, 0), { ...env, now })).toBe("Yesterday 10:00 PM")
  })
  test("a moment slightly in the future (clock skew) is shown as today", () => {
    expect(compactTime(NOW + 60_000, env)).toBe("3:31 PM")
  })
  test("the locale decides the clock style", () => {
    expect(compactTime(dhaka(2026, 11, 6, 14, 41), { ...env, locale: "de-DE" })).toBe("14:41")
    expect(compactTime(dhaka(2026, 11, 3, 14, 41), { ...env, locale: "en-GB" })).toMatch(/^3 Nov,? 14:41$/)
  })
  test("DST: the day before a spring-forward day is yesterday even though that day was 23 hours long", () => {
    const la = { now: Date.UTC(2026, 2, 8, 20, 0), locale: "en-US", timeZone: "America/Los_Angeles" } // 8 Mar 2026 13:00 PDT
    expect(compactTime(Date.UTC(2026, 2, 7, 20, 0), la)).toBe("Yesterday 12:00 PM")
  })
})

describe("turnStamp", () => {
  test("time and duration after a finished turn", () => {
    const ended = dhaka(2026, 11, 6, 14, 41)
    const s = turnStamp({ started: ended - 42_000, ended, outcome: "succeeded" }, env)!
    expect(s.text).toBe("2:41 PM · 42s")
  })
  test("minutes in the duration", () => {
    const ended = dhaka(2026, 11, 5, 14, 41)
    expect(turnStamp({ started: ended - 125_000, ended, outcome: "failed" }, env)!.text).toBe("Yesterday 2:41 PM · 2m 05s")
  })
  test("a running turn shows nothing yet", () => {
    expect(turnStamp({ started: NOW - 5000 }, env)).toBeUndefined()
    expect(turnStamp({ started: NOW - 5000, ended: NOW, outcome: undefined }, env)).toBeUndefined()
  })
  test("unknown start or an end before the start leaves only the time", () => {
    const ended = dhaka(2026, 11, 6, 14, 41)
    expect(turnStamp({ ended, outcome: "succeeded" }, env)!.text).toBe("2:41 PM")
    expect(turnStamp({ started: ended + 1000, ended, outcome: "succeeded" }, env)!.text).toBe("2:41 PM")
  })
  test("the hover title is the full date and time", () => {
    const ended = dhaka(2026, 11, 6, 14, 41)
    const s = turnStamp({ started: ended - 1000, ended, outcome: "succeeded" }, env)!
    expect(s.title).toBe(fullDateTime(ended, env))
    expect(s.title).toContain("Friday, November 6, 2026")
    expect(s.title).toContain("2:41:00 PM")
  })
})

describe("startsDay", () => {
  const z = "Asia/Dhaka"
  const at = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h - 6, m)
  test("the first prompt shown starts its day", () => {
    expect(startsDay(undefined, at(6, 9), z)).toBe(true)
  })
  test("same calendar day in the user's zone is not a new day", () => {
    expect(startsDay(at(6, 9), at(6, 23, 59), z)).toBe(false)
  })
  test("after midnight in the zone is a new day, even when UTC is the same date", () => {
    expect(startsDay(at(6, 23, 50), at(7, 0, 10), z)).toBe(true)
  })
  test("another month or year", () => {
    expect(startsDay(Date.UTC(2026, 9, 6, 6), at(6, 9), z)).toBe(true)
    expect(startsDay(Date.UTC(2025, 10, 6, 6), at(6, 9), z)).toBe(true)
  })
  test("a prompt without a time never claims a day", () => {
    expect(startsDay(at(6, 9), undefined, z)).toBe(false)
    expect(startsDay(at(6, 9), NaN, z)).toBe(false)
  })
})

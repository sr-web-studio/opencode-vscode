import { describe, expect, test } from "bun:test"
import { DEFAULT_NOTIFY, NOTIFY_KINDS, NOTIFY_VERSION, NO_STATUS, ago, nativeServers, parseNotifySettings, parseStatus, statusLine, visibleSessionOf } from "../../apps/mobile/src/lib/notify"
import { parseDeepLink, routeDeepLink } from "../../apps/mobile/src/lib/deep-link"
import type { Profile } from "../../apps/mobile/src/lib/profiles"

const profile = (over: Partial<Profile> = {}): Profile => ({ id: "srv-1", name: "Home server", url: "http://192.168.1.10:4096", password: "pw", serverId: "my-server", ...over })

describe("notify settings", () => {
  test("everything is on by default except worker notifications", () => {
    expect(parseNotifySettings(undefined)).toEqual(DEFAULT_NOTIFY)
    expect(DEFAULT_NOTIFY.workers).toBe(false)
    expect(
      Object.entries(DEFAULT_NOTIFY)
        .filter(([k]) => k !== "workers")
        .every(([, v]) => v === true),
    ).toBe(true)
  })

  test("the worker switch says it is off by default", () => {
    expect(NOTIFY_KINDS.find((k) => k.key === "workers")?.detail).toBe("Also notify when a worker (child session) finishes or fails. Off by default.")
  })

  test("a v1 file's saved worker default reads as off, once", () => {
    const v1 = parseNotifySettings({ enabled: false, workers: true, finished: false })
    expect(v1.workers).toBe(false)
    expect(v1.enabled).toBe(false)
    expect(v1.finished).toBe(false)
    expect(v1.permission).toBe(true)
  })

  test("a v2 file keeps the worker switch the owner turned back on", () => {
    expect(parseNotifySettings({ version: NOTIFY_VERSION, workers: true }).workers).toBe(true)
    expect(parseNotifySettings({ version: NOTIFY_VERSION, workers: false }).workers).toBe(false)
    expect(parseNotifySettings({ version: NOTIFY_VERSION }).workers).toBe(false)
  })

  test("keeps saved booleans and ignores junk", () => {
    const s = parseNotifySettings({ version: NOTIFY_VERSION, enabled: false, workers: false, finished: "no", extra: 1 })
    expect(s.enabled).toBe(false)
    expect(s.workers).toBe(false)
    expect(s.finished).toBe(true)
    expect(s.permission).toBe(true)
  })
})

describe("native hand-over", () => {
  test("passes id, name, address, password and server id only", () => {
    const out = nativeServers([profile({ hostname: "box.local" })])
    expect(out).toEqual([{ id: "srv-1", name: "Home server", url: "http://192.168.1.10:4096", password: "pw", serverId: "my-server" }])
  })
})

describe("status", () => {
  test("parses the plugin answer defensively", () => {
    const s = parseStatus({
      running: true,
      connected: 1,
      servers: 2,
      lastEventAt: 5,
      notificationsAllowed: false,
      batteryUnrestricted: true,
      watching: [{ id: "a", name: "A", connected: true }, { nope: 1 }],
    })
    expect(s).toEqual({ running: true, connected: 1, servers: 2, lastEventAt: 5, notificationsAllowed: false, batteryUnrestricted: true, watching: [{ id: "a", name: "A", connected: true }] })
    expect(parseStatus(null)).toEqual(NO_STATUS)
  })

  test("status line says what is going on", () => {
    const on = DEFAULT_NOTIFY
    expect(statusLine({ ...on, enabled: false }, NO_STATUS, 1)).toBe("Background notifications are off.")
    expect(statusLine(on, NO_STATUS, 0)).toContain("Add a server")
    expect(statusLine(on, { ...NO_STATUS, notificationsAllowed: false }, 1)).toContain("blocking")
    expect(statusLine(on, { ...NO_STATUS, running: true, servers: 2, connected: 2 }, 2)).toBe("Watching 2 servers. All connected.")
    expect(statusLine(on, { ...NO_STATUS, running: true, servers: 2, connected: 1 }, 2)).toContain("1 connected, 1 trying to reconnect")
    expect(statusLine(on, { ...NO_STATUS, running: true, servers: 1, connected: 1 }, 1)).toBe("Watching 1 server. All connected.")
  })

  test("ago", () => {
    const now = 1_000_000_000
    expect(ago(0, now)).toBe("none yet")
    expect(ago(now - 3000, now)).toBe("just now")
    expect(ago(now - 30_000, now)).toBe("30 seconds ago")
    expect(ago(now - 60_000, now)).toBe("1 minute ago")
    expect(ago(now - 5 * 60_000, now)).toBe("5 minutes ago")
    expect(ago(now - 3 * 3600_000, now)).toBe("3 hours ago")
  })
})

describe("session on screen", () => {
  test("a chat shows the session its controller has, else the one it was opened with", () => {
    expect(visibleSessionOf({ kind: "chat", directory: "/p", sessionID: "ses_a" }, { "/p": "ses_b" })).toBe("ses_b")
    expect(visibleSessionOf({ kind: "chat", directory: "/p", sessionID: "ses_a" }, {})).toBe("ses_a")
    expect(visibleSessionOf({ kind: "chat", directory: "/p" }, { "/p": undefined })).toBeUndefined()
  })

  test("a worker screen shows the worker; other screens show nothing", () => {
    expect(visibleSessionOf({ kind: "worker", directory: "/p", sessionID: "ses_w" }, { "/p": "ses_root" })).toBe("ses_w")
    expect(visibleSessionOf({ kind: "sessions", directory: "/p" }, { "/p": "ses_root" })).toBeUndefined()
    expect(visibleSessionOf({ kind: "servers" }, {})).toBeUndefined()
    expect(visibleSessionOf(undefined, {})).toBeUndefined()
  })
})

describe("notification tap link (what the service puts in the PendingIntent)", () => {
  test("opens the exact session of the exact server", () => {
    const link = parseDeepLink("opencode-mobile://session/ses_e4656bc8effeSAD316NuA1L1Cj?server=my-server")
    expect(link).toEqual({ sessionID: "ses_e4656bc8effeSAD316NuA1L1Cj", serverId: "my-server" })
    const a = profile()
    const b = profile({ id: "srv-2", serverId: "laptop" })
    expect(routeDeepLink(link!, [b, a], "srv-2")).toEqual({ kind: "open", profile: a })
  })
})

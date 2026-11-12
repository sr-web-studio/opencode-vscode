import { describe, expect, test } from "bun:test"
import { settleWithin, startIntent, START_TIMEOUT_MS, chatVisible, CHAT_OPEN_TIMEOUT_MS } from "../../apps/mobile/src/lib/start"
import type { Profile } from "../../apps/mobile/src/lib/profiles"

const profile = (id: string): Profile => ({ id, name: id, url: `http://${id}:4096`, password: "x", serverId: id })

describe("what a cold start opens", () => {
  const a = profile("a")
  const b = profile("b")

  test("the launch link wins over the last server", () => {
    const link = "opencode-mobile://session/ses_1?server=a"
    expect(startIntent(link, [a, b], "b")).toEqual({ kind: "link", raw: link })
  })

  test("a link for a server this phone does not have is still routed, so the router can explain it", () => {
    const link = "opencode-mobile://session/ses_1?server=other"
    expect(startIntent(link, [], undefined)).toEqual({ kind: "link", raw: link })
  })

  test("the last server opens when the launch link is not one of ours", () => {
    for (const launch of [undefined, "", "https://example.com/x", "opencode-mobile://project/ses_1"]) {
      expect(startIntent(launch, [a, b], "b")).toEqual({ kind: "reconnect", profile: b })
    }
  })

  test("a phone with no saved server, or whose last server is gone, shows the list", () => {
    expect(startIntent(undefined, [], undefined)).toEqual({ kind: "servers" })
    expect(startIntent(undefined, [a], "gone")).toEqual({ kind: "servers" })
  })
})

describe("the neutral start screen", () => {
  test("goes as soon as the start work is done", async () => {
    const started = Date.now()
    await settleWithin(Promise.resolve(), 5000)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test("does not stay forever when the start work hangs", async () => {
    const started = Date.now()
    await settleWithin(new Promise(() => {}), 25)
    expect(Date.now() - started).toBeGreaterThanOrEqual(20)
  })

  test("also goes when the start work fails", async () => {
    await expect(settleWithin(Promise.reject(new Error("no server")), 5000)).resolves.toBeUndefined()
  })

  test("waits long enough for a normal connection", () => {
    expect(START_TIMEOUT_MS).toBeGreaterThanOrEqual(5000)
  })
})

describe("the chat screen's wait for its session", () => {
  test("a draft screen, or one that asks for the newest session, never waits", () => {
    expect(chatVisible({ arrived: false, expired: false })).toBe(true)
    expect(chatVisible({ sessionID: "", arrived: false, expired: false })).toBe(true)
  })

  test("a screen opened with a session id waits until the controller is on it", () => {
    expect(chatVisible({ sessionID: "ses_1", arrived: false, expired: false })).toBe(false)
    expect(chatVisible({ sessionID: "ses_1", arrived: true, expired: false })).toBe(true)
  })

  test("once the session was shown, the owner may move the same chat away from it", () => {
    // The screen, as ChatScreen runs it: a session opened from the drawer, then the chat's own `+` dispatches
    // `newDraft`, so the controller's target becomes a draft while the screen still carries the id it was opened with.
    // The old rule ("the target must still be that id") answered false here and pinned the screen on "Loading…".
    let arrived = false
    const gate = (target: string | undefined): boolean => {
      if (target === "ses_1") arrived = true
      return chatVisible({ sessionID: "ses_1", arrived, expired: false })
    }
    expect(gate(undefined)).toBe(false)
    expect(gate("ses_1")).toBe(true)
    expect(gate(undefined)).toBe(true)
    // The same holds for a new session id after `/fork` or the first prompt of a draft.
    expect(gate("ses_2")).toBe(true)
  })

  test("the wait ends even when the session never arrives, so the screen cannot spin for good", () => {
    expect(chatVisible({ sessionID: "ses_gone", arrived: false, expired: true })).toBe(true)
    expect(CHAT_OPEN_TIMEOUT_MS).toBeGreaterThanOrEqual(5000)
  })
})

import { describe, expect, test } from "bun:test"
import { routeDeepLink, parseDeepLink } from "../../apps/mobile/src/lib/deep-link"
import { LinkGate } from "../../apps/mobile/src/lib/link-gate"
import type { Profile } from "../../apps/mobile/src/lib/profiles"

const LINK = "opencode-mobile://session/ses_abc?server=box"
const box: Profile = { id: "p1", name: "Box", url: "http://box:4096", password: "x", serverId: "box" }

/** The model's start-up with fakes: `appUrlOpen` and `getLaunchUrl` deliver the launch link, profiles load later. */
function harness(saved: Profile[], opts: { now?: () => number } = {}) {
  const opened: string[] = []
  const toasts: string[] = []
  let profiles: Profile[] = []
  let loaded!: () => void
  const ready = new Promise<void>((r) => (loaded = r))
  const gate = new LinkGate({
    ready,
    now: opts.now,
    handle: async (raw) => {
      const link = parseDeepLink(raw)!
      const route = routeDeepLink(link, profiles)
      if (route.kind !== "open") {
        toasts.push(route.kind)
        return false
      }
      await Promise.resolve() // connect + session lookup
      opened.push(link.sessionID)
      return true
    },
  })
  return {
    gate,
    opened,
    toasts,
    loadProfiles: () => {
      profiles = saved
      loaded()
    },
  }
}

describe("LinkGate: deep links on a cold start", () => {
  test("cold: the listener fires before the profiles are loaded; the session opens once", async () => {
    const h = harness([box])
    const early = h.gate.open(LINK) // appUrlOpen, first
    await Promise.resolve()
    expect(h.opened).toEqual([]) // nothing routed yet
    expect(h.toasts).toEqual([])
    h.loadProfiles()
    const launch = h.gate.open(LINK) // init(): getLaunchUrl, same link
    await Promise.all([early, launch])
    expect(h.opened).toEqual(["ses_abc"])
    expect(h.toasts).toEqual([])
  })

  test("warm: one link, one open", async () => {
    const h = harness([box])
    h.loadProfiles()
    await h.gate.open(LINK)
    expect(h.opened).toEqual(["ses_abc"])
  })

  test("a duplicate within 2.5 s is dropped, later the same link opens again", async () => {
    let t = 1000
    const h = harness([box], { now: () => t })
    h.loadProfiles()
    await h.gate.open(LINK)
    t += 2000
    await h.gate.open(LINK)
    expect(h.opened).toEqual(["ses_abc"])
    t += 600
    await h.gate.open(LINK)
    expect(h.opened).toEqual(["ses_abc", "ses_abc"])
  })

  test("no saved servers for real: the toast route, and the link is not remembered", async () => {
    const h = harness([])
    h.loadProfiles()
    await h.gate.open(LINK)
    await h.gate.open(LINK) // not swallowed by the dedupe: it is routed (and refused) again
    expect(h.toasts).toEqual(["no-servers", "no-servers"])
    expect(h.opened).toEqual([])
  })

  test("a link that failed to route does not block the retry", async () => {
    const h = harness([box])
    let fail = true
    const gate = new LinkGate({
      ready: Promise.resolve(),
      handle: async (raw) => {
        if (fail) return false
        h.opened.push(parseDeepLink(raw)!.sessionID)
        return true
      },
    })
    await gate.open(LINK)
    fail = false
    await gate.open(LINK)
    expect(h.opened).toEqual(["ses_abc"])
  })

  test("a different session is never treated as a duplicate", async () => {
    const h = harness([box])
    h.loadProfiles()
    await h.gate.open(LINK)
    await h.gate.open("opencode-mobile://session/ses_other?server=box")
    expect(h.opened).toEqual(["ses_abc", "ses_other"])
  })

  test("something that is not a deep link is ignored without waiting", async () => {
    const h = harness([box]) // never loaded
    await h.gate.open("https://example.com")
    expect(h.opened).toEqual([])
    expect(h.toasts).toEqual([])
  })
})

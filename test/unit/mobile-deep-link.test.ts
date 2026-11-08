import { describe, expect, test } from "bun:test"
import { parseDeepLink, routeDeepLink } from "../../apps/mobile/src/lib/deep-link"
import type { Profile } from "../../apps/mobile/src/lib/profiles"

const profile = (id: string, serverId: string, extra: Partial<Profile> = {}): Profile => ({ id, name: id, url: `http://${serverId}:4096`, password: "x", serverId, ...extra })

describe("parseDeepLink: opencode-mobile://session/<sessionID>?server=<serverId>", () => {
  test("session and server", () => {
    expect(parseDeepLink("opencode-mobile://session/ses_abc123?server=srws-server-office")).toEqual({ sessionID: "ses_abc123", serverId: "srws-server-office" })
  })
  test("the push plugin's default template (URL-encoded placeholders)", () => {
    expect(parseDeepLink(`opencode-mobile://session/${encodeURIComponent("ses_1")}?server=${encodeURIComponent("my box")}`)).toEqual({ sessionID: "ses_1", serverId: "my box" })
  })
  test("server is optional; other query parameters and a hash are ignored", () => {
    expect(parseDeepLink("opencode-mobile://session/ses_1")).toEqual({ sessionID: "ses_1", serverId: undefined })
    expect(parseDeepLink("opencode-mobile://session/ses_1/?foo=1&server=a#x")).toEqual({ sessionID: "ses_1", serverId: "a" })
    expect(parseDeepLink("opencode-mobile://session/ses_1?server=")).toEqual({ sessionID: "ses_1", serverId: undefined })
  })
  test("anything else is undefined", () => {
    for (const raw of [undefined, null, "", "https://x/session/ses_1", "opencode-mobile://project/ses_1", "opencode-mobile://session/", "opencode-mobile://session/a b", "opencode-mobile://session/../etc", "opencode-mobile://session/%E0%A4%A"]) {
      expect(parseDeepLink(raw)).toBeUndefined()
    }
  })
})

describe("routeDeepLink: which saved server a link means", () => {
  const a = profile("p1", "srws-server-office")
  const b = profile("p2", "laptop")
  test("matches by server id, ignoring case", () => {
    expect(routeDeepLink({ sessionID: "s", serverId: "LAPTOP" }, [a, b])).toEqual({ kind: "open", profile: b })
  })
  test("falls back to the host name the server reported", () => {
    const c = profile("p3", "10.0.0.10", { hostname: "srws-server-office" })
    expect(routeDeepLink({ sessionID: "s", serverId: "srws-server-office" }, [b, c])).toEqual({ kind: "open", profile: c })
  })
  test("a server id that is not saved is reported, never guessed", () => {
    expect(routeDeepLink({ sessionID: "s", serverId: "other" }, [a, b])).toEqual({ kind: "unknown-server", serverId: "other" })
  })
  test("no server id: the only profile, else the last used one, else ask", () => {
    expect(routeDeepLink({ sessionID: "s" }, [a])).toEqual({ kind: "open", profile: a })
    expect(routeDeepLink({ sessionID: "s" }, [a, b], "p2")).toEqual({ kind: "open", profile: b })
    expect(routeDeepLink({ sessionID: "s" }, [a, b])).toEqual({ kind: "ambiguous" })
    expect(routeDeepLink({ sessionID: "s" }, [a, b], "gone")).toEqual({ kind: "ambiguous" })
  })
  test("no saved servers", () => {
    expect(routeDeepLink({ sessionID: "s", serverId: "x" }, [])).toEqual({ kind: "no-servers" })
  })
})

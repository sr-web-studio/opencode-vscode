/**
 * Deep links of the push notifications: `opencode-mobile://session/<sessionID>?server=<serverId>`
 * (see plugins/opencode-push). Pure: parsing, and the choice of the saved server that the link points to.
 */
import type { Profile } from "./profiles"

export type DeepLink = { sessionID: string; serverId?: string }

export const DEEP_LINK_SCHEME = "opencode-mobile"

const LINK = /^opencode-mobile:\/\/session\/([^/?#]+)\/?(?:\?([^#]*))?(?:#.*)?$/i
const ID = /^[A-Za-z0-9_-]{1,120}$/

/** The session and (optional) server a deep link names. Undefined for anything else. */
export function parseDeepLink(raw: string | undefined | null): DeepLink | undefined {
  const m = LINK.exec((raw ?? "").trim())
  if (!m) return undefined
  let sessionID: string
  try {
    sessionID = decodeURIComponent(m[1]!)
  } catch {
    return undefined
  }
  if (!ID.test(sessionID)) return undefined
  const server = new URLSearchParams(m[2] ?? "").get("server")?.trim()
  return { sessionID, serverId: server || undefined }
}

export type DeepLinkRoute =
  | { kind: "open"; profile: Profile }
  /** The link names a server that is not saved here. */
  | { kind: "unknown-server"; serverId: string }
  /** No server in the link and more than one saved: the user has to say which. */
  | { kind: "ambiguous" }
  | { kind: "no-servers" }

const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/**
 * Pick the saved server. `serverId` matches a profile's server id, or the host name the server itself reported when we
 * last connected (the push plugin's default server id is the server machine's host name). Without a `server`
 * parameter a single saved server, or else the one used last, is taken.
 */
export function routeDeepLink(link: DeepLink, profiles: ReadonlyArray<Profile>, activeID?: string): DeepLinkRoute {
  if (profiles.length === 0) return { kind: "no-servers" }
  if (link.serverId) {
    const hit = profiles.find((p) => same(p.serverId, link.serverId)) ?? profiles.find((p) => same(p.hostname, link.serverId))
    return hit ? { kind: "open", profile: hit } : { kind: "unknown-server", serverId: link.serverId }
  }
  if (profiles.length === 1) return { kind: "open", profile: profiles[0]! }
  const active = profiles.find((p) => p.id === activeID)
  return active ? { kind: "open", profile: active } : { kind: "ambiguous" }
}

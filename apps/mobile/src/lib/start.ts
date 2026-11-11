/**
 * What a cold start opens before the first screen: the session of a notification's link, the chat of the last server, or
 * the saved-server list.
 *
 * The screen stack starts on the saved-server list, which is also the bottom of the back stack. That list must not be
 * drawn while the launch link or the reconnect is still resolving (it would flash the list, and the server's address,
 * before the chat), so the app keeps its neutral start screen until the start work is done or `settleWithin` gives up.
 */
import { parseDeepLink } from "./deep-link"
import type { Profile } from "./profiles"

export type StartIntent =
  /** The link that launched the app; the router explains a link that names no saved server. */
  | { kind: "link"; raw: string }
  /** The server used last: its remembered chat, or its drawer when nothing was remembered. */
  | { kind: "reconnect"; profile: Profile }
  /** Nothing to open (no saved server, or the last one was removed): the saved-server list. */
  | { kind: "servers" }

/**
 * A launch link wins over the last server, even when it is for a server this phone does not have, so the router can say
 * what is wrong. Without a link the server used last opens, and a phone with no server goes straight to the list.
 */
export function startIntent(launch: string | undefined, profiles: ReadonlyArray<Profile>, activeID?: string): StartIntent {
  if (launch && parseDeepLink(launch)) return { kind: "link", raw: launch }
  const last = profiles.find((p) => p.id === activeID)
  return last ? { kind: "reconnect", profile: last } : { kind: "servers" }
}

/** The neutral start screen never stays longer than this: a connection that hangs must still end on the server list. */
export const START_TIMEOUT_MS = 8000

/**
 * Resolve when the start work is done, or after `ms` when it hangs. The work itself keeps running: when it finishes it
 * still puts its chat on the stack, so the server list shown at the timeout is only the fallback.
 */
export function settleWithin(work: Promise<unknown>, ms = START_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    const done = (): void => {
      clearTimeout(timer)
      resolve()
    }
    work.then(done, done)
  })
}

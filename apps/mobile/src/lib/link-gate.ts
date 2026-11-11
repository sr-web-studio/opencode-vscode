/**
 * Admission of deep links (notification taps, `opencode-mobile://session/...`), in front of the router.
 *
 * Two rules, both found on a cold start (the app was not running when the notification was tapped):
 * 1. A link waits until the app is ready (saved servers loaded). Capacitor delivers `appUrlOpen` with the launch link
 *    before the profiles are read, so routing at once would see "no servers".
 * 2. A link only counts as handled once it was routed. The same launch link also arrives through `getLaunchUrl()`;
 *    that second delivery is dropped only when the first one really opened something (within `dedupeMs`). While the
 *    first delivery is still routing, the second one waits for it: the start screen must stay up until the session is
 *    on the stack, not until the duplicate is merely recognised.
 */
import { parseDeepLink } from "./deep-link"

export type LinkGateDeps = {
  /** Resolves when the saved servers are loaded. */
  ready: Promise<unknown>
  /** Route the link. True when it was routed (a session opened), false when it could not be (no server, not saved, failed). */
  handle: (raw: string) => Promise<boolean>
  now?: () => number
  dedupeMs?: number
}

export class LinkGate {
  private last = { url: "", at: 0 }
  /** The route that is running now; a duplicate delivery waits for it instead of returning early. */
  private pending: Promise<void> | undefined

  constructor(private readonly deps: LinkGateDeps) {}

  async open(raw: string): Promise<void> {
    if (!parseDeepLink(raw)) return
    await this.deps.ready
    const now = (this.deps.now ?? Date.now)()
    if (this.last.url === raw && now - this.last.at < (this.deps.dedupeMs ?? 2500)) {
      // A duplicate only waits; the delivery that started the route reports its own failure.
      await this.pending?.catch(() => {})
      return
    }
    // Recorded before the (slow) routing, so a duplicate that arrives meanwhile is dropped; undone if nothing opened.
    const previous = this.last
    const mine = { url: raw, at: now }
    this.last = mine
    const route = (async () => {
      let routed = false
      try {
        routed = await this.deps.handle(raw)
      } finally {
        if (!routed && this.last === mine) this.last = previous
      }
    })()
    this.pending = route
    try {
      await route
    } finally {
      if (this.pending === route) this.pending = undefined
    }
  }
}

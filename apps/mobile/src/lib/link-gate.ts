/**
 * Admission of deep links (notification taps, `opencode-mobile://session/...`), in front of the router.
 *
 * Two rules, both found on a cold start (the app was not running when the notification was tapped):
 * 1. A link waits until the app is ready (saved servers loaded). Capacitor delivers `appUrlOpen` with the launch link
 *    before the profiles are read, so routing at once would see "no servers".
 * 2. A link only counts as handled once it was routed. The same launch link also arrives through `getLaunchUrl()`;
 *    that second delivery is dropped only when the first one really opened something (within `dedupeMs`).
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

  constructor(private readonly deps: LinkGateDeps) {}

  async open(raw: string): Promise<void> {
    if (!parseDeepLink(raw)) return
    await this.deps.ready
    const now = (this.deps.now ?? Date.now)()
    if (this.last.url === raw && now - this.last.at < (this.deps.dedupeMs ?? 2500)) return
    // Recorded before the (slow) routing, so a duplicate that arrives meanwhile is dropped; undone if nothing opened.
    const previous = this.last
    const mine = { url: raw, at: now }
    this.last = mine
    let routed = false
    try {
      routed = await this.deps.handle(raw)
    } finally {
      if (!routed && this.last === mine) this.last = previous
    }
  }
}

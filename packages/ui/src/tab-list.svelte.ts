import { closeTab, openTab, parseTabs, pruneTabs, rememberTabs, type SessionTab, type TabProof, type TabSession } from "@occ/core/session-tabs"
import type { BridgeStorage } from "./bridge"

/** The storage key of the open tabs in the host's own store (VS Code: the webview state, so one list per window). */
export const TABS_KEY = "sessionTabs"

/** Title and activity updates are written at most this often; opening and closing a tab are written at once. */
const REMEMBER_MS = 2000

/**
 * The open session tabs, persisted in a host store. The rules live in `@occ/core/session-tabs`; this class only holds
 * the reactive list and writes it back. One instance per window in VS Code; the phone shares one per server profile
 * between its chat screens, so every screen shows the same strip.
 */
export class TabList {
  tabs = $state.raw<SessionTab[]>([])
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly storage: BridgeStorage,
    private readonly key: string = TABS_KEY,
  ) {
    this.tabs = parseTabs(storage.get(key))
  }

  open(tab: SessionTab): void {
    this.set(openTab(this.tabs, tab), true)
  }

  close(id: string): void {
    this.set(closeTab(this.tabs, id), true)
  }

  prune(proofs: readonly TabProof[], keep: ReadonlySet<string>): void {
    this.set(pruneTabs(this.tabs, proofs, keep), true)
  }

  /** Keep the newest titles and activity times, so a restored strip reads right before the lists arrive. */
  remember(known: (id: string) => Pick<TabSession, "title" | "last"> | undefined): void {
    this.set(rememberTabs(this.tabs, known), false)
  }

  /** Write anything still pending (the view is going away). */
  flush(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = undefined
    this.write()
  }

  private set(next: SessionTab[], now: boolean): void {
    if (next === this.tabs) return
    this.tabs = next
    if (now) {
      if (this.timer) clearTimeout(this.timer)
      this.timer = undefined
      this.write()
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.write()
      }, REMEMBER_MS)
    }
  }

  private write(): void {
    this.storage.set(this.key, this.tabs)
  }
}

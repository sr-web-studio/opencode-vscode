import type { SessionTab } from "@occ/core/session-tabs"
import { TabListCore, TABS_KEY, type TabStorage } from "@occ/core/tab-list"

export { TABS_KEY }

/**
 * The open session tabs as reactive state, persisted in a host store. The list and its write rules are
 * `TabListCore` (`@occ/core/tab-list`); this only makes the list a rune so the strip redraws. One instance per window
 * in VS Code; the phone shares one per server profile between its chat screens, so every screen shows the same strip.
 */
export class TabList extends TabListCore {
  constructor(storage: TabStorage, key: string = TABS_KEY) {
    let tabs = $state.raw<SessionTab[]>([])
    super(storage, key, { get: () => tabs, set: (next) => void (tabs = next) })
  }
}

import { ChatTabCatalog, type SessionTab, type TabCatalog, type TabLookup } from "@occ/core/session-tabs"
import type { Store } from "./store.svelte"
import { TabList } from "./tab-list.svelte"
import type { TabsHost } from "./tabs-host"

/**
 * The tab strip's host inside the chat (VS Code): the tabs are kept in the webview's own state, so one list per
 * window; the dropdown lists the sessions pane's rows in the pane's order; a tab opens through the pane's path, which
 * switches to the tab's folder first; the strip's first button toggles the pane; and `lookup` (the extension's
 * `session.get`, when the host offers it) is how a tab of a deleted session is confirmed gone.
 */
export function chatTabsHost(store: Store, pane: { available(): boolean; open(): boolean; toggle(): void }, lookup?: (sessionID: string) => Promise<TabLookup>): TabsHost {
  const list = new TabList(store.bridge.storage)
  const catalogs = new ChatTabCatalog()
  const empty: TabCatalog = { sessions: [], listed: new Set(), loading: true }
  return {
    list,
    catalog(now): TabCatalog {
      const state = store.state
      return state ? catalogs.build(state, store.folderSessions, now) : empty
    },
    ...(lookup ? { lookup: (tab: SessionTab) => lookup(tab.id) } : {}),
    open(id, directory) {
      if (store.bridge.openSessionInFolder) store.bridge.openSessionInFolder(id, directory)
      else store.dispatch({ type: "openSession", id })
    },
    get sessions() {
      if (!pane.available()) return undefined
      return { label: "Sessions (OpenCode: Toggle Sessions)", pressed: () => pane.open(), toggle: () => pane.toggle() }
    },
  }
}

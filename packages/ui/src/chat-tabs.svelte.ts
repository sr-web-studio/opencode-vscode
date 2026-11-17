import { PaneMemo } from "@occ/core/sessions-pane"
import { folderProof, paneCatalog, type TabCatalog } from "@occ/core/session-tabs"
import type { Store } from "./store.svelte"
import { TabList } from "./tab-list.svelte"
import type { TabsHost } from "./tabs-host"

/** The status icons only need minute precision; a coarser clock lets the pane's memo skip identical rebuilds. */
const minute = (): number => Math.floor(Date.now() / 60_000) * 60_000

/**
 * The tab strip's host inside the chat (VS Code): the tabs are kept in the webview's own state, so one list per
 * window; the dropdown lists the sessions pane's rows in the pane's order; a tab opens through the pane's path, which
 * switches to the tab's folder first; and the strip's first button toggles the pane.
 */
export function chatTabsHost(store: Store, pane: { available(): boolean; open(): boolean; toggle(): void }): TabsHost {
  const list = new TabList(store.bridge.storage)
  const memo = new PaneMemo()
  // A streamed answer patches the state many times a second without touching any list: hand back the same catalog
  // then, so the strip does not re-measure for nothing.
  let cache: { key: unknown[]; catalog: TabCatalog } | undefined
  const empty: TabCatalog = { sessions: [], proofs: [], loading: true }
  return {
    list,
    catalog(): TabCatalog {
      const state = store.state
      if (!state) return empty
      const { folders, layout } = memo.build(state, store.folderSessions, minute())
      const key = [layout, state.directory, state.projectName, state.folderName, state.sessions, state.archived, state.sessionsLoaded]
      if (cache && cache.key.every((value, i) => value === key[i])) return cache.catalog
      const catalog: TabCatalog = {
        sessions: paneCatalog(layout, state.projectName?.trim() || state.folderName),
        // Only the chat's own folder proves a tab gone: the other folders' light lists leave archived sessions out.
        proofs: [folderProof(state)],
        loading: !folders.every((folder) => folder.loaded),
      }
      cache = { key, catalog }
      return catalog
    },
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

/**
 * The phone's session tab strip host. A tab may belong to any project of the server, so the strip reads the drawer's
 * overview (every project and root session, live) rather than one chat's controller, opens a tab through the
 * drawer's own path, and its first button opens the drawer. The open tabs are kept per server profile and shared by
 * every chat screen, so the strip looks the same whichever chat is on screen.
 */
import type { TabCatalog } from "@occ/core/session-tabs"
import type { BridgeStorage } from "@occ/ui/bridge"
import { TabList, type TabsHost } from "@occ/ui/tabs-host"
import type { KeyValueStore } from "./bridge"
import type { OverviewData, OverviewNames } from "./overview"
import { ROOT_CAP } from "./overview.svelte"
import { overviewCatalog, tabsKey } from "./tab-catalog"

/** What the host reads from the app model. */
export type PhoneTabsDeps = {
  /** The drawer's snapshot; undefined until it first loads. */
  overview(): { data: OverviewData | undefined; loading: boolean }
  names(): OverviewNames
  openSession(directory: string, sessionID: string): void
  openDrawer(): void
}

/** A `BridgeStorage` straight on the app's store: the key is already the profile's own. */
function directStorage(store: KeyValueStore): BridgeStorage {
  return {
    get: <T>(key: string): T | undefined => {
      try {
        const raw = store.getItem(key)
        return raw === null ? undefined : (JSON.parse(raw) as T)
      } catch {
        return undefined
      }
    },
    set: (key, value) => {
      try {
        store.setItem(key, JSON.stringify(value))
      } catch {
        // Storage full or blocked: the open tabs are not worth an error.
      }
    },
  }
}

const lists = new Map<string, TabList>()

/** The one tab list of a server profile, shared by every chat screen of it. */
export function profileTabs(profileID: string, store: KeyValueStore): TabList {
  let list = lists.get(profileID)
  if (!list) {
    list = new TabList(directStorage(store), tabsKey(profileID))
    lists.set(profileID, list)
  }
  return list
}

/** The status icons only need minute precision; a coarser clock keeps the catalog the same between snapshots. */
const minute = (): number => Math.floor(Date.now() / 60_000) * 60_000

export function phoneTabsHost(list: TabList, deps: PhoneTabsDeps): TabsHost {
  let cache: { key: unknown[]; catalog: TabCatalog } | undefined
  return {
    list,
    catalog: () => {
      const { data, loading } = deps.overview()
      const names = deps.names()
      const now = minute()
      const key = [data, names.resolved, names.titles, loading, now]
      if (cache && cache.key.every((value, i) => value === key[i])) return cache.catalog
      const catalog = overviewCatalog(data, names, loading, ROOT_CAP, now)
      cache = { key, catalog }
      return catalog
    },
    open: (id, directory) => deps.openSession(directory, id),
    sessions: { label: "Open projects and sessions", toggle: () => deps.openDrawer() },
  }
}

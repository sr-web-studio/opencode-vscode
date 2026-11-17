/**
 * The phone's session tab strip host. A tab may belong to any project of the server, so the strip reads the drawer's
 * overview (every project and root session, live) rather than one chat's controller, opens a tab through the
 * drawer's own path, and its first button opens the drawer. The open tabs are kept per server profile and shared by
 * every chat screen, so the strip looks the same whichever chat is on screen.
 */
import { lookupTab, type SessionTab, type TabCatalog, type TabLookup } from "@occ/core/session-tabs"
import { NO_STORAGE, type TabStorage } from "@occ/core/tab-list"
import { TabList, type TabsHost } from "@occ/ui/tabs-host"
import type { KeyValueStore } from "./bridge"
import type { OverviewData, OverviewNames } from "./overview"
import { overviewCatalog, tabsKey } from "./tab-catalog"

/** What the host reads from the app model. */
export type PhoneTabsDeps = {
  /** The drawer's snapshot; undefined until it first loads. */
  overview(): { data: OverviewData | undefined; loading: boolean }
  names(): OverviewNames
  /** `session.get` on the connected server; throws when there is no connection. */
  getSession(sessionID: string): Promise<{ location?: { directory?: string } }>
  openSession(directory: string, sessionID: string): void
  openDrawer(): void
}

/** A `TabStorage` straight on the app's store: the key is already the profile's own. */
function directStorage(store: KeyValueStore): TabStorage {
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

/**
 * The one tab list of a server profile, shared by every chat screen of it. Without a saved server (`profileID` empty)
 * the list lives in memory only: no key is shared between servers that have no id.
 */
export function profileTabs(profileID: string, store: KeyValueStore): TabList {
  let list = lists.get(profileID)
  if (!list) {
    list = profileID ? new TabList(directStorage(store), tabsKey(profileID)) : new TabList(NO_STORAGE)
    lists.set(profileID, list)
  }
  return list
}

/** A saved server was removed from this phone: its open tabs go too, stored and in memory. */
export function forgetProfileTabs(profileID: string, store: { removeItem(key: string): void }): void {
  lists.delete(profileID)
  if (!profileID) return
  try {
    store.removeItem(tabsKey(profileID))
  } catch {
    // Blocked storage: nothing was kept either.
  }
}

export function phoneTabsHost(list: TabList, deps: PhoneTabsDeps): TabsHost {
  let cache: { key: unknown[]; catalog: TabCatalog } | undefined
  return {
    list,
    catalog: (now) => {
      const { data, loading } = deps.overview()
      const names = deps.names()
      const key = [data, names.resolved, names.titles, loading, now]
      if (cache && cache.key.every((value, i) => value === key[i])) return cache.catalog
      const catalog = overviewCatalog(data, names, loading, now)
      cache = { key, catalog }
      return catalog
    },
    lookup: (tab: SessionTab): Promise<TabLookup> => lookupTab(() => deps.getSession(tab.id)),
    open: (id, directory) => deps.openSession(directory, id),
    sessions: { label: "Open projects and sessions", toggle: () => deps.openDrawer() },
  }
}

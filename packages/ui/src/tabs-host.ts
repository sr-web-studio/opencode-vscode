import type { SessionTab, TabCatalog, TabLookup } from "@occ/core/session-tabs"
import type { TabList } from "./tab-list.svelte"

// The package's `./*.svelte` export maps to components, so hosts reach the rune-based list through this file.
export { TabList, TABS_KEY } from "./tab-list.svelte"

/**
 * Where the session tab strip gets its sessions and how a tab opens. The phone passes one: its tabs span every project
 * of the server, its list comes from the drawer's overview, and a tab opens through the drawer's path. VS Code builds
 * the same thing from the sessions pane's data (`chatTabsHost`).
 */
export interface TabsHost {
  /** The open tabs, shared by every chat of the host (the phone: one list per server profile). */
  list: TabList
  /**
   * Every session the dropdown may list, in the host's list order, and the ids the host's lists carry. Reactive.
   * `now` is the strip's clock, which ticks every 30 s like the sessions pane's, so statuses age on the same beat.
   */
  catalog(now: number): TabCatalog
  /**
   * Ask the server whether a tab's session still exists (`session.get`). Only a "not found" answer closes the tab;
   * without this the strip never closes a tab on its own.
   */
  lookup?(tab: SessionTab): Promise<TabLookup>
  /** Open a session as the chat's session, in the folder that owns it. */
  open(id: string, directory: string): void
  /**
   * The strip's first button: the place that lists every session (VS Code: the sessions pane, the phone: the drawer).
   * Left out where there is no such place.
   */
  sessions?: {
    label: string
    /** True while that place is open (the pane's toggle shows it). */
    pressed?(): boolean
    toggle(): void
  }
}

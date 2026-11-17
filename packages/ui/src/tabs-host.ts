import type { TabCatalog } from "@occ/core/session-tabs"
import type { TabList } from "./tab-list.svelte"

// The package's `./*.svelte` export maps to components, so hosts reach the rune-based list through this file.
export { TabList, TABS_KEY } from "./tab-list.svelte"

/**
 * What a host gives the session tab strip when its sessions live outside the chat's own controller. The phone passes
 * one: its tabs span every project of the server, its list comes from the drawer's overview, and a tab opens through
 * the drawer's path. VS Code passes none and the chat builds the same thing from the sessions pane's data.
 */
export interface TabsHost {
  /** The open tabs, shared by every chat of the host (the phone: one list per server profile). */
  list: TabList
  /** Every session the dropdown may list, in the host's list order, and the lists that prove a tab gone. Reactive. */
  catalog(): TabCatalog
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

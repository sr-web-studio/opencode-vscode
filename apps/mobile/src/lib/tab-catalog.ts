/**
 * The phone's tab strip catalog: the drawer's overview turned into the strip's sessions. Pure, so it is tested
 * without a server.
 */
import type { TabCatalog, TabSession } from "@occ/core/session-tabs"
import { buildOverview, type OverviewData, type OverviewNames } from "./overview"

/** Where a server profile's open tabs are kept in the app's store. */
export const tabsKey = (profileID: string): string => `occ.tabs.${profileID}`

/**
 * The strip's sessions in the drawer's order: projects by activity, sessions by activity inside each, archived ones
 * left out like the drawer does by default. `listed` carries every root session of the snapshot, archived ones
 * included; a tab outside it is looked up on the server, never closed for that alone (the snapshot stops at a cap).
 */
export function overviewCatalog(data: OverviewData | undefined, names: OverviewNames, loading: boolean, now: number = Date.now()): TabCatalog {
  if (!data) return { sessions: [], listed: new Set(), loading: true }
  const sessions = buildOverview(data, names, now).flatMap((group) =>
    group.sessions.map((session): TabSession => ({ id: session.id, directory: group.directory, title: session.title, project: group.title, status: session.status, last: session.last })),
  )
  return { sessions, listed: new Set(data.sessions.map((session) => session.id)), loading }
}

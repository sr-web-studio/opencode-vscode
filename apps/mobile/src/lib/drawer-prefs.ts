/**
 * Which projects the drawer keeps open, remembered per saved server.
 *
 * Only explicit answers are stored: a project the owner never touched follows the default (open when it is the project
 * of the current screen, or when it has a waiting or running session). The value is a plain folder → boolean map in
 * localStorage, so a stale or hand-edited value falls back to the default instead of breaking the drawer.
 */

export type ExpandedMap = Readonly<Record<string, boolean>>

/** Parse what localStorage held. Anything that is not an object of booleans is ignored. */
export function parseExpanded(raw: string | null | undefined): ExpandedMap {
  if (!raw) return {}
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: Record<string, boolean> = {}
  for (const [directory, open] of Object.entries(value)) if (typeof open === "boolean") out[directory] = open
  return out
}

/** Whether a project is open: the owner's answer, else the default the caller computes. */
export function isExpanded(map: ExpandedMap, directory: string, fallback: boolean): boolean {
  return map[directory] ?? fallback
}

/** Store one project's answer and return the new map (the caller saves it). */
export function setExpanded(map: ExpandedMap, directory: string, open: boolean): ExpandedMap {
  return { ...map, [directory]: open }
}

/** The localStorage key of one saved server. */
export function expandedKey(profileID: string): string {
  return `occ.drawer.expanded.${profileID}`
}

/**
 * Whether the drawer reveals the projects without sessions. Remembered per saved server like the expansion answers,
 * because the useful projects of one server say nothing about another's.
 */
export function showEmptyKey(profileID: string): string {
  return `occ.drawer.empty.${profileID}`
}

/** Read the saved switch: only the exact value the drawer writes counts, anything else is "hidden". */
export function parseShowEmpty(raw: string | null | undefined): boolean {
  return raw === "1"
}

/** The value to store for the switch. */
export function serializeShowEmpty(show: boolean): string {
  return show ? "1" : "0"
}

/**
 * The drawer's inbox height. It belongs to the app rather than to one server: the screen it has to fit in is the
 * phone's, and every server's drawer has the same rows.
 */
export const INBOX_HEIGHT_KEY = "occ.drawer.inboxHeight"

/** Read the saved height: only a positive finite number counts, so a stale value falls back to the default. */
export function parseInboxHeight(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** The value to store for the height, in whole pixels. */
export function serializeInboxHeight(height: number): string {
  return String(Math.round(height))
}

/**
 * Whether the drawer's inbox is collapsed, remembered per saved server like the project expansion answers: the useful
 * part of one server's list says nothing about another's.
 */
export function inboxCollapsedKey(profileID: string): string {
  return `occ.drawer.inbox.${profileID}`
}

/** Read the saved collapse: only the exact value the drawer writes counts, anything else is "expanded". */
export function parseInboxCollapsed(raw: string | null | undefined): boolean {
  return raw === "1"
}

/** The value to store for the collapse. */
export function serializeInboxCollapsed(collapsed: boolean): string {
  return collapsed ? "1" : "0"
}

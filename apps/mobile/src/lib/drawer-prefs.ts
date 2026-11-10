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

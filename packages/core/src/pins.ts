/** Pinned models. The list is kept by the host (extension `globalState`, synced), never in OpenCode config. */

export const pinKey = (m: { id: string; providerID: string }): string => `${m.providerID}/${m.id}`

export function togglePin(pins: readonly string[], key: string): string[] {
  return pins.includes(key) ? pins.filter((k) => k !== key) : [...pins, key]
}

/** Whatever storage hands back (it may be stale or hand-edited) becomes a clean list of unique strings. */
export function normalizePins(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  for (const v of raw) if (typeof v === "string" && v.includes("/")) seen.add(v)
  return [...seen]
}

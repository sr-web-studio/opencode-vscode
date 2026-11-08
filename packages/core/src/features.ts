import type { Features } from "./protocol"

/** First server version that has `session.revert` (snapshots, `/undo`). Older servers (2.1.x) do not. */
export const REVERT_MIN_VERSION = "2.2.0"

export function parseVersion(v: string | undefined): [number, number, number] | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(v ?? "")
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

/** `version >= min`. An unknown version counts as new enough: the call itself is still checked when used. */
export function atLeast(version: string | undefined, min: string): boolean {
  const have = parseVersion(version)
  const need = parseVersion(min)
  if (!have || !need) return true
  for (let i = 0; i < 3; i++) if (have[i]! !== need[i]!) return have[i]! > need[i]!
  return true
}

type ClientShape = { session?: { update?: unknown; revert?: { stage?: unknown } } }

/**
 * What this server can do. The bundled client always has every method, so a method being present says nothing about
 * an older server: the version decides, and `broken` records a call that already failed as unsupported.
 */
export function detectFeatures(client: ClientShape | undefined, version: string | undefined, broken: { revert?: boolean; rename?: boolean } = {}): Features {
  return {
    revert: !!client && typeof client.session?.revert?.stage === "function" && atLeast(version, REVERT_MIN_VERSION) && !broken.revert,
    rename: !!client && typeof client.session?.update === "function" && !broken.rename,
  }
}

/** An error that means "this server does not have that endpoint". */
export const isUnsupported = (e: unknown): boolean => {
  const text = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  return /\b404\b|not found|no such route|unsupported|not implemented/i.test(text)
}

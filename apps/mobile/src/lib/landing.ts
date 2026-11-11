/**
 * Where the app opens after connecting to a server: the chat last used on that server, else the most active project,
 * else a clear empty state that points at the drawer.
 *
 * The choice is pure so the rule is tested without a server. The caller passes the drawer's groups (already in the
 * shared activity order) and what was remembered for that server.
 */
import { sameDirectory } from "@occ/core/paths"
import { UNTITLED } from "@occ/core/sessions"
import type { OverviewGroup } from "./overview"

/** The chat that was last on screen for one saved server. */
export type LastUsed = { directory: string; sessionID?: string }

/** `title` is the remembered session's name, so the chat header is right before the controller has synced. */
export type Landing = { kind: "chat"; directory: string; sessionID?: string; title?: string } | { kind: "empty" }

/** The localStorage key of one saved server's last chat. */
export function lastUsedKey(profileID: string): string {
  return `occ.last.${profileID}`
}

/** Read what was saved; anything that is not a folder path is ignored. */
export function parseLastUsed(raw: unknown): LastUsed | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const o = raw as Record<string, unknown>
  if (typeof o.directory !== "string" || !o.directory) return undefined
  const sessionID = typeof o.sessionID === "string" && o.sessionID ? o.sessionID : undefined
  return { directory: o.directory, sessionID }
}

/**
 * The remembered chat wins, even when the project list failed to load: the chat itself reports its connection. Its
 * session is dropped when the list no longer has it (a deleted session), so the chat opens the folder's newest one.
 * Without a remembered chat, the first project with a session (the shared order puts waiting and running first, then
 * the newest) is opened; a project with only empty groups still opens its chat, and no project at all is the empty state.
 */
export function chooseLanding(groups: ReadonlyArray<OverviewGroup>, last?: LastUsed): Landing {
  if (last) {
    const group = groups.find((entry) => sameDirectory(entry.directory, last.directory))
    const session = last.sessionID ? group?.sessions.find((entry) => entry.id === last.sessionID) : undefined
    // The drawer's placeholder is not a name: without one the chat header falls back to the folder, as it does later.
    const title = session?.title.trim()
    return { kind: "chat", directory: group?.directory ?? last.directory, sessionID: session?.id, title: title && title !== UNTITLED ? title : undefined }
  }
  const active = groups.find((group) => group.sessions.length > 0) ?? groups[0]
  return active ? { kind: "chat", directory: active.directory } : { kind: "empty" }
}

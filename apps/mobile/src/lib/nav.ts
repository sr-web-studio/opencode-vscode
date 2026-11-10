/**
 * The screen stack. Pure: it only moves entries around, so the rules (what back does, which projects are still open)
 * are tested without a DOM. Every screen that belongs to a project carries its folder; a project's controller lives
 * exactly as long as some screen of that folder is on the stack.
 *
 * There is no project or session list screen: the drawer is the only list. The stack is therefore a chat (or the empty
 * home state) with the saved-server list under it only when this phone has more than one server, so back walks out to
 * that list instead of leaving the app.
 */
import type { ImageRef } from "@occ/core/images"

export type Screen =
  | { kind: "servers" }
  | { kind: "server-form"; profileID?: string }
  /** No project to open: the drawer (or the server list) is where the owner picks one. */
  | { kind: "home" }
  /** `sessionID`: open this session when the chat appears. `draft`: start a new session. Neither: the newest one. */
  | { kind: "chat"; directory: string; sessionID?: string; draft?: boolean }
  | { kind: "file"; directory: string; path: string; line?: number }
  | { kind: "diff"; directory: string; file: string; patches: string[] }
  | { kind: "changes"; directory: string; title: string; files: Array<{ file: string; patches: string[] }> }
  | { kind: "shell"; directory: string; shellID: string; title?: string; sessionID?: string }
  | { kind: "worker"; directory: string; sessionID: string }
  | { kind: "image"; directory: string; sessionID: string; ref: ImageRef; name?: string }

export type Entry = { key: number; screen: Screen }

export const push = (stack: ReadonlyArray<Entry>, screen: Screen, key: number): Entry[] => [...stack, { key, screen }]

/** Remove the top screen. The bottom screen stays: back on it means "leave the app", which the caller decides. */
export const pop = (stack: ReadonlyArray<Entry>): Entry[] => (stack.length > 1 ? stack.slice(0, -1) : [...stack])

export const canPop = (stack: ReadonlyArray<Entry>): boolean => stack.length > 1

/** What Android's back button should close: the dialog, then the drawer, then Settings, then the top screen. */
export type BackContext = { modal: boolean; drawer: boolean; settings: boolean; canPop: boolean }
export type BackAction = "modal" | "drawer" | "settings" | "pop" | "exit"

export function backAction(context: BackContext): BackAction {
  if (context.modal) return "modal"
  if (context.drawer) return "drawer"
  if (context.settings) return "settings"
  return context.canPop ? "pop" : "exit"
}

/** Remove the top screen only when it is `key`: a screen that closes itself must not close the one that replaced it. */
export const popKey = (stack: ReadonlyArray<Entry>, key: number): Entry[] => (stack.at(-1)?.key === key ? pop(stack) : [...stack])

export const top = (stack: ReadonlyArray<Entry>): Screen | undefined => stack.at(-1)?.screen

/** The project folders that some screen of the stack still shows. */
export function directoriesInUse(stack: ReadonlyArray<Entry>): Set<string> {
  const out = new Set<string>()
  for (const { screen } of stack) if ("directory" in screen) out.add(screen.directory)
  return out
}

/** The saved-server list at the bottom, only when there is more than one server to come back to. */
const base = (keys: () => number, servers: boolean): Entry[] => (servers ? [{ key: keys(), screen: { kind: "servers" } }] : [])

/** The stack for "open this session of this project". */
export function stackForSession(directory: string, keys: () => number, sessionID?: string, servers = false): Entry[] {
  return [...base(keys, servers), { key: keys(), screen: { kind: "chat", directory, sessionID } }]
}

/**
 * The stack for "open this worker": a worker is read-only, so it never becomes a chat. When the parent is known its
 * chat sits under the worker screen, so back returns to the conversation the worker belongs to; without the parent the
 * worker's own folder's chat is the way back, and the drawer in it lists every other project.
 */
export function stackForWorker(directory: string, keys: () => number, sessionID: string, parent?: { directory: string; sessionID: string }, servers = false): Entry[] {
  const stack = base(keys, servers)
  stack.push(parent ? { key: keys(), screen: { kind: "chat", directory: parent.directory, sessionID: parent.sessionID } } : { key: keys(), screen: { kind: "chat", directory } })
  stack.push({ key: keys(), screen: { kind: "worker", directory, sessionID } })
  return stack
}

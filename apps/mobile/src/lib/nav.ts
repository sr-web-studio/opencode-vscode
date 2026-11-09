/**
 * The screen stack. Pure: it only moves entries around, so the rules (what back does, which projects are still open)
 * are tested without a DOM. Every screen that belongs to a project carries its folder; a project's controller lives
 * exactly as long as some screen of that folder is on the stack.
 */
import type { ImageRef } from "@occ/core/images"

export type Screen =
  | { kind: "servers" }
  | { kind: "server-form"; profileID?: string }
  | { kind: "projects" }
  | { kind: "sessions"; directory: string }
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

/** Remove the top screen only when it is `key`: a screen that closes itself must not close the one that replaced it. */
export const popKey = (stack: ReadonlyArray<Entry>, key: number): Entry[] => (stack.at(-1)?.key === key ? pop(stack) : [...stack])

export const top = (stack: ReadonlyArray<Entry>): Screen | undefined => stack.at(-1)?.screen

/** The project folders that some screen of the stack still shows. */
export function directoriesInUse(stack: ReadonlyArray<Entry>): Set<string> {
  const out = new Set<string>()
  for (const { screen } of stack) if ("directory" in screen) out.add(screen.directory)
  return out
}

/** The stack for "open this session of this project": server list at the bottom so back walks out step by step. */
export function stackForSession(directory: string, keys: () => number, sessionID?: string): Entry[] {
  return [
    { key: keys(), screen: { kind: "servers" } },
    { key: keys(), screen: { kind: "projects" } },
    { key: keys(), screen: { kind: "sessions", directory } },
    { key: keys(), screen: { kind: "chat", directory, sessionID } },
  ]
}

/**
 * The stack for "open this worker": a worker is read-only, so it never becomes a chat. When the parent is known its
 * chat sits under the worker screen, so back returns to the conversation the worker belongs to; without the parent the
 * worker opens straight from the project's session list.
 */
export function stackForWorker(directory: string, keys: () => number, sessionID: string, parent?: { directory: string; sessionID: string }): Entry[] {
  const stack: Entry[] = [
    { key: keys(), screen: { kind: "servers" } },
    { key: keys(), screen: { kind: "projects" } },
    { key: keys(), screen: { kind: "sessions", directory: parent?.directory ?? directory } },
  ]
  if (parent) stack.push({ key: keys(), screen: { kind: "chat", directory: parent.directory, sessionID: parent.sessionID } })
  stack.push({ key: keys(), screen: { kind: "worker", directory, sessionID } })
  return stack
}

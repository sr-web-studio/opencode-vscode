/**
 * Which VS Code terminal a shell command goes to. Pure: the extension host keeps the list and applies the answers.
 *
 * `session` mode: one terminal per session, every command appended. A command that starts while that terminal is still
 * running another command gets an extra terminal (`#2`, `#3`, ...) that later commands reuse. `perCommand` mode: always
 * a new terminal. `maxOpen` closes the oldest idle terminals; a terminal with a running command is never closed.
 */

export type TerminalMode = "session" | "perCommand"

export type Slot = {
  id: string
  sessionID: string
  /** 1 for the main terminal of a session, 2.. for extras. */
  slot: number
  /** A command is running in it. */
  busy: boolean
  /** When it last started or finished a command (epoch ms). Oldest idle terminals are closed first. */
  lastUsed: number
}

export type Plan = { kind: "reuse"; id: string } | { kind: "create"; slot: number }

/** The smallest slot number (from 1) not used by this session's terminals. */
const freeSlot = (own: readonly Slot[]): number => {
  const used = new Set(own.map((t) => t.slot))
  let n = 1
  while (used.has(n)) n++
  return n
}

/** Reuse the lowest idle terminal of the session, else create the next free slot. `perCommand` always creates. */
export function planTerminal(terminals: readonly Slot[], mode: TerminalMode, sessionID: string): Plan {
  const own = terminals.filter((t) => t.sessionID === sessionID)
  if (mode === "session") {
    const idle = own.filter((t) => !t.busy).sort((a, b) => a.slot - b.slot)[0]
    if (idle) return { kind: "reuse", id: idle.id }
  }
  return { kind: "create", slot: freeSlot(own) }
}

/** Ids to close so that at most `max` (at least 1) remain: the least recently used idle ones. Busy ones are never chosen. */
export function terminalsToClose(terminals: readonly Slot[], max: number): string[] {
  const excess = terminals.length - Math.max(1, max)
  if (excess <= 0) return []
  return terminals
    .filter((t) => !t.busy)
    .sort((a, b) => a.lastUsed - b.lastUsed)
    .slice(0, excess)
    .map((t) => t.id)
}

/**
 * Slash commands of the prompt box: parsing, the suggestion list and the checks a client command needs before it runs.
 * Pure, so the popup, the send path and the tests share one definition.
 */
import { visibleTurns } from "./transcript/revert"
import type { SessionView } from "./transcript/types"

/** Commands this extension implements itself. They win over a server command of the same name. */
export const CLIENT_COMMANDS = [
  { name: "mcps", description: "MCP servers: status, sign in, turn on or off" },
  { name: "compact", description: "Summarize the conversation to free up context" },
  { name: "undo", description: "Revert your last prompt and its file changes" },
  { name: "redo", description: "Bring back what /undo removed" },
  { name: "fork", description: "Continue in a new session with this history" },
  { name: "export", description: "Save this session as Markdown or JSON" },
  { name: "skills", description: "Attach a skill to your next prompt" },
] as const

export type ClientCommandName = (typeof CLIENT_COMMANDS)[number]["name"]

export const isClientCommand = (name: string): name is ClientCommandName => CLIENT_COMMANDS.some((c) => c.name === name)

/** One row of the popup. `source` decides what accepting it does; `skill` rows carry the skill id. */
export type Suggestion = { name: string; description?: string; source: "client" | "server" | "skill"; id?: string }

/** `/name` or `/name args` (the whole text, trimmed). Anything else, like a path `/ x`, is not a command. */
export function parseSlash(text: string): { name: string; args: string } | undefined {
  const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return m ? { name: m[1]!, args: (m[2] ?? "").trim() } : undefined
}

/**
 * The popup shows while the text starts with `/` and the caret is still inside the first word.
 * `query` is what is typed before the caret.
 */
export function slashQuery(text: string, caret: number): { query: string } | undefined {
  if (!text.startsWith("/")) return undefined
  const space = text.search(/\s/)
  const wordEnd = space === -1 ? text.length : space
  if (caret < 1 || caret > wordEnd) return undefined
  return { query: text.slice(1, caret) }
}

/** `/skills <filter>`: the popup lists skills instead of commands. Returns the filter, or undefined for any other text. */
export function skillsFilter(text: string): string | undefined {
  const m = /^\/skills[ \t]+([^\n]*)$/.exec(text)
  return m ? m[1]!.trim() : undefined
}

/** Exact match first, then prefix, then substring. Stable within a rank. An empty query keeps the order. */
export function rankByQuery<T>(items: ReadonlyArray<T>, query: string, keys: (item: T) => string[]): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  const score = (item: T): number => {
    let best = -1
    for (const key of keys(item)) {
      const k = key.toLowerCase()
      const s = k === q ? 0 : k.startsWith(q) ? 1 : k.includes(q) ? 2 : -1
      if (s !== -1 && (best === -1 || s < best)) best = s
    }
    return best
  }
  return items
    .map((item, i) => ({ item, i, s: score(item) }))
    .filter((x) => x.s !== -1)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.item)
}

/** Client commands, then the server's (minus the names a client command overrides), filtered by `query`. */
export function suggestCommands(query: string, server: ReadonlyArray<{ name: string; description?: string }>): Suggestion[] {
  const all: Suggestion[] = [
    ...CLIENT_COMMANDS.map((c) => ({ ...c, source: "client" as const })),
    ...server.filter((c) => !isClientCommand(c.name)).map((c) => ({ name: c.name, description: c.description, source: "server" as const })),
  ]
  return rankByQuery(all, query, (s) => [s.name])
}

export function suggestSkills(filter: string, skills: ReadonlyArray<{ id: string; name: string; description?: string }>): Suggestion[] {
  const all: Suggestion[] = skills.map((s) => ({ name: s.name, id: s.id, description: s.description, source: "skill" }))
  return rankByQuery(all, filter, (s) => [s.name, s.id ?? ""])
}

/** Put `/name ` in place of the first word. Text after it stays. Returns the new text and where the caret goes. */
export function applySuggestion(text: string, name: string): { text: string; caret: number } {
  const space = text.search(/\s/)
  const rest = space === -1 ? "" : text.slice(space).replace(/^[ \t]+/, "")
  const head = `/${name} `
  return { text: head + rest, caret: head.length }
}

/** The prompt `/undo` takes back: the newest user turn that is still visible, so a second `/undo` goes one turn further. */
export function undoTarget(view: SessionView): string | undefined {
  const turns = visibleTurns(view).filter((t) => t.user)
  return turns[turns.length - 1]?.user?.id
}

export type CommandContext = {
  hasSession: boolean
  running: boolean
  revertStaged: boolean
  canRevert: boolean
  undoTarget?: string
}

/** Why a client command cannot run right now, in words for the user. Undefined means it can. */
export function commandBlock(name: ClientCommandName, ctx: CommandContext): string | undefined {
  switch (name) {
    case "compact":
      return ctx.hasSession ? undefined : "Nothing to compact yet. Send a message first."
    case "fork":
      return ctx.hasSession ? undefined : "Nothing to fork yet."
    case "export":
      return ctx.hasSession ? undefined : "Nothing to export yet."
    case "undo":
      if (!ctx.canRevert) return "This OpenCode server cannot undo (it needs version 2.2 or newer)."
      if (!ctx.undoTarget) return "Nothing to undo yet."
      if (ctx.running) return "Stop the session first, then undo."
      return undefined
    case "redo":
      return ctx.revertStaged ? undefined : "Nothing to redo. Redo only brings back what /undo removed."
    default:
      return undefined
  }
}

/** The server refuses to fork a session without messages (`InvalidRequestError`, kind `empty_session`). */
export const isEmptySession = (e: unknown): boolean => (e as { kind?: unknown } | undefined)?.kind === "empty_session"

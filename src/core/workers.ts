import type { SessionView, ToolItem } from "./transcript/types"

/** What the worker list needs to know about a child session (a subset of `SessionInfo`). */
export type ChildSession = {
  id: string
  title?: string
  agent?: string
  outcome?: "succeeded" | "failed" | "interrupted"
  time: { created: number; updated: number }
}

export type WorkerStatus = "running" | "done" | "failed" | "stopped"

export type Worker = {
  /** The child session, once known. Without it the row cannot be opened yet. */
  sessionID?: string
  /** The `subagent` tool call that started it, if the visible transcript has one. */
  toolID?: string
  agent: string
  description: string
  status: WorkerStatus
  started?: number
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** `<subagent sessionID="ses_…" …>` in the tool result, a fallback when the metadata carries no id. */
export const sessionIDFromOutput = (output: string): string | undefined => /<subagent\s+sessionID="(ses_[A-Za-z0-9]+)"/.exec(output)?.[1]

/** The child session of a `subagent` tool call: progress/success metadata first, then the result text. */
export function toolChildID(tool: ToolItem): string | undefined {
  if (tool.name !== "subagent") return undefined
  return str(tool.metadata.sessionID) || sessionIDFromOutput(tool.output) || undefined
}

const norm = (s: string) => s.trim().toLowerCase()

/** Does a child's title describe this tool call? Titles are free text, so this only needs `description` inside it. */
const titleMatches = (child: ChildSession, description: string) => !!description && norm(child.title ?? "").includes(norm(description))

/**
 * Pick the child for a tool whose metadata has no id: same agent, title containing the description, otherwise the
 * unclaimed same-agent child created closest to the tool call. Returns undefined when nothing fits well enough.
 */
export function matchChild(tool: ToolItem, children: readonly ChildSession[], claimed: ReadonlySet<string>): ChildSession | undefined {
  const agent = norm(str(tool.input.agent))
  const description = str(tool.input.description)
  const free = children.filter((c) => !claimed.has(c.id) && (!agent || !c.agent || norm(c.agent) === agent))
  const byTitle = free.find((c) => titleMatches(c, description))
  if (byTitle) return byTitle
  if (tool.created === undefined) return undefined
  const at = tool.created
  const near = free
    .filter((c) => c.time.created >= at - 1_000)
    .sort((a, b) => a.time.created - b.time.created)[0]
  return near
}

export type WorkerInput = {
  view: SessionView
  /** Children of the current session from `session.list({ parentID })` plus live `session.created` events. */
  children: readonly ChildSession[]
  /** Ids of sessions that are executing right now. */
  running: ReadonlySet<string>
}

function statusOf(tool: ToolItem | undefined, child: ChildSession | undefined, running: ReadonlySet<string>): WorkerStatus {
  // The child session is the truth. A background worker finishes its tool call at once but keeps running.
  if (child && running.has(child.id)) return "running"
  if (child?.outcome === "failed") return "failed"
  if (child?.outcome === "interrupted") return "stopped"
  if (child?.outcome === "succeeded") return "done"
  if (tool) {
    if (tool.status === "streaming" || tool.status === "running") return "running"
    if (tool.status === "error") return "failed"
    const reported = str(tool.metadata.status)
    if (reported === "failed" || reported === "error") return "failed"
    if (reported === "running") return "running"
  }
  return "done"
}

/** Workers of the current session: one per `subagent` tool line, plus children no visible line explains. Newest last. */
export function deriveWorkers({ view, children, running }: WorkerInput): Worker[] {
  const tools: ToolItem[] = []
  for (const turn of view.turns) for (const step of turn.steps) for (const i of step.items) if (i.kind === "tool" && i.name === "subagent") tools.push(i)

  const byID = new Map(children.map((c) => [c.id, c]))
  const claimed = new Set<string>()
  for (const t of tools) {
    const id = toolChildID(t)
    if (id) claimed.add(id)
  }

  const workers: Worker[] = []
  for (const tool of tools) {
    let sessionID = toolChildID(tool)
    let child = sessionID ? byID.get(sessionID) : undefined
    if (!sessionID) {
      child = matchChild(tool, children, claimed)
      if (child) {
        sessionID = child.id
        claimed.add(child.id)
      }
    }
    workers.push({
      sessionID,
      toolID: tool.id,
      agent: str(tool.input.agent) || child?.agent || "agent",
      description: str(tool.input.description) || child?.title || "",
      status: statusOf(tool, child, running),
      started: tool.created ?? child?.time.created,
    })
  }
  for (const child of children) {
    if (claimed.has(child.id)) continue
    workers.push({
      sessionID: child.id,
      agent: child.agent ?? "agent",
      description: child.title ?? "",
      status: statusOf(undefined, child, running),
      started: child.time.created,
    })
  }
  return workers.sort((a, b) => (a.started ?? 0) - (b.started ?? 0))
}

export type BackgroundSummary = { workers: number; running: number; shells: number }

/** Counts for the slim "Background · 2 workers, 1 shell" row. */
export function backgroundSummary(workers: readonly Worker[], shells: number): BackgroundSummary {
  return { workers: workers.length, running: workers.filter((w) => w.status === "running").length, shells }
}

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
  /** Unique in the list by construction: the child session id, else `tool:<tool id>`. Safe as a keyed `{#each}` key. */
  key: string
  /** The child session, once known. Without it the row cannot be opened yet. */
  sessionID?: string
  /** The latest `subagent` tool call of this worker that the visible transcript has. */
  toolID?: string
  /** Every visible `subagent` call that belongs to this worker (a lead can continue one worker session many times). */
  toolIDs: string[]
  /** How many `subagent` calls went to this worker. */
  calls: number
  agent: string
  /** The latest call's description. */
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

/**
 * Workers of the current session: **one row per child session**. A lead can continue the same worker session with
 * many `subagent` calls (`input.sessionID`), so several tool lines can point at one child; they share one row that
 * shows the latest call's description and the call count, with the status of the child. A call whose child is not
 * known yet gets its own row (`tool:<id>`). Children that no visible line explains are listed too. Oldest first.
 */
export function deriveWorkers({ view, children, running }: WorkerInput): Worker[] {
  const tools: ToolItem[] = []
  for (const turn of view.turns) for (const step of turn.steps) for (const i of step.items) if (i.kind === "tool" && i.name === "subagent") tools.push(i)

  const byID = new Map(children.map((c) => [c.id, c]))
  const claimed = new Set<string>()
  for (const t of tools) {
    const id = toolChildID(t)
    if (id) claimed.add(id)
  }

  // Tools in transcript order, each resolved to a child session where possible.
  const resolved: Array<{ tool: ToolItem; sessionID?: string }> = []
  for (const tool of tools) {
    let sessionID = toolChildID(tool)
    if (!sessionID) {
      const match = matchChild(tool, children, claimed)
      if (match) {
        sessionID = match.id
        claimed.add(match.id)
      }
    }
    resolved.push({ tool, sessionID })
  }

  const rows = new Map<string, Worker>()
  const order: string[] = []
  for (const { tool, sessionID } of resolved) {
    const key = sessionID ?? `tool:${tool.id}`
    const child = sessionID ? byID.get(sessionID) : undefined
    const earlier = rows.get(key)
    const startedHere = tool.created ?? child?.time.created
    if (!earlier) order.push(key)
    rows.set(key, {
      key,
      sessionID,
      toolID: tool.id,
      toolIDs: [...(earlier?.toolIDs ?? []), tool.id],
      calls: (earlier?.calls ?? 0) + 1,
      agent: str(tool.input.agent) || earlier?.agent || child?.agent || "agent",
      description: str(tool.input.description) || child?.title || earlier?.description || "",
      // The latest call is the one that decides while the child is unknown; the child decides once it is known.
      status: statusOf(tool, child, running),
      started: minTime(earlier?.started, startedHere),
    })
  }
  const workers = order.map((k) => rows.get(k)!)
  for (const child of children) {
    if (claimed.has(child.id)) continue
    workers.push({
      key: child.id,
      sessionID: child.id,
      toolIDs: [],
      calls: 0,
      agent: child.agent ?? "agent",
      description: child.title ?? "",
      status: statusOf(undefined, child, running),
      started: child.time.created,
    })
  }
  return workers.sort((a, b) => (a.started ?? 0) - (b.started ?? 0))
}

const minTime = (a: number | undefined, b: number | undefined): number | undefined => (a === undefined ? b : b === undefined ? a : Math.min(a, b))

export type BackgroundSummary = { workers: number; running: number; shells: number }

/** Counts for the slim "Background · 2 workers, 1 shell" row. */
export function backgroundSummary(workers: readonly Worker[], shells: number): BackgroundSummary {
  return { workers: workers.length, running: workers.filter((w) => w.status === "running").length, shells }
}

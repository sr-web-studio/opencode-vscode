import type { EventEnvelope, SessionMessageInfo } from "../api"
import { applyRevertEvent } from "./revert"
import {
  emptyView,
  type Outcome,
  type SessionView,
  type StepItem,
  type StepView,
  type ToolItem,
  type TurnView,
} from "./types"

/* ------------------------------------------------------------------ helpers */

type Content = ReadonlyArray<{ type: string; text?: string }> | undefined

/** Tool output kept in the view is capped (the tail wins) so snapshots stay small. */
export const MAX_OUTPUT = 20_000

/** Join the text parts of a tool result, inserting a newline only where one is missing. */
export function contentText(content: Content): string {
  let out = ""
  for (const part of content ?? []) {
    if (part.type !== "text" || !part.text) continue
    if (out && !out.endsWith("\n")) out += "\n"
    out += part.text
  }
  return out.length > MAX_OUTPUT ? `…${out.slice(out.length - MAX_OUTPUT)}` : out
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const errorText = (e: unknown): string | undefined => {
  if (!e) return undefined
  if (typeof e === "string") return e
  const m = (e as { message?: unknown }).message
  return typeof m === "string" ? m : "Failed"
}

const replaceAt = <T>(list: readonly T[], index: number, value: T): T[] => {
  const next = list.slice()
  next[index] = value
  return next
}

/* ------------------------------------------------------------------ history */

function toolFromHistory(c: any): ToolItem {
  const st = c.state ?? {}
  const status = st.status === "completed" || st.status === "error" || st.status === "running" ? st.status : "streaming"
  return {
    kind: "tool",
    id: c.id,
    name: c.name,
    status,
    input: typeof st.input === "string" ? {} : record(st.input),
    inputText: typeof st.input === "string" ? st.input : undefined,
    metadata: record(st.metadata),
    output: contentText(st.content),
    error: status === "error" ? errorText(st.error) : undefined,
    created: c.time?.created,
    completed: c.time?.completed,
  }
}

function stepFromHistory(m: any): StepView {
  const items: StepItem[] = []
  let ti = 0
  let ri = 0
  for (const c of m.content ?? []) {
    if (c.type === "text") items.push({ kind: "text", key: `text:${ti++}`, text: c.text ?? "", streaming: false })
    else if (c.type === "reasoning") items.push({ kind: "reasoning", key: `reasoning:${ri++}`, text: c.text ?? "", streaming: false })
    else if (c.type === "tool") items.push(toolFromHistory(c))
  }
  return {
    id: m.id,
    agent: m.agent,
    started: m.time?.created,
    completed: m.time?.completed,
    finish: m.finish,
    error: errorText(m.error),
    items,
  }
}

/** Build a view from `message.list` output (any order is normalised to oldest first by the caller). */
export function viewFromMessages(messages: ReadonlyArray<SessionMessageInfo>): SessionView {
  const turns: TurnView[] = []
  let current: TurnView | undefined
  for (const raw of messages) {
    const m = raw as any
    if (m.type === "user") {
      current = { id: m.id, user: { id: m.id, text: m.text ?? "", created: m.time?.created }, steps: [], started: m.time?.created }
      turns.push(current)
    } else if (m.type === "assistant") {
      if (!current || current.outcome) {
        current = { id: `turn:${m.id}`, steps: [], started: m.time?.created }
        turns.push(current)
      }
      current.steps = [...current.steps, stepFromHistory(m)]
    } else if (m.type === "idle") {
      if (current) {
        current.outcome = m.outcome
        current.ended = m.time?.created
        current.error = errorText(m.error)
        current = undefined
      }
    } else if (m.type === "compaction" && m.status === "completed") {
      turns.push(compactionTurn(m.id, m.summary, m.reason, m.time?.created))
      current = undefined
    }
  }
  return { turns, queued: [], loaded: true }
}

function compactionTurn(id: string, summary: unknown, reason: unknown, created: number | undefined): TurnView {
  return {
    id: `compaction:${id}`,
    compaction: { summary: typeof summary === "string" ? summary : "", reason: typeof reason === "string" ? reason : undefined, created },
    steps: [],
    started: created,
    ended: created,
    outcome: "succeeded",
  }
}

/**
 * Put an older chunk in front of a view ("Show earlier messages"). A turn of the older chunk that was cut off by
 * the chunk boundary has no idle marker; it is closed so it is not shown as still running.
 */
export function prependView(view: SessionView, older: SessionView): SessionView {
  const closed = older.turns.map((t) => (t.outcome || t.compaction ? t : { ...t, outcome: "succeeded" as const }))
  return { ...view, turns: [...closed, ...view.turns] }
}

/* -------------------------------------------------------------------- events */

function ensureTurn(view: SessionView, created: number | undefined): { view: SessionView; index: number } {
  const last = view.turns[view.turns.length - 1]
  if (last && !last.outcome) return { view, index: view.turns.length - 1 }
  const turn: TurnView = { id: `turn:live:${view.turns.length}`, steps: [], started: created }
  return { view: { ...view, turns: [...view.turns, turn] }, index: view.turns.length }
}

/** Find the step for an assistant message across all turns, newest first. */
function locateStep(view: SessionView, id: string): { turn: number; step: number } | undefined {
  for (let t = view.turns.length - 1; t >= 0; t--) {
    const steps = view.turns[t]!.steps
    for (let s = steps.length - 1; s >= 0; s--) if (steps[s]!.id === id) return { turn: t, step: s }
  }
  return undefined
}

function updateStep(
  view: SessionView,
  id: string,
  created: number | undefined,
  fn: (step: StepView) => StepView,
): SessionView {
  let v = view
  let at = locateStep(v, id)
  if (!at) {
    const ensured = ensureTurn(v, created)
    v = ensured.view
    const turn = v.turns[ensured.index]!
    const step: StepView = { id, started: created, items: [] }
    v = { ...v, turns: replaceAt(v.turns, ensured.index, { ...turn, steps: [...turn.steps, step] }) }
    at = { turn: ensured.index, step: turn.steps.length }
  }
  const turn = v.turns[at.turn]!
  const next = fn(turn.steps[at.step]!)
  return { ...v, turns: replaceAt(v.turns, at.turn, { ...turn, steps: replaceAt(turn.steps, at.step, next) }) }
}

function upsertItem(step: StepView, match: (i: StepItem) => boolean, make: () => StepItem, patch: (i: StepItem) => StepItem): StepView {
  const idx = step.items.findIndex(match)
  if (idx === -1) return { ...step, items: [...step.items, patch(make())] }
  return { ...step, items: replaceAt(step.items, idx, patch(step.items[idx]!)) }
}

const emptyTool = (id: string, name = "tool", created?: number): ToolItem => ({
  kind: "tool", id, name, status: "streaming", input: {}, metadata: {}, output: "", created,
})

function patchTool(step: StepView, id: string, created: number | undefined, patch: (t: ToolItem) => ToolItem): StepView {
  return upsertItem(step, (i) => i.kind === "tool" && i.id === id, () => emptyTool(id, "tool", created), (i) => patch(i as ToolItem))
}

function patchText(step: StepView, kind: "text" | "reasoning", ordinal: number, patch: (text: string) => { text: string; streaming: boolean }): StepView {
  const key = `${kind}:${ordinal}`
  return upsertItem(
    step,
    (i) => i.kind === kind && i.key === key,
    () => ({ kind, key, text: "", streaming: true }) as StepItem,
    (i) => ({ ...(i as { kind: "text" | "reasoning"; key: string }), ...patch((i as { text: string }).text) }) as StepItem,
  )
}

function finishTurn(view: SessionView, outcome: Outcome, created: number | undefined, error?: string): SessionView {
  const idx = view.turns.length - 1
  const turn = view.turns[idx]
  if (!turn || turn.outcome) return view
  // Anything still marked running when the turn ends will never complete.
  const steps = turn.steps.map((s) => ({
    ...s,
    items: s.items.map((i) => (i.kind === "tool" || !i.streaming ? i : { ...i, streaming: false })),
  }))
  return { ...view, turns: replaceAt(view.turns, idx, { ...turn, steps, outcome, ended: created, error }) }
}

/**
 * Apply one live event to a session view. Returns the same object when the event is irrelevant,
 * so callers can cheaply detect "no change". `sessionID` filtering is the caller's job.
 */
export function applyEvent(view: SessionView, ev: EventEnvelope): SessionView {
  const d = ev.data ?? {}
  const t = ev.created
  switch (ev.type) {
    case "session.inbox.enqueued": {
      const item = d.item
      if (item?.type !== "user" || view.queued.some((q) => q.id === d.inboxID)) return view
      return { ...view, queued: [...view.queued, { id: d.inboxID, text: item.payload?.text ?? "" }] }
    }
    case "session.inbox.delivered": {
      const queued = view.queued.find((q) => q.id === d.inboxID)
      const rest = view.queued.filter((q) => q.id !== d.inboxID)
      if (!queued || view.turns.some((turn) => turn.user?.id === d.inboxID)) return { ...view, queued: rest }
      const last = view.turns[view.turns.length - 1]
      // A message delivered mid-turn (steer) belongs to the running turn's context, not a new turn.
      if (last && !last.outcome && last.steps.length > 0) return { ...view, queued: rest }
      const turn: TurnView = { id: d.inboxID, user: { id: d.inboxID, text: queued.text, created: t }, steps: [], started: t }
      const turns = last && !last.outcome && !last.user && last.steps.length === 0 ? replaceAt(view.turns, view.turns.length - 1, turn) : [...view.turns, turn]
      return { ...view, queued: rest, turns }
    }
    case "session.step.started":
      return updateStep(view, d.assistantMessageID, d.started ?? t, (s) => ({ ...s, agent: d.agent, started: d.started ?? t }))
    case "session.step.streamed":
      return updateStep(view, d.assistantMessageID, t, (s) => s)
    case "session.step.ended":
      return updateStep(view, d.assistantMessageID, t, (s) => ({ ...s, finish: d.finish, completed: t }))
    case "session.step.failed":
      return updateStep(view, d.assistantMessageID, t, (s) => ({ ...s, completed: t, error: errorText(d.error) ?? "Step failed" }))
    case "session.text.started":
      return updateStep(view, d.assistantMessageID, t, (s) => patchText(s, "text", d.ordinal, (x) => ({ text: x, streaming: true })))
    case "session.text.delta":
      return updateStep(view, d.assistantMessageID, t, (s) => patchText(s, "text", d.ordinal, (x) => ({ text: x + (d.delta ?? ""), streaming: true })))
    case "session.text.ended":
      return updateStep(view, d.assistantMessageID, t, (s) => patchText(s, "text", d.ordinal, (x) => ({ text: d.text ?? x, streaming: false })))
    case "session.reasoning.started":
      return updateStep(view, d.assistantMessageID, t, (s) => patchText(s, "reasoning", d.ordinal, (x) => ({ text: x, streaming: true })))
    case "session.reasoning.delta":
      return updateStep(view, d.assistantMessageID, t, (s) => patchText(s, "reasoning", d.ordinal, (x) => ({ text: x + (d.delta ?? ""), streaming: true })))
    case "session.reasoning.ended":
      return updateStep(view, d.assistantMessageID, t, (s) => patchText(s, "reasoning", d.ordinal, (x) => ({ text: d.text ?? x, streaming: false })))
    case "session.tool.input.started":
      return updateStep(view, d.assistantMessageID, t, (s) => patchTool(s, d.id, t, (x) => ({ ...x, name: d.name ?? x.name, created: x.created ?? t })))
    case "session.tool.input.delta":
      return updateStep(view, d.assistantMessageID, t, (s) => patchTool(s, d.id, t, (x) => ({ ...x, inputText: (x.inputText ?? "") + (d.delta ?? "") })))
    case "session.tool.input.ended":
      return updateStep(view, d.assistantMessageID, t, (s) => patchTool(s, d.id, t, (x) => ({ ...x, inputText: d.text ?? x.inputText })))
    case "session.tool.called":
      return updateStep(view, d.assistantMessageID, t, (s) => patchTool(s, d.id, t, (x) => ({ ...x, status: "running", input: record(d.input) })))
    case "session.tool.progress":
      return updateStep(view, d.assistantMessageID, t, (s) => patchTool(s, d.id, t, (x) => ({ ...x, metadata: { ...x.metadata, ...record(d.metadata) } })))
    case "session.tool.success":
      return updateStep(view, d.assistantMessageID, t, (s) =>
        patchTool(s, d.id, t, (x) => ({
          ...x,
          status: "completed",
          output: contentText(d.content),
          metadata: { ...x.metadata, ...record(d.metadata) },
          completed: t,
        })),
      )
    case "session.tool.failed":
      return updateStep(view, d.assistantMessageID, t, (s) =>
        patchTool(s, d.id, t, (x) => ({
          ...x,
          status: "error",
          error: errorText(d.error) ?? "Failed",
          output: d.content ? contentText(d.content) : x.output,
          metadata: { ...x.metadata, ...record(d.metadata) },
          completed: t,
        })),
      )
    case "session.compaction.ended": {
      // The summary replaces what came before. Close any open turn first so the marker sits after it.
      const closed = view.turns.length && !view.turns[view.turns.length - 1]!.outcome ? finishTurn(view, "succeeded", t) : view
      return { ...closed, turns: [...closed.turns, compactionTurn(`live:${ev.id ?? closed.turns.length}`, d.text, d.reason, t)] }
    }
    case "session.execution.succeeded":
      return finishTurn(view, "succeeded", t)
    case "session.execution.failed":
      return finishTurn(view, "failed", t, errorText(d.error))
    case "session.execution.interrupted":
      return finishTurn(view, "interrupted", t)
    case "session.revert.staged":
    case "session.revert.cleared":
    case "session.revert.committed":
      return applyRevertEvent(view, ev.type, d)
    default:
      return view
  }
}

export { emptyView }

/** True when the last turn is still in flight. */
export function isRunning(view: SessionView): boolean {
  const last = view.turns[view.turns.length - 1]
  return !!last && !last.outcome && (last.steps.length > 0 || !!last.user)
}

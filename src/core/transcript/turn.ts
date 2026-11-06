import { formatDuration, plural } from "../format"
import type { StepItem, StepView, ToolItem, TurnView } from "./types"

/** Split a finished turn into the folded steps and the final answer (the last text of the last step). */
export function splitTurn(turn: TurnView): { work: StepView[]; answer?: { text: string; key: string } } {
  const steps = turn.steps
  const last = steps[steps.length - 1]
  const lastText = last ? [...last.items].reverse().find((i): i is Extract<StepItem, { kind: "text" }> => i.kind === "text" && i.text.trim().length > 0) : undefined
  if (!last || !lastText || last.finish === "tool-calls") return { work: steps }
  const items = last.items.filter((i) => i !== lastText)
  const work = items.length > 0 ? [...steps.slice(0, -1), { ...last, items }] : steps.slice(0, -1)
  return { work, answer: { text: lastText.text, key: lastText.key } }
}

/** Number of "steps" shown in the fold: tool calls, or the step messages when no tools ran. */
export function countSteps(work: StepView[]): number {
  const tools = work.reduce((n, s) => n + s.items.filter((i) => i.kind === "tool").length, 0)
  return tools > 0 ? tools : work.filter((s) => s.items.some((i) => i.kind !== "text" || i.text.trim())).length
}

/** The latest time any step, text or tool of the turn reports. Undefined when nothing carries a time. */
export function lastActivity(turn: TurnView): number | undefined {
  let last: number | undefined
  const see = (t: number | undefined) => {
    if (typeof t === "number" && Number.isFinite(t) && (last === undefined || t > last)) last = t
  }
  for (const s of turn.steps) {
    see(s.started)
    see(s.completed)
    for (const i of s.items) if (i.kind === "tool") { see(i.created); see(i.completed) }
  }
  return last
}

/**
 * A turn that is over but has no execution marker (history that lost its `idle` message, a turn cut by a chunk edge,
 * an event that never reached the reducer) still gets an outcome and an end time, so it folds and shows its time.
 * Only the turn that is really running (the last one, in a running session) and turns with nothing in them are left alone.
 */
export function settledTurn(turn: TurnView, ctx: { last: boolean; running: boolean }): TurnView {
  if (turn.outcome || turn.compaction) return turn
  if (ctx.last && ctx.running) return turn
  const hasAnswer = turn.steps.some((s) => s.items.some((i) => i.kind === "text" && i.text.trim().length > 0))
  if (turn.steps.length === 0 || (!hasAnswer && lastActivity(turn) === undefined && turn.steps.every((s) => s.items.length === 0))) return turn
  return { ...turn, outcome: "succeeded", ended: turn.ended ?? lastActivity(turn) ?? turn.started }
}

export function turnDuration(turn: TurnView): number | undefined {
  if (turn.started === undefined || turn.ended === undefined) return undefined
  return Math.max(0, turn.ended - turn.started)
}

/** `3 steps completed · 42s`. Empty when there is nothing to fold. */
export function foldLabel(turn: TurnView, work: StepView[]): string {
  const n = countSteps(work)
  if (n === 0) return ""
  const d = turnDuration(turn)
  const verb = turn.outcome === "failed" ? "failed" : turn.outcome === "interrupted" ? "interrupted" : "completed"
  return `${plural(n, "step")} ${verb}${d !== undefined ? ` · ${formatDuration(d)}` : ""}`
}

export function allTools(turn: TurnView): ToolItem[] {
  return turn.steps.flatMap((s) => s.items.filter((i): i is ToolItem => i.kind === "tool"))
}

/** Latest tool in the session that is still in flight, used to place the spinner. */
export function runningTool(turns: TurnView[]): ToolItem | undefined {
  const last = turns[turns.length - 1]
  if (!last || last.outcome) return undefined
  return allTools(last).reverse().find((t) => t.status === "running" || t.status === "streaming")
}

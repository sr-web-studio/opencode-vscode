/**
 * Context usage of a session, as OpenCode's own clients show it: the tokens of the latest assistant step that reported
 * usage, taken after the last completed compaction and before a staged revert boundary. The percentage needs the
 * model's context window; without it only the count is shown.
 */
import type { SlimModel } from "./api"
import { findModel } from "./models"
import { boundaryMissing, visibleTurns } from "./transcript/revert"
import type { SessionView } from "./transcript/types"

/** Sum of every token kind of one assistant step (`input + output + reasoning + cache read + cache write`). */
export function tokenTotal(tokens: unknown): number | undefined {
  if (!tokens || typeof tokens !== "object") return undefined
  const t = tokens as { input?: unknown; output?: unknown; reasoning?: unknown; cache?: { read?: unknown; write?: unknown } }
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
  return n(t.input) + n(t.output) + n(t.reasoning) + n(t.cache?.read) + n(t.cache?.write)
}

export type ContextUsage = {
  total: number
  /** The model's context window, when the catalog knows it. */
  limit?: number
  /** `total / limit` in whole percent. */
  percent?: number
}

/** The usage to show for a transcript, or undefined while no step reported any. */
export function contextUsage(view: SessionView, models: ReadonlyArray<SlimModel>): ContextUsage | undefined {
  // Same rule as OpenCode's own `lastAssistantWithUsage`: a staged revert whose boundary is not in the view gives
  // nothing; otherwise the latest step with usage before the boundary and after the last completed compaction.
  if (view.revert && boundaryMissing(view)) return undefined
  const turns = visibleTurns(view)
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!
    // A completed compaction inside this turn sits after the first `stepsBefore` steps: only later steps count.
    const compacted = turn.compacted && !turn.compacted.status ? turn.compacted : undefined
    const first = compacted ? (compacted.stepsBefore ?? turn.steps.length) : 0
    for (let s = turn.steps.length - 1; s >= first; s--) {
      const step = turn.steps[s]!
      if (step.tokens === undefined) continue
      const limit = findModel(models, step.model)?.contextLimit
      const known = typeof limit === "number" && limit > 0 ? limit : undefined
      return { total: step.tokens, ...(known ? { limit: known, percent: Math.round((step.tokens / known) * 100) } : {}) }
    }
    if (compacted || (turn.compaction && !turn.compaction.status)) return undefined
  }
  return undefined
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 0 })
const full = new Intl.NumberFormat("en-US")

/** "12k · 6%", or "12k" when the window is unknown. */
export function contextLabel(usage: ContextUsage): string {
  const count = compact.format(usage.total).toLowerCase()
  return usage.percent === undefined ? count : `${count} · ${usage.percent}%`
}

/** The tooltip with the exact numbers. */
export function contextTitle(usage: ContextUsage): string {
  const used = `${full.format(usage.total)} tokens in the context`
  return usage.limit && usage.percent !== undefined ? `${used} · ${usage.percent}% of ${full.format(usage.limit)}` : used
}

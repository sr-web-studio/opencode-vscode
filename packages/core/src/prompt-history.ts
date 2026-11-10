/**
 * Up-arrow recall for the prompt box: the prompts the user already sent in the current session, newest first.
 *
 * Only text is recalled (never attachments), and only turns that are still visible: a staged revert hides the prompts
 * it would bring back. Pure, so the order and the walking rules are tested on their own.
 */
import { visibleTurns } from "./transcript/revert"
import type { SessionView } from "./transcript/types"

/** Plenty for a long session; the box never needs to walk further than anyone would press Up. */
export const PROMPT_HISTORY_LIMIT = 100

/** The user's prompts of this session, newest first, without empty ones or the same prompt repeated straight after itself. */
export function promptHistory(view: SessionView, limit = PROMPT_HISTORY_LIMIT): string[] {
  const out: string[] = []
  const turns = visibleTurns(view)
  for (let i = turns.length - 1; i >= 0 && out.length < limit; i--) {
    const text = turns[i]?.user?.text
    if (!text || !text.trim()) continue
    if (out[out.length - 1] === text) continue
    out.push(text)
  }
  return out
}

/** A step of the walk: where it now is in `history`, and the text the box shows. */
export type RecallStep = { index: number; text: string }

/**
 * One prompt older. `index` -1 means the box is not walking yet; undefined when there is nothing older to show, so the
 * key keeps its usual meaning.
 */
export function recallOlder(history: readonly string[], index: number): RecallStep | undefined {
  const next = index < 0 ? 0 : index + 1
  const text = history[next]
  return text === undefined ? undefined : { index: next, text }
}

/** One prompt newer. Past the newest the box goes back to empty and the walk ends (`index` -1). */
export function recallNewer(history: readonly string[], index: number): RecallStep {
  const next = index - 1
  const text = next < 0 ? undefined : history[next]
  return text === undefined ? { index: -1, text: "" } : { index: next, text }
}

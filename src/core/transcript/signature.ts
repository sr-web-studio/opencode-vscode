import type { SessionView } from "./types"

/**
 * A cheap fingerprint of "what the user would see change at the bottom". The webview receives a fresh copy of the
 * state on every message, so object identity says nothing; this says whether there is really new content.
 */
export function contentSignature(view: SessionView, extra = 0): string {
  const turns = view.turns
  const last = turns[turns.length - 1]
  let tail = ""
  if (last) {
    tail = `${last.id}:${last.outcome ?? "-"}:${last.steps.length}`
    const step = last.steps[last.steps.length - 1]
    if (step) {
      for (const i of step.items) tail += i.kind === "tool" ? `|${i.id}${i.status}${i.output.length}` : `|${i.key}${i.text.length}${i.streaming ? "s" : ""}`
      if (step.error) tail += "!"
    }
  }
  return `${turns.length}/${view.queued.length}/${extra}/${view.revert?.messageID ?? ""}/${tail}`
}

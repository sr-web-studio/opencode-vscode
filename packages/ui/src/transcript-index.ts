import type { TurnView } from "@occ/core/transcript/types"

/**
 * The tool ids of each turn, computed once per turn object. The reducer is immutable and shares every turn a delta did
 * not touch, so a streaming answer only recomputes the turn it is writing; the transcript needs the ids on every state
 * message to place permission requests under their tool line.
 */
const cache = new WeakMap<TurnView, readonly string[]>()

export function turnToolIds(turn: TurnView): readonly string[] {
  const cached = cache.get(turn)
  if (cached) return cached
  const ids: string[] = []
  for (const step of turn.steps) for (const item of step.items) if (item.kind === "tool") ids.push(item.id)
  cache.set(turn, ids)
  return ids
}

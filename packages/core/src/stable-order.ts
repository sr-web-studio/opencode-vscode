/**
 * Keep a list's rows in place while the user is looking at it.
 *
 * The shared activity order (`activity-order.ts`) decides placement when a list opens; live events can then make a
 * row more urgent. If the list re-sorted on every event, a row could move under the user's pointer or finger between
 * reading it and clicking it. This helper holds the order instead: ids that were already there keep their old
 * relative order, ids that are new are inserted where the current shared order puts them, and ids that are gone
 * disappear. The next open sorts afresh.
 *
 * Pure: no DOM, no clock, no client. Both the Android drawer and the in-chat sessions pane use it.
 */

/**
 * The order a list keeps while the user is looking at it: `previousIds` is the frozen order, `nextSorted` the same
 * ids (plus any new ones) in the current shared order. Returns the ids to render.
 */
export function stableOrder(previousIds: ReadonlyArray<string>, nextSorted: ReadonlyArray<string>): string[] {
  const live = new Set(nextSorted)
  const kept = previousIds.filter((id) => live.has(id))
  const rank = new Map(nextSorted.map((id, index) => [id, index]))
  const result = [...kept]
  const known = new Set(kept)
  for (const id of nextSorted) {
    if (known.has(id)) continue
    const at = result.findIndex((existing) => (rank.get(existing) ?? 0) > (rank.get(id) ?? 0))
    if (at < 0) result.push(id)
    else result.splice(at, 0, id)
    known.add(id)
  }
  return result
}

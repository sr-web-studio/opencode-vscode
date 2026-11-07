/**
 * A Svelte-reactive view of something with `subscribe(listener)` that replays its state (a `Controller`, a `WorkerTab`).
 * Call it while a component initializes: it unsubscribes by itself when the component is destroyed.
 */
import { onDestroy } from "svelte"
import type { AppState } from "@occ/core/protocol"

export function liveState(source: { subscribe(listener: (s: AppState) => void): () => void }): { readonly state: AppState | undefined } {
  let state = $state.raw<AppState | undefined>()
  const off = source.subscribe((s) => (state = s))
  onDestroy(off)
  return {
    get state() {
      return state
    },
  }
}

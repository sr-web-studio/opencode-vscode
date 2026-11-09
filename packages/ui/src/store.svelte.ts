import type { Action, AppState, ToWebview } from "@occ/core/protocol"
import type { HostBridge } from "./bridge"

/** Reactive view of the host's state plus a typed `dispatch`. One per webview. */
export class Store {
  state = $state.raw<AppState | undefined>(undefined)
  /** Bumped by the host command `newSession`; App reacts by asking for a draft. */
  newSessionTick = $state(0)
  private off: () => void
  private dictationHandlers = new Set<(m: Extract<ToWebview, { type: "dictation" }>) => void>()

  constructor(readonly bridge: HostBridge) {
    this.off = bridge.onMessage((m: ToWebview) => {
      if (m.type === "state") this.state = m.state
      else if (m.type === "folders") {
        // A folder the view is not showing changed: only the dropdown's dots need the update, not the active state.
        if (this.state) this.state = { ...this.state, folders: m.folders }
      } else if (m.type === "command" && m.name === "newSession") this.newSessionTick++
      else if (m.type === "dictation") for (const h of this.dictationHandlers) h(m)
    })
    this.dispatch({ type: "ready" })
  }

  /** Dictated text for the prompt box. Returns the unsubscribe function. */
  onDictation(handler: (m: Extract<ToWebview, { type: "dictation" }>) => void): () => void {
    this.dictationHandlers.add(handler)
    return () => this.dictationHandlers.delete(handler)
  }

  dispatch(action: Action) {
    this.bridge.postToHost({ type: "action", action })
  }

  dispose() {
    this.off()
  }
}

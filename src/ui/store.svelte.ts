import type { Action, AppState, ToWebview } from "../core/protocol"
import type { HostBridge } from "./bridge"

/** Reactive view of the host's state plus a typed `dispatch`. One per webview. */
export class Store {
  state = $state.raw<AppState | undefined>(undefined)
  /** Bumped by the host command `newSession`; App reacts by asking for a draft. */
  newSessionTick = $state(0)
  private off: () => void

  constructor(readonly bridge: HostBridge) {
    this.off = bridge.onMessage((m: ToWebview) => {
      if (m.type === "state") this.state = m.state
      else if (m.type === "command" && m.name === "newSession") this.newSessionTick++
    })
    this.dispatch({ type: "ready" })
  }

  dispatch(action: Action) {
    this.bridge.postToHost({ type: "action", action })
  }

  dispose() {
    this.off()
  }
}

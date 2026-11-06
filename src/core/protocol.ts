import type { FormInfo, PermissionRequest, SessionInfo, SlimModel, SlimProvider } from "./api"
import type { ViewTarget } from "./draft"
import type { ModelSelection } from "./models"
import type { SessionView } from "./transcript/types"

export type ConnectionState = {
  status: "connecting" | "connected" | "disconnected" | "setup" | "error"
  message?: string
  url?: string
  version?: string
}

/** Settings the webview follows live. Mirrors the `opencode.*` configuration keys. */
export type ViewSettings = {
  collapseCompletedSteps: boolean
  expandToolDetails: boolean
  showReasoning: "collapsed" | "expanded" | "hidden"
  /** Resolved px size (setting, else chat.editor.fontSize, else 13). */
  fontSize: number
  todoDefaultExpanded: boolean
}

export const defaultViewSettings: ViewSettings = {
  collapseCompletedSteps: true,
  expandToolDetails: false,
  showReasoning: "collapsed",
  fontSize: 13,
  todoDefaultExpanded: false,
}

export type AgentSummary = { id: string; name: string; description?: string }

/** Everything the UI renders. Plain data: it crosses postMessage (VS Code) or stays in memory (browser). */
export type AppState = {
  connection: ConnectionState
  settings: ViewSettings
  directory: string
  folderName: string
  /** `~`-shortened project path for display. */
  displayPath: string
  target: ViewTarget
  /** Root sessions of this project, newest first. */
  sessions: SessionInfo[]
  archived: SessionInfo[]
  showArchived: boolean
  sessionsLoaded: boolean
  running: string[]
  waiting: string[]
  /** Current session's transcript (empty for a draft). */
  view: SessionView
  loadingView: boolean
  /** Pending permission requests of the current session. */
  permissions: PermissionRequest[]
  /** Oldest pending form of the current session. */
  form?: FormInfo
  agents: AgentSummary[]
  models: SlimModel[]
  providers: SlimProvider[]
  /** Effective selection for the current session or draft. */
  agent?: string
  model?: ModelSelection
  /** Last send/stop/switch error, shown once and cleared by the next action. */
  error?: string
  /** True while the first prompt of a draft is being sent (create → prompt). */
  sending: boolean
  /** Bumped when `+` is pressed inside an empty draft: the prompt box focuses. */
  focusTick: number
  /** Bumped when a fresh draft opens: the prompt box clears. */
  draftEpoch: number
}

export type Action =
  | { type: "ready" }
  | { type: "openSession"; id: string }
  | { type: "newDraft"; hasText: boolean }
  | { type: "send"; text: string }
  | { type: "stop" }
  | { type: "pickAgent"; id: string }
  | { type: "pickModel"; model: ModelSelection }
  | { type: "permission"; sessionID: string; requestID: string; decision: "once" | "always" | "reject" }
  | { type: "formReply"; answer: Record<string, string | number | boolean | string[]> }
  | { type: "formCancel" }
  | { type: "toggleArchived" }
  | { type: "refresh" }
  | { type: "dismissError" }

/** Messages from the extension host to the webview. */
export type ToWebview =
  | { type: "state"; state: AppState }
  | { type: "visible"; visible: boolean }

/** Host-side effects the webview asks for (files, terminals, links). Not state changes. */
export type HostRequest =
  | { type: "openFile"; path: string; line?: number }
  | { type: "openDiff"; file: string; patch: string }
  | { type: "showTerminal"; shellID: string; title?: string }
  | { type: "openExternal"; url: string }
  | { type: "setCliPath" }
  | { type: "reconnect" }
  | { type: "notify"; level: "info" | "warning" | "error"; message: string }
  | { type: "storage.set"; key: string; value: unknown }
  | { type: "focusState"; focused: boolean }

/** Messages from the webview to the extension host. */
export type ToHost = { type: "action"; action: Action } | { type: "host"; request: HostRequest }

/** View model of a session transcript. Plain, immutable data: safe to hold in Svelte `$state.raw`. */

export type ToolStatus = "streaming" | "running" | "completed" | "error"

export type ToolItem = {
  kind: "tool"
  id: string
  name: string
  status: ToolStatus
  input: Record<string, unknown>
  inputText?: string
  metadata: Record<string, unknown>
  output: string
  error?: string
  created?: number
  completed?: number
}

export type TextItem = { kind: "text"; key: string; text: string; streaming: boolean }
export type ReasoningItem = { kind: "reasoning"; key: string; text: string; streaming: boolean }
export type StepItem = TextItem | ReasoningItem | ToolItem

export type StepView = {
  id: string
  agent?: string
  started?: number
  completed?: number
  finish?: string
  error?: string
  items: StepItem[]
}

export type Outcome = "succeeded" | "failed" | "interrupted"

/** A completed compaction: the summary that replaced everything before it. Shown as one muted, collapsible line. */
export type CompactionView = { summary: string; reason?: string; created?: number }

export type TurnView = {
  /** Message id of the user message, or a synthetic id when the turn has none. */
  id: string
  /** Set on a marker turn that holds only a compaction summary (no user text, no steps). */
  compaction?: CompactionView
  user?: { id: string; text: string; created?: number }
  steps: StepView[]
  started?: number
  ended?: number
  /** Undefined while the turn is still running (or its idle marker was not seen). */
  outcome?: Outcome
  error?: string
}

export type QueuedMessage = { id: string; text: string }

/** A staged rollback: the boundary prompt and how many files the server restored (0 = none, or no snapshot). */
export type RevertState = { messageID: string; files: number }

export type SessionView = {
  turns: TurnView[]
  queued: QueuedMessage[]
  loaded: boolean
  /** Set while a rollback is staged. The turns from the boundary prompt on are hidden (see `visibleTurns`). */
  revert?: RevertState
}

export const emptyView = (): SessionView => ({ turns: [], queued: [], loaded: false })

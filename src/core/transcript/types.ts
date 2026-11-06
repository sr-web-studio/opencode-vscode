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

export type TurnView = {
  /** Message id of the user message, or a synthetic id when the turn has none. */
  id: string
  user?: { id: string; text: string; created?: number }
  steps: StepView[]
  started?: number
  ended?: number
  /** Undefined while the turn is still running (or its idle marker was not seen). */
  outcome?: Outcome
  error?: string
}

export type QueuedMessage = { id: string; text: string }

export type SessionView = {
  turns: TurnView[]
  queued: QueuedMessage[]
  loaded: boolean
}

export const emptyView = (): SessionView => ({ turns: [], queued: [], loaded: false })

/** View model of a session transcript. Plain, immutable data: safe to hold in Svelte `$state.raw`. */

export type ToolStatus = "streaming" | "running" | "completed" | "error"

/**
 * A file the tool returned with its result. `read` on an image sends the picture itself as a `data:` URI, so the
 * transcript can show it without asking the server for the file again (which may be outside the project).
 */
export type ToolAttachment = {
  /** Well-formed `image/*` type. */
  mime: string
  /** The path or name the tool read, for the caption. */
  name?: string
  /** Inline `data:<mime>;base64,…` URI of the bytes. */
  uri: string
}

export type ToolItem = {
  kind: "tool"
  id: string
  name: string
  status: ToolStatus
  input: Record<string, unknown>
  inputText?: string
  metadata: Record<string, unknown>
  output: string
  /** Image files of the tool result (V2 sends them as `file` content parts). */
  attachments?: ToolAttachment[]
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

/**
 * A compaction: the summary that replaced everything before it. Shown as one muted, collapsible line.
 * `status` is unset once it completed. `running`: the summary is still being written (`summary` is the text so far).
 * `failed` / `cancelled` (the user pressed Stop): `error` says why.
 */
export type CompactionView = { summary: string; reason?: string; created?: number; status?: "running" | "failed" | "cancelled"; error?: string }

export type TurnView = {
  /** Message id of the user message, or a synthetic id when the turn has none. */
  id: string
  /** Set on a marker turn that holds only a compaction summary (no user text, no steps). */
  compaction?: CompactionView
  /** An (auto) compaction that happened inside this turn: shown as a muted line between the prompt and the answer. */
  compacted?: CompactionView
  user?: { id: string; text: string; created?: number; files?: FileChip[] }
  steps: StepView[]
  started?: number
  ended?: number
  /** Undefined while the turn is still running (or its idle marker was not seen). */
  outcome?: Outcome
  error?: string
}

/** An attachment of a sent prompt, shown as a chip under its text. Never carries the file data. */
export type FileChip = {
  name: string
  mime?: string
  /** `file://` URI of an attached file: clicking the chip opens it. Never a `data:` URI. */
  uri?: string
  /** Where an image's bytes are. The host serves them on request, so the state never carries base64. */
  ref?: { messageID: string; index: number }
}

/**
 * A prompt waiting in the session inbox. `queue` waits until the agent finishes its work; `steer` is handed to the
 * agent at its next step ("Send now").
 */
export type QueuedMessage = { id: string; text: string; files?: FileChip[]; delivery: "queue" | "steer" }

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

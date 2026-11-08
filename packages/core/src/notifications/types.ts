/** Notification model. Everything here is JSON-serialisable so a later companion command or push can take it as-is. */

export type NoticeKind = "permission" | "question" | "completed" | "failed" | "worker" | "shell"

export const isAttention = (k: NoticeKind) => k === "permission" || k === "question"

export type NoticeActionID = "open" | "allow" | "deny"

export type NoticeAction = { id: NoticeActionID; label: string }

export type Notice = {
  /** Stable per session: a new notice for the same session replaces the old one. */
  id: string
  kind: NoticeKind
  sessionID: string
  /** `warning` for attention, `info` for finished/failed. */
  severity: "warning" | "info"
  title: string
  body: string
  actions: NoticeAction[]
  /** Set for permission notices (needed for allow/deny) and for question notices (needed to auto-clear). */
  requestID?: string
  directory?: string
}

/**
 * Delivery. The VS Code implementation uses `showWarningMessage` / `showInformationMessage`.
 * An OS-notifier companion (`opencode.notifier.show`) or a push relay can implement the same interface
 * without touching the decision logic.
 */
export interface Notifier {
  show(notice: Notice): void | Promise<void>
  dismiss(id: string): void | Promise<void>
}

/** What the host should do when the user picks an action. */
export type NoticeCommand =
  | { type: "open"; sessionID: string }
  | { type: "permission.reply"; sessionID: string; requestID: string; decision: "once" | "reject" }

export type NotificationSettings = {
  enabled: boolean
  attention: boolean
  completed: boolean
  failed: boolean
  workers: boolean
  shells: boolean
  /** `never`: stay quiet while the window is focused and the session is on screen. `always`: notify anyway. */
  whenFocused: "never" | "always"
  /** `auto` lets a later OS notifier take over; `off` keeps notifications in VS Code only. */
  os: "auto" | "off"
}

export const defaultNotificationSettings: NotificationSettings = {
  enabled: true,
  attention: true,
  completed: true,
  failed: true,
  workers: false,
  shells: false,
  whenFocused: "never",
  os: "auto",
}

export type SessionMeta = { title?: string; parentID?: string; directory?: string }

export type UiState = { windowFocused: boolean; visibleSessionID?: string }

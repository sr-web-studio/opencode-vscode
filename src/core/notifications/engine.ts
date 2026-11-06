import { clip, firstLine } from "../format"
import type { EventEnvelope } from "../api"
import {
  isAttention,
  type Notice,
  type NoticeCommand,
  type NoticeKind,
  type Notifier,
  type NotificationSettings,
  type SessionMeta,
  type UiState,
} from "./types"

export const COALESCE_MS = 5_000

export type EngineDeps = {
  /** This window's project directory (the first workspace folder). */
  directory: string
  settings: () => NotificationSettings
  ui: () => UiState
  notifier: Notifier
  now?: () => number
  /** Session facts needed for filtering and wording. Return undefined when the session is not known. */
  session: (sessionID: string) => SessionMeta | undefined | Promise<SessionMeta | undefined>
  /** `shell.exited` carries only the shell id. The shell's `metadata.sessionID` links it to a session. */
  shellSession: (shellID: string) => string | undefined | Promise<string | undefined>
}

type Shown = { notice: Notice; at: number }

const KIND_SETTING: Record<NoticeKind, keyof NotificationSettings> = {
  permission: "attention",
  question: "attention",
  completed: "completed",
  failed: "failed",
  worker: "workers",
  shell: "shells",
}

/**
 * Decides which events become notifications. No `vscode` import: it only talks to `Notifier`.
 *
 * Rules: per-project filtering, focus suppression, one notification per session per 5 s window (attention
 * replaces whatever is showing), auto-clear when the permission/form is answered elsewhere.
 */
export class NotificationEngine {
  private shown = new Map<string, Shown>()
  private readonly now: () => number

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? Date.now
  }

  /** Feed every event from the subscription. Never throws on unknown shapes. */
  async handle(ev: EventEnvelope): Promise<void> {
    const d = ev.data ?? {}
    switch (ev.type) {
      case "permission.asked": {
        const sessionID = d.sessionID as string
        const first = Array.isArray(d.resources) && d.resources.length > 0 ? String(d.resources[0]) : ""
        return this.consider(ev, sessionID, "permission", {
          requestID: d.id,
          body: clip(d.message ? firstLine(String(d.message)) : `${d.action ?? "Permission"}${first ? `: ${firstLine(first)}` : ""}`, 140),
        })
      }
      case "form.created": {
        const form = d.form
        if (!form) return
        const field = Array.isArray(form.fields) ? form.fields[0] : undefined
        return this.consider(ev, form.sessionID, "question", {
          requestID: form.id,
          body: clip(firstLine(String(field?.description || field?.title || form.title || "Needs your input")), 140),
        })
      }
      case "session.execution.succeeded":
      case "session.execution.failed": {
        const sessionID = d.sessionID as string
        const meta = await this.deps.session(sessionID)
        const failed = ev.type === "session.execution.failed"
        const kind: NoticeKind = meta?.parentID ? "worker" : failed ? "failed" : "completed"
        return this.consider(ev, sessionID, kind, {
          meta,
          body: failed ? clip(firstLine(String(d.error?.message ?? "The turn failed")), 140) : "Turn finished",
          failed,
        })
      }
      case "shell.exited": {
        const sessionID = await this.deps.shellSession(d.id)
        if (!sessionID) return
        const bad = typeof d.exit === "number" && d.exit !== 0
        return this.consider(ev, sessionID, "shell", { body: `Background shell ${bad ? `exited with code ${d.exit}` : "finished"}`, failed: bad })
      }
      case "permission.replied":
        return this.clear(d.sessionID, d.requestID)
      case "form.replied":
      case "form.cancelled":
        return this.clear(d.sessionID, d.id)
      case "session.deleted":
        return this.clear(d.sessionID)
      default:
        return
    }
  }

  /** Drop the notice for a session. With `requestID`, only if that request is the one showing. */
  private async clear(sessionID: string, requestID?: string): Promise<void> {
    const id = noticeID(sessionID)
    const shown = this.shown.get(id)
    if (!shown) return
    if (requestID !== undefined && shown.notice.requestID !== requestID) return
    this.shown.delete(id)
    await this.deps.notifier.dismiss(id)
  }

  private async consider(
    ev: EventEnvelope,
    sessionID: string,
    kind: NoticeKind,
    opts: { meta?: SessionMeta; body: string; requestID?: string; failed?: boolean },
  ): Promise<void> {
    if (!sessionID) return
    const settings = this.deps.settings()
    if (!settings.enabled || !settings[KIND_SETTING[kind]]) return

    const meta = opts.meta ?? (await this.deps.session(sessionID))
    // Per-project filter: the event's location wins, then the session's, otherwise skip (not ours).
    const dir = ev.location?.directory ?? meta?.directory
    if (dir !== this.deps.directory) return

    const ui = this.deps.ui()
    if (settings.whenFocused === "never" && ui.windowFocused && ui.visibleSessionID === sessionID) return

    const id = noticeID(sessionID)
    const prior = this.shown.get(id)
    const t = this.now()
    // The same request can be announced twice (replay after a reconnect); the first one stands.
    if (prior && opts.requestID !== undefined && prior.notice.requestID === opts.requestID) return
    // Inside the 5 s window only attention gets through, and it replaces what is showing.
    if (prior && t - prior.at < COALESCE_MS && !isAttention(kind)) return

    const title = meta?.title?.trim() || "OpenCode"
    const bad = kind === "failed" || ((kind === "worker" || kind === "shell") && opts.failed === true)
    const notice: Notice = {
      id,
      kind,
      sessionID,
      severity: isAttention(kind) ? "warning" : "info",
      title:
        kind === "permission"
          ? `${title} needs permission`
          : kind === "question"
            ? `${title} has a question`
            : bad
              ? `${title} failed`
              : `${title} finished`,
      body: opts.body,
      actions:
        kind === "permission"
          ? [{ id: "open", label: "Open" }, { id: "allow", label: "Allow" }, { id: "deny", label: "Deny" }]
          : [{ id: "open", label: "Open" }],
      requestID: opts.requestID,
      directory: dir,
    }
    this.shown.set(id, { notice, at: t })
    await this.deps.notifier.show(notice)
  }

  /** The user picked an action (or closed the notice). Returns what the host should run. */
  resolveAction(notice: Notice, actionID: string | undefined): NoticeCommand | undefined {
    const shown = this.shown.get(notice.id)
    if (shown?.notice === notice) this.shown.delete(notice.id)
    if (actionID === "open") return { type: "open", sessionID: notice.sessionID }
    if ((actionID === "allow" || actionID === "deny") && notice.kind === "permission" && notice.requestID) {
      return { type: "permission.reply", sessionID: notice.sessionID, requestID: notice.requestID, decision: actionID === "allow" ? "once" : "reject" }
    }
    return undefined
  }
}

export const noticeID = (sessionID: string) => `session:${sessionID}`

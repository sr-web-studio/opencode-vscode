import { clip, firstLine } from "../format"
import type { EventEnvelope } from "../api"
import { withinDirectory } from "../paths"
import { isAttention, type Notice, type NoticeCommand, type NoticeKind, type Notifier, type NotificationSettings, type SessionMeta, type UiState } from "./types"

export const COALESCE_MS = 5_000

export type EngineDeps = {
  /** This window's project directory (the first workspace folder). */
  directory: string
  /**
   * Every workspace folder the window shows (VS Code multi-root). Defaults to `[directory]`. A notice for a session of
   * any of these folders is shown; `owns` still covers a session whose recorded folder is spelled differently.
   */
  directories?: () => readonly string[]
  settings: () => NotificationSettings
  ui: () => UiState
  notifier: Notifier
  now?: () => number
  /** Session facts needed for filtering and wording. Return undefined when the session is not known. */
  session: (sessionID: string) => SessionMeta | undefined | Promise<SessionMeta | undefined>
  /** `shell.exited` carries only the shell id. The shell's `metadata.sessionID` links it to a session. */
  shellSession: (shellID: string) => string | undefined | Promise<string | undefined>
  /**
   * The window already lists this session (it is in the project's session list, whatever the spelling of its folder).
   * Such a session belongs to this window even when its recorded folder does not match `directory` textually.
   */
  owns?: (sessionID: string) => boolean
  /** Debug log (OpenCode output channel). Receives one line per dropped notice: kind, session id, reason. */
  log?: (line: string) => void
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

  private async consider(ev: EventEnvelope, sessionID: string, kind: NoticeKind, opts: { meta?: SessionMeta; body: string; requestID?: string; failed?: boolean }): Promise<void> {
    if (!sessionID) {
      this.drop(kind, "-", "the event has no session id")
      return
    }
    const settings = this.deps.settings()
    if (!settings.enabled) return this.drop(kind, sessionID, "opencode.notifications.enabled is off")
    if (!settings[KIND_SETTING[kind]]) return this.drop(kind, sessionID, `opencode.notifications.${KIND_SETTING[kind]} is off`)

    const meta = opts.meta ?? (await this.deps.session(sessionID))
    // Per-project filter. Turn-end events (`session.execution.*`) carry no `location` (live-checked on 2.2.5), so they
    // depend on the session's recorded folder; question and permission events carry one. Either spelling may match, and
    // a session this window already lists is ours whatever its folder is called.
    const eventDir = ev.location?.directory
    const dir = eventDir ?? meta?.directory
    const dirs = this.deps.directories?.() ?? [this.deps.directory]
    const inProject = dirs.some((folder) => withinDirectory(eventDir, folder) || withinDirectory(meta?.directory, folder)) || this.deps.owns?.(sessionID) === true
    if (!inProject) {
      return this.drop(kind, sessionID, `not this project (event folder ${eventDir ? "differs" : "absent"}, session ${meta ? (meta.directory ? "folder differs" : "has no folder") : "not found"})`)
    }

    const ui = this.deps.ui()
    if (settings.whenFocused === "never" && ui.windowFocused && ui.visibleSessionID === sessionID) {
      return this.drop(kind, sessionID, "window focused with this session on screen (opencode.notifications.whenFocused is never)")
    }

    const id = noticeID(sessionID)
    const prior = this.shown.get(id)
    const t = this.now()
    // The same request can be announced twice (replay after a reconnect); the first one stands.
    if (prior && opts.requestID !== undefined && prior.notice.requestID === opts.requestID) return this.drop(kind, sessionID, "the same request was already announced")
    // Inside the 5 s window only attention gets through, and it replaces what is showing.
    if (prior && t - prior.at < COALESCE_MS && !isAttention(kind)) {
      return this.drop(kind, sessionID, `a ${prior.notice.kind} notice for this session was shown ${t - prior.at} ms ago (coalesce window ${COALESCE_MS} ms)`)
    }

    const title = meta?.title?.trim() || "OpenCode"
    const bad = kind === "failed" || ((kind === "worker" || kind === "shell") && opts.failed === true)
    const notice: Notice = {
      id,
      kind,
      sessionID,
      severity: isAttention(kind) ? "warning" : "info",
      title: kind === "permission" ? `${title} needs permission` : kind === "question" ? `${title} has a question` : bad ? `${title} failed` : `${title} finished`,
      body: opts.body,
      actions:
        kind === "permission"
          ? [
              { id: "open", label: "Open" },
              { id: "allow", label: "Allow" },
              { id: "deny", label: "Deny" },
            ]
          : [{ id: "open", label: "Open" }],
      requestID: opts.requestID,
      directory: dir,
    }
    this.shown.set(id, { notice, at: t })
    try {
      this.deps.log?.(`Notification shown (${kind}, session ${sessionID})`)
    } catch {
      // logging never matters more than the notice
    }
    await this.deps.notifier.show(notice)
  }

  private drop(kind: NoticeKind, sessionID: string, why: string): void {
    try {
      this.deps.log?.(`Notification dropped (${kind}, session ${sessionID}): ${why}`)
    } catch {
      // logging never matters more than the notice
    }
  }

  /** The user picked an action (or closed the notice). Returns what the host should run. */
  resolveAction(notice: Notice, actionID: string | undefined): NoticeCommand | undefined {
    const shown = this.shown.get(notice.id)
    if (shown?.notice === notice) this.shown.delete(notice.id)
    if (actionID === "open") return { type: "open", sessionID: notice.sessionID, directory: notice.directory }
    if ((actionID === "allow" || actionID === "deny") && notice.kind === "permission" && notice.requestID) {
      return { type: "permission.reply", sessionID: notice.sessionID, requestID: notice.requestID, decision: actionID === "allow" ? "once" : "reject", directory: notice.directory }
    }
    return undefined
  }
}

export const noticeID = (sessionID: string) => `session:${sessionID}`

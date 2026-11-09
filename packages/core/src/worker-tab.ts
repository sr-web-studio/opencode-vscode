import type { EventEnvelope, FormInfo, OpenCodeClient, SessionInfo } from "./api"
import type { Controller } from "./controller"
import { errorMessage } from "./errors"
import { SessionFeed } from "./feed"
import type { Action, AppState } from "./protocol"

const EMIT_MS = 30

/**
 * A read-only view of one worker (child) session: its transcript streams live, there is no prompt box, no switcher
 * and no revert. It loads like the main session (since the last compaction, with "Show earlier messages") and works
 * when opened in the middle of a run and after it ended. Pure state: the extension host puts it in a panel.
 */
export class WorkerTab {
  private readonly feed: SessionFeed
  private info?: SessionInfo
  /** This worker's own pending question (a form), if any. Answerable here: the parent's chat does not show it. */
  private form?: FormInfo
  private listeners = new Set<(s: AppState) => void>()
  private timer?: ReturnType<typeof setTimeout>
  private error?: string
  private readonly off: Array<() => void> = []
  private disposed = false

  constructor(
    private readonly controller: Controller,
    readonly sessionID: string,
  ) {
    this.feed = new SessionFeed(
      (immediate) => (immediate ? this.emitNow() : this.emit()),
      (m) => {
        this.error = m
      },
    )
    this.off.push(
      controller.observe({
        event: (ev) => this.onEvent(ev),
        resync: () => void this.start(),
      }),
      controller.subscribe(() => this.emit()),
    )
  }

  subscribe(listener: (s: AppState) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  /** Title for the editor tab. */
  get title(): string {
    const t = this.info?.title?.trim()
    return t ? `${t}` : "Worker"
  }

  /** Fetch the session and its history. Safe to call again (reconnect). */
  async start(): Promise<void> {
    const client = this.controller.api
    if (!client || this.disposed) return
    try {
      this.info = await client.session.get({ sessionID: this.sessionID })
    } catch {
      this.error = "This worker session is no longer available."
      this.emitNow()
      return
    }
    await this.loadForm(client)
    await this.feed.load(client, this.sessionID)
    this.emitNow()
  }

  /**
   * The question this worker waits on, from the server (the form list of its folder), so opening the worker after a
   * notification shows the form at once. A live `form.created` keeps it current. Failures keep what is shown.
   */
  private async loadForm(client: OpenCodeClient): Promise<void> {
    const location = this.controller.locationOf?.(this.sessionID)
    if (!location) return
    try {
      const forms = await client.form.list({ location })
      this.form = forms.data.find((form) => form.sessionID === this.sessionID)
    } catch {
      // An older server without the form list: live events still fill it.
    }
  }

  private onEvent(ev: EventEnvelope): void {
    const d = ev.data ?? {}
    // A question for this worker: its form is shown and answered on this screen (the parent's chat does not show it).
    if (ev.type === "form.created" && d.form?.sessionID === this.sessionID) {
      this.form = d.form
      this.emitNow()
      return
    }
    if ((ev.type === "form.replied" || ev.type === "form.cancelled") && d.sessionID === this.sessionID && (!this.form || d.id === this.form.id)) {
      this.form = undefined
      this.emitNow()
      return
    }
    if (ev.type === "session.renamed" && d.sessionID === this.sessionID && this.info) this.info = { ...this.info, title: d.title }
    if (ev.type === "session.model.selected" && d.sessionID === this.sessionID && this.info) this.info = { ...this.info, model: d.model }
    if (d.sessionID !== this.sessionID || !ev.type.startsWith("session.")) return
    if (this.feed.apply(ev)) this.emit()
  }

  snapshot(): AppState {
    const base = this.controller.snapshot()
    const view = this.feed.view
    return {
      ...base,
      target: { kind: "session", id: this.sessionID },
      view,
      loadingView: this.feed.loading,
      permissions: this.controller.permissionsOf(this.sessionID),
      form: this.form,
      agent: this.info?.agent,
      model: this.info?.model,
      error: this.error,
      sending: false,
      readOnly: true,
      workerTitle: this.title,
      workers: [],
      hiddenWorkers: [],
      runningShells: 0,
      hasEarlier: this.feed.hasEarlier,
      loadingEarlier: this.feed.loadingEarlier,
      earlierTick: this.feed.earlierTick,
      trimPending: this.feed.trimPending,
      features: { ...base.features, revert: false },
      restore: undefined,
    }
  }

  async dispatch(action: Action): Promise<void> {
    switch (action.type) {
      case "ready":
        this.emitNow()
        return
      case "loadEarlier": {
        const client = this.controller.api
        if (client) await this.feed.loadEarlier(client, this.sessionID)
        return
      }
      case "trimCompacted":
        this.feed.trim()
        this.emitNow()
        return
      case "permission":
        // Only this worker's own requests.
        if (action.sessionID === this.sessionID) await this.controller.dispatch(action)
        return
      case "formReply": {
        const client = this.controller.api
        const form = this.form
        if (!client || !form) return
        try {
          // This worker's own form, never the parent's: the reply names the session and the form id explicitly.
          await client.session.form.reply({ sessionID: this.sessionID, formID: form.id, answer: action.answer })
          this.form = undefined
          this.emitNow()
        } catch (e) {
          this.error = errorMessage(e)
          this.emitNow()
        }
        return
      }
      case "formCancel": {
        const client = this.controller.api
        const form = this.form
        if (!client || !form) return
        try {
          await client.session.form.cancel({ sessionID: this.sessionID, formID: form.id })
          this.form = undefined
          this.emitNow()
        } catch (e) {
          this.error = errorMessage(e)
          this.emitNow()
        }
        return
      }
      case "stopWorker": {
        // Only this worker itself, never another session. The controller checks that it is a child of the open session.
        if (action.sessionID !== this.sessionID) return
        await this.controller.dispatch(action)
        // The controller shows its own errors on its own state; this tab has its own error line.
        const failed = this.controller.snapshot().error
        if (failed) {
          this.error = failed
          this.emitNow()
        }
        return
      }
      case "dismissError":
        this.error = undefined
        this.emitNow()
        return
      default:
        // Read-only: sending, reverting, renaming and switching are ignored.
        return
    }
  }

  private emit(): void {
    if (this.timer || this.disposed) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.emitNow()
    }, EMIT_MS)
  }

  private emitNow(): void {
    if (this.disposed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const s = this.snapshot()
    for (const l of this.listeners) l(s)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    for (const o of this.off) o()
    this.listeners.clear()
    this.feed.reset()
  }
}

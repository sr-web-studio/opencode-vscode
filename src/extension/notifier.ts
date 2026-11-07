import * as vscode from "vscode"
import { attentionFor, type OsSetting } from "../core/attention"
import { COMPANION } from "../core/dictation"
import type { NotificationEngine } from "../core/notifications/engine"
import type { Notice, NoticeCommand, Notifier } from "../core/notifications/types"

/**
 * Delivery option 1: native VS Code messages. `showWarningMessage` for attention, `showInformationMessage` for
 * finished/failed. The decision logic lives in the pure `NotificationEngine`; a later companion
 * (`opencode.notifier.show`) or push relay implements the same `Notifier` interface.
 *
 * VS Code has no API to close a toast from code. `dismiss` therefore marks the notice stale: its buttons become
 * harmless (Allow/Deny are ignored, Open still works) and the toast fades on its own.
 */
export class VscodeNotifier implements Notifier {
  private live = new Map<string, Notice>()
  private engine?: NotificationEngine

  private askedMissing = false

  /**
   * `os` reads the `opencode.notifications.os` setting; `log` is the OpenCode output channel (debug level). Without
   * `os` the window never asks for attention.
   */
  constructor(
    private readonly run: (cmd: NoticeCommand) => void | Promise<void>,
    private readonly options: { os?: () => OsSetting; log?: (line: string) => void } = {},
  ) {}

  bind(engine: NotificationEngine) {
    this.engine = engine
  }

  show(notice: Notice): void {
    this.live.set(notice.id, notice)
    const labels = notice.actions.map((a) => a.label)
    const text = `${notice.title}: ${notice.body}`
    const pending = notice.severity === "warning" ? vscode.window.showWarningMessage(text, ...labels) : vscode.window.showInformationMessage(text, ...labels)
    void Promise.resolve(pending).then((picked) => this.picked(notice, picked))
    this.askForAttention(notice)
  }

  /**
   * Fire and forget, after the toast is on its way: the OpenCode Voice companion (on the user's computer) makes the
   * window ask for attention (taskbar flash and the like). An older or missing companion has no such command.
   */
  private askForAttention(notice: Notice): void {
    try {
      const request = attentionFor(notice, { os: this.options.os?.() ?? "off", focused: vscode.window.state.focused })
      if (!request) return
      void Promise.resolve(vscode.commands.executeCommand(COMPANION.attention, request)).then(undefined, (e: unknown) => {
        if (this.askedMissing) return
        this.askedMissing = true
        const message = e instanceof Error ? e.message : String(e)
        this.options.log?.(`Window attention: the OpenCode Voice companion did not take the request (${message}). Install or update it to flash the taskbar.`)
      })
    } catch (e) {
      this.options.log?.(`Window attention: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  dismiss(id: string): void {
    this.live.delete(id)
  }

  private async picked(notice: Notice, label: string | undefined): Promise<void> {
    const stale = this.live.get(notice.id) !== notice
    if (!stale) this.live.delete(notice.id)
    const action = notice.actions.find((a) => a.label === label)
    if (!action || !this.engine) return
    // A replaced or answered notice may only open the session; replying twice would fail on the server.
    if (stale && action.id !== "open") return
    const cmd = this.engine.resolveAction(notice, action.id)
    if (cmd) await this.run(cmd)
  }
}

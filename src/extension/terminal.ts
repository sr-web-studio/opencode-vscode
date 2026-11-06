import * as vscode from "vscode"
import type { Controller } from "../core/controller"
import type { EventEnvelope } from "../core/api"
import { ShellPager, type ShellPage, type ShellState } from "../core/shell-pager"
import { exitText, headerText, terminalName, terminalsToClose, toCrlf } from "../core/terminal-text"
import type { TerminalSettings } from "./settings"

type Entry = {
  shellID: string
  terminal: vscode.Terminal
  pager: ShellPager
  finished: boolean
  stopping: boolean
}

/**
 * Mirrors OpenCode shell commands into VS Code terminals. The command runs on the server; each terminal is a
 * `Pseudoterminal` that only reads: it prints the command, pages `shell.output` by byte cursor, and ends with the
 * exit code. It takes no input. Ctrl+C (or closing it while the command runs) asks before stopping the command.
 */
export class ShellTerminals implements vscode.Disposable {
  private readonly entries = new Map<string, Entry>()
  private readonly stop: () => void
  private readonly subs: vscode.Disposable[] = []

  constructor(private readonly controller: Controller, private readonly settings: () => TerminalSettings) {
    this.stop = controller.observe({
      event: (ev) => this.onEvent(ev),
      resync: () => void this.reattach(),
    })
    this.subs.push(
      vscode.window.onDidCloseTerminal((t) => {
        for (const [id, e] of this.entries) if (e.terminal === t) this.forget(id)
      }),
    )
  }

  /** A `shell` tool reported its shell id: start mirroring it. Events of shells we already know are ignored. */
  private onEvent(ev: EventEnvelope): void {
    if (ev.type !== "session.tool.progress") return
    const shellID = ev.data?.metadata?.shellID
    const sessionID = ev.data?.sessionID
    if (typeof shellID !== "string" || typeof sessionID !== "string" || this.entries.has(shellID)) return
    if (this.settings().reveal === "off") return
    void this.open(shellID, sessionID, this.settings().reveal === "onStart")
  }

  /** After a reload or a reconnect: attach to commands that are still running, from the start of their output. */
  private async reattach(): Promise<void> {
    const client = this.controller.api
    if (!client || this.settings().reveal === "off") return
    try {
      const res = await client.shell.list({ location: { directory: this.controller.directory } })
      for (const info of res.data) {
        if (info.status !== "running" || this.entries.has(info.id)) continue
        const sessionID = typeof info.metadata?.sessionID === "string" ? info.metadata.sessionID : ""
        await this.open(info.id, sessionID, false)
      }
    } catch {
      // Older server without shell.list: nothing to reattach.
    }
  }

  /** "Show terminal" on a tool line: focus the mirror, creating it first if needed (finished commands replay). */
  async show(shellID: string, sessionID: string | undefined): Promise<void> {
    const existing = this.entries.get(shellID)
    if (existing) {
      existing.terminal.show(false)
      return
    }
    const ok = await this.open(shellID, sessionID ?? "", true, false)
    if (!ok) void vscode.window.showWarningMessage("The command output is no longer available.")
  }

  private async open(shellID: string, sessionID: string, reveal: boolean, preserveFocus = true): Promise<boolean> {
    const client = this.controller.api
    if (!client || this.entries.has(shellID)) return this.entries.has(shellID)
    const location = this.controller.locationOf(sessionID)
    let info
    try {
      info = (await client.shell.get({ id: shellID, location })).data
    } catch {
      return false
    }
    if (this.entries.has(shellID)) return true

    const write = new vscode.EventEmitter<string>()
    const closed = new vscode.EventEmitter<number | void>()
    let afterCR = false
    const print = (text: string) => {
      const out = toCrlf(text, afterCR)
      afterCR = out.endsWithCR
      write.fire(out.text)
    }
    const source = {
      output: async (input: { cursor: number; limit: number }): Promise<ShellPage> => {
        const r = (await client.shell.output({ id: shellID, location, cursor: input.cursor, limit: input.limit })).data
        return { output: r.output, cursor: r.cursor, size: r.size, truncated: r.truncated }
      },
      state: async (): Promise<ShellState> => {
        const r = (await client.shell.get({ id: shellID, location })).data
        return { status: r.status, exit: r.exit }
      },
    }
    const entry: Entry = { shellID, terminal: undefined as never, finished: false, stopping: false, pager: undefined as never }
    entry.pager = new ShellPager(
      source,
      {
        text: print,
        exit: (state) => {
          entry.finished = true
          write.fire(exitText(state))
        },
        unavailable: (reason) => {
          entry.finished = true
          write.fire(entry.stopping ? exitText({ status: "killed" }) : `\r\n\x1b[33m${reason}\x1b[0m\r\n`)
        },
      },
      {},
      0,
    )

    const confirmStop = async (): Promise<boolean> => {
      if (entry.finished) return false
      const stop = "Stop"
      const pick = await vscode.window.showWarningMessage("Stop this command?", { modal: true, detail: info.command }, stop)
      if (pick !== stop || entry.finished) return false
      entry.stopping = true
      try {
        await client.shell.remove({ id: shellID, location })
      } catch {
        // Already gone: the pager reports it.
      }
      return true
    }

    const pty: vscode.Pseudoterminal = {
      onDidWrite: write.event,
      onDidClose: closed.event,
      open: () => {
        write.fire(headerText(info.command, info.cwd))
        void entry.pager.run()
      },
      // Input-free: Ctrl+C is the only key, and it only asks.
      handleInput: (data) => {
        if (data === "\x03") void confirmStop()
      },
      close: () => {
        // The tab was closed. A running command is only stopped when the user says so; otherwise it keeps running
        // on the server and "Show terminal" can attach again.
        const running = !entry.finished
        entry.pager.stop()
        if (running) void confirmStop()
        write.dispose()
        closed.dispose()
      },
    }

    entry.terminal = vscode.window.createTerminal({ name: terminalName(info.command, this.controller.agentOf(sessionID)), pty })
    this.entries.set(shellID, entry)
    if (reveal) entry.terminal.show(preserveFocus)
    this.trim()
    return true
  }

  private forget(shellID: string): void {
    this.entries.delete(shellID)
  }

  /** Keep at most `maxOpen` terminals: the oldest finished ones go first, running ones stay. */
  private trim(): void {
    const open = [...this.entries.values()].map((e) => ({ shellID: e.shellID, finished: e.finished }))
    for (const id of terminalsToClose(open, this.settings().maxOpen)) {
      this.entries.get(id)?.terminal.dispose()
      this.forget(id)
    }
  }

  dispose(): void {
    this.stop()
    for (const s of this.subs) s.dispose()
    for (const e of this.entries.values()) {
      e.pager.stop()
      e.terminal.dispose()
    }
    this.entries.clear()
  }
}

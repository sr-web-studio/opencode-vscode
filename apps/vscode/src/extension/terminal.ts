import * as vscode from "vscode"
import { shortenHome } from "@occ/core/paths"
import type { Controller } from "@occ/core/controller"
import type { EventEnvelope } from "@occ/core/api"
import { ShellPager, type ShellPage, type ShellState } from "@occ/core/shell-pager"
import { planTerminal, shouldReveal, terminalsToClose, type Slot } from "@occ/core/terminal-slots"
import { DEFAULT_COLUMNS, commandBlockText, endText, noticeText, sessionTerminalName, terminalName, toCrlf } from "@occ/core/terminal-text"
import { homedir } from "node:os"
import type { TerminalSettings } from "./settings"

/** The command a terminal is showing right now. */
type Run = {
  shellID: string
  command: string
  pager?: ShellPager
  finished: boolean
  stopping: boolean
  started: number
  completed?: number
  /** Removes the shell on the server (Ctrl+C after the user agreed). */
  remove: () => Promise<void>
}

/** One VS Code terminal: a read-only `Pseudoterminal` that shows commands as blocks, one after the other. */
type Term = Slot & {
  terminal: vscode.Terminal
  write: vscode.EventEmitter<string>
  closed: vscode.EventEmitter<number | void>
  opened: boolean
  /** Text written before VS Code called `open`. */
  pending: string[]
  columns: number
  current?: Run
  lastCwd?: string
  afterCR: boolean
  atLineStart: boolean
  shells: Set<string>
}

/**
 * Mirrors OpenCode shell commands into VS Code terminals. The command runs on the server; the terminal only reads.
 *
 * `session` mode (default): one terminal per session, every command appended as a block. A command that starts while
 * the session's terminal is still running another one gets an extra terminal (`#2`), which later commands reuse.
 * `perCommand`: a terminal per command. Ctrl+C stops only the running command, after asking.
 */
export class ShellTerminals implements vscode.Disposable {
  private readonly terms: Term[] = []
  /** Shells already mirrored (or deliberately closed). Their progress events do not open anything again. */
  private readonly seen = new Set<string>()
  private readonly stop: () => void
  private readonly subs: vscode.Disposable[] = []
  private counter = 0

  constructor(
    private readonly controller: Controller,
    private readonly settings: () => TerminalSettings,
  ) {
    this.stop = controller.observe({
      event: (ev) => this.onEvent(ev),
      resync: () => void this.reattach(),
    })
    this.subs.push(vscode.window.onDidCloseTerminal((t) => this.forget(t)))
  }

  /** A `shell` tool reported its shell id: start mirroring it. */
  private onEvent(ev: EventEnvelope): void {
    if (ev.type !== "session.tool.progress") return
    const shellID = ev.data?.metadata?.shellID
    const sessionID = ev.data?.sessionID
    if (typeof shellID !== "string" || typeof sessionID !== "string" || this.seen.has(shellID)) return
    if (this.settings().reveal === "off") return
    this.seen.add(shellID)
    void this.open(shellID, sessionID, this.settings().reveal === "onStart", true).then((ok) => {
      // Could not read the shell yet: a later progress event may try again.
      if (!ok) this.seen.delete(shellID)
    })
  }

  /** After a reload or a reconnect: running commands are appended to the session terminal the same way, from the start of their output. */
  private async reattach(): Promise<void> {
    const client = this.controller.api
    if (!client || this.settings().reveal === "off") return
    try {
      const res = await client.shell.list({ location: { directory: this.controller.directory } })
      for (const info of res.data) {
        if (info.status !== "running" || this.seen.has(info.id)) continue
        this.seen.add(info.id)
        const sessionID = typeof info.metadata?.sessionID === "string" ? info.metadata.sessionID : ""
        if (!(await this.open(info.id, sessionID, false, true))) this.seen.delete(info.id)
      }
    } catch {
      // Older server without shell.list: nothing to reattach.
    }
  }

  /** "Show terminal" on a tool line: focus the terminal that has the command, or append it (finished commands replay). */
  async show(shellID: string, sessionID: string | undefined): Promise<void> {
    const existing = this.terms.find((t) => t.shells.has(shellID))
    if (existing) {
      existing.terminal.show(false)
      return
    }
    this.seen.add(shellID)
    const ok = await this.open(shellID, sessionID ?? "", true, false)
    if (!ok) this.seen.delete(shellID)
    if (!ok) void vscode.window.showWarningMessage("The command output is no longer available.")
  }

  private async open(shellID: string, sessionID: string, reveal: boolean, preserveFocus: boolean): Promise<boolean> {
    const client = this.controller.api
    if (!client) return false
    const location = this.controller.locationOf(sessionID)
    let info
    try {
      info = (await client.shell.get({ id: shellID, location })).data
    } catch {
      return false
    }

    // From here to the reservation everything is synchronous, so two commands starting together cannot pick the same terminal.
    const mode = this.settings().mode
    const plan = planTerminal(this.terms, mode, sessionID)
    const term = plan.kind === "reuse" ? this.terms.find((t) => t.id === plan.id)! : this.create(sessionID, plan.slot, mode, info.command)
    const run: Run = {
      shellID,
      command: info.command,
      finished: false,
      stopping: false,
      started: info.time.started,
      remove: async () => {
        await client.shell.remove({ id: shellID, location })
      },
    }
    term.current = run
    term.busy = true
    term.lastUsed = Date.now()
    term.shells.add(shellID)

    const display = shortenHome(info.cwd, homedir())
    this.emit(term, commandBlockText({ command: info.command, cwd: display, lastCwd: term.lastCwd, columns: term.columns, at: info.time.started }))
    term.lastCwd = display
    term.atLineStart = true
    term.afterCR = false

    const source = {
      output: async (input: { cursor: number; limit: number }): Promise<ShellPage> => {
        const r = (await client.shell.output({ id: shellID, location, cursor: input.cursor, limit: input.limit })).data
        return { output: r.output, cursor: r.cursor, size: r.size, truncated: r.truncated }
      },
      state: async (): Promise<ShellState> => {
        const r = (await client.shell.get({ id: shellID, location })).data
        run.completed = r.time.completed
        return { status: r.status, exit: r.exit }
      },
    }
    run.pager = new ShellPager(
      source,
      {
        text: (chunk) => {
          const out = toCrlf(chunk, term.afterCR)
          term.afterCR = out.endsWithCR
          if (out.text) term.atLineStart = out.text.endsWith("\n")
          this.emit(term, out.text)
        },
        exit: (state) => {
          this.finish(term, run, endText(run.stopping ? { status: "killed" } : state, (run.completed ?? Date.now()) - run.started, term.atLineStart))
        },
        unavailable: (reason) => {
          this.finish(term, run, run.stopping ? endText({ status: "killed" }, Date.now() - run.started, term.atLineStart) : noticeText(reason, term.atLineStart))
        },
      },
      {},
      0,
    )
    // `show(true)` keeps keyboard focus but still switches the active terminal: never take the panel from the user's own terminal.
    const active = vscode.window.activeTerminal
    const activeIsOursOrNone = !active || this.terms.some((t) => t.terminal === active)
    const explicit = !preserveFocus
    if (reveal && shouldReveal({ reveal: explicit ? "onStart" : this.settings().reveal, explicit, activeIsOursOrNone })) term.terminal.show(preserveFocus)
    void run.pager.run()
    this.trim()
    return true
  }

  /** The command ended: print the end line and free the terminal for the next command. */
  private finish(term: Term, run: Run, text: string): void {
    if (run.finished) return
    run.finished = true
    this.emit(term, text)
    term.atLineStart = true
    if (term.current === run) {
      term.current = undefined
      term.busy = false
    }
    term.lastUsed = Date.now()
    this.trim()
  }

  /** Write to the terminal, or hold the text until VS Code has opened it. */
  private emit(term: Term, text: string): void {
    if (!text) return
    if (term.opened) term.write.fire(text)
    else term.pending.push(text)
  }

  private create(sessionID: string, slot: number, mode: TerminalSettings["mode"], command: string): Term {
    const write = new vscode.EventEmitter<string>()
    const closed = new vscode.EventEmitter<number | void>()
    const id = `t${++this.counter}`
    const term: Term = {
      id,
      sessionID,
      slot,
      busy: false,
      lastUsed: Date.now(),
      terminal: undefined as never,
      write,
      closed,
      opened: false,
      pending: [],
      columns: DEFAULT_COLUMNS,
      afterCR: false,
      atLineStart: true,
      shells: new Set(),
    }

    const pty: vscode.Pseudoterminal = {
      onDidWrite: write.event,
      onDidClose: closed.event,
      open: (dims) => {
        if (dims?.columns) term.columns = dims.columns
        term.opened = true
        for (const text of term.pending.splice(0)) write.fire(text)
      },
      setDimensions: (dims) => {
        if (dims.columns) term.columns = dims.columns
      },
      // Input-free: Ctrl+C is the only key, and it only asks. It stops the running command, never the terminal.
      handleInput: (data) => {
        if (data === "\x03") void this.confirmStop(term)
      },
      close: () => {
        // The tab was closed. A running command is only stopped when the user says so; otherwise it keeps running
        // on the server and "Show terminal" can attach again.
        const run = term.current
        run?.pager?.stop()
        if (run && !run.finished) void this.confirmStop(term, run)
        write.dispose()
        closed.dispose()
      },
    }

    const name =
      mode === "session" ? sessionTerminalName(this.controller.sessionMeta(sessionID)?.title, this.controller.agentOf(sessionID), slot) : terminalName(command, this.controller.agentOf(sessionID))
    term.terminal = vscode.window.createTerminal({ name, pty })
    this.terms.push(term)
    return term
  }

  private async confirmStop(term: Term, given?: Run): Promise<boolean> {
    const run = given ?? term.current
    if (!run || run.finished) return false
    const stop = "Stop"
    const pick = await vscode.window.showWarningMessage("Stop this command?", { modal: true, detail: run.command }, stop)
    if (pick !== stop || run.finished) return false
    run.stopping = true
    try {
      await run.remove()
    } catch {
      // Already gone: the pager reports it.
    }
    return true
  }

  private forget(terminal: vscode.Terminal): void {
    const i = this.terms.findIndex((t) => t.terminal === terminal)
    if (i === -1) return
    this.terms[i]!.current?.pager?.stop()
    this.terms.splice(i, 1)
  }

  /** Keep at most `maxOpen` terminals: the least recently used idle ones go first, running ones stay. */
  private trim(): void {
    for (const id of terminalsToClose(this.terms, this.settings().maxOpen)) {
      const term = this.terms.find((t) => t.id === id)
      term?.terminal.dispose()
    }
  }

  dispose(): void {
    this.stop()
    for (const s of this.subs) s.dispose()
    for (const t of this.terms.splice(0)) {
      t.current?.pager?.stop()
      t.terminal.dispose()
    }
  }
}

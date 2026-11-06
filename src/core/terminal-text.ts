/** Text for the shell mirror terminal. Pure, so the byte-for-byte output is tested without VS Code. */
import type { ShellState } from "./shell-pager"

const ESC = "\x1b["
const style = (code: string, text: string) => `${ESC}${code}m${text}${ESC}0m`

/** Terminals need `\r\n`. `afterCR` is true when the previous chunk ended with `\r` (a `\r\n` split across pages). */
export function toCrlf(text: string, afterCR = false): { text: string; endsWithCR: boolean } {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === "\n") {
      const prevCR = i === 0 ? afterCR : text[i - 1] === "\r"
      out += prevCR ? "\n" : "\r\n"
    } else out += c
  }
  return { text: out, endsWithCR: text.endsWith("\r") }
}

/** `$ command` (bold) and the working directory (dim). */
export function headerText(command: string, cwd: string | undefined): string {
  const first = `${style("1", `$ ${command.replace(/\r?\n/g, " ")}`)}\r\n`
  return cwd ? `${first}${style("2", cwd)}\r\n` : first
}

/** The final coloured line. Green for exit 0, red for a failure, yellow for a timeout or a stopped command. */
export function exitText(state: ShellState): string {
  if (state.status === "timeout") return `\r\n${style("33", "timed out")}\r\n`
  if (state.status === "killed") return `\r\n${style("33", "stopped")}\r\n`
  const code = state.exit ?? 0
  return `\r\n${style(code === 0 ? "32" : "31", `exit ${code}`)}\r\n`
}

/** Terminal name: `OpenCode: <command>`, or `OpenCode (<agent>): <command>` for a worker. */
export function terminalName(command: string, agent?: string): string {
  const one = command.replace(/\s+/g, " ").trim()
  const short = one.length > 40 ? `${one.slice(0, 39)}…` : one
  return agent ? `OpenCode (${agent}): ${short}` : `OpenCode: ${short}`
}

export type OpenTerminal = { shellID: string; finished: boolean }

/** Which terminals to dispose so that at most `max` remain: the oldest finished ones. Running ones are never chosen. */
export function terminalsToClose(open: readonly OpenTerminal[], max: number): string[] {
  const excess = open.length - Math.max(1, max)
  if (excess <= 0) return []
  return open.filter((t) => t.finished).slice(0, excess).map((t) => t.shellID)
}

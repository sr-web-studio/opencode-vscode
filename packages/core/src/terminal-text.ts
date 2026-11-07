/**
 * Text for the shell mirror terminal. Pure, so the byte-for-byte output is tested without VS Code.
 *
 * A command is a block: a blank line, a dim full-width rule with the clock on the right, the command (bold, wrapped),
 * the working directory when it changed, a blank line, then the output as-is, then one coloured end line.
 */
import { formatDuration } from "./format"
import type { ShellState } from "./shell-pager"

const ESC = "\x1b["
const RESET = `${ESC}0m`
const style = (code: string, text: string) => `${ESC}${code}m${text}${RESET}`

export const DEFAULT_COLUMNS = 80

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

/** `12:33:05` (24-hour, with seconds) in the given zone, or the local one. */
export const clockText = (at: number, timeZone?: string): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(at)

/** `1.2s` below a minute (one decimal), then `1m 05s`, `1h 02m`. Undefined for a time that makes no sense. */
export function shortDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined
  const tenths = Math.round(ms / 100) / 10
  return tenths < 60 ? `${tenths.toFixed(1)}s` : formatDuration(ms)
}

const columnsOf = (columns: number | undefined): number => (columns && Number.isFinite(columns) && columns >= 20 ? Math.floor(columns) : DEFAULT_COLUMNS)

/** The dim rule: `──────── 12:33:05`, exactly `columns` wide. */
export function ruleText(columns: number | undefined, clock: string): string {
  const width = columnsOf(columns)
  return style("2", `${"─".repeat(Math.max(3, width - clock.length - 1))} ${clock}`)
}

/** Break one line into pieces of at most `width` characters, at the last space when that wastes less than half. */
export function wrapLine(line: string, width: number): string[] {
  const w = Math.max(8, width)
  const out: string[] = []
  let rest = line
  while (rest.length > w) {
    const space = rest.lastIndexOf(" ", w)
    if (space > w / 2) {
      out.push(rest.slice(0, space))
      rest = rest.slice(space + 1)
    } else {
      out.push(rest.slice(0, w))
      rest = rest.slice(w)
    }
  }
  out.push(rest)
  return out
}

export type CommandBlock = {
  command: string
  /** Display form of the working directory (`~` shortened). Shown only when it differs from `lastCwd`. */
  cwd?: string
  lastCwd?: string
  columns?: number
  /** Start time, epoch ms. */
  at: number
  timeZone?: string
}

/** Everything printed before the output: rule, command, cwd (when changed) and the blank line. Ends at a line start. */
export function commandBlockText(b: CommandBlock): string {
  const width = columnsOf(b.columns)
  const lines = b.command.replace(/\t/g, "  ").split(/\r?\n/).flatMap((l) => wrapLine(l, width - 2))
  const body = lines.map((l, i) => `${i === 0 ? `${style("1;36", "❯")} ` : "  "}${style("1", l)}`).join("\r\n")
  const cwd = b.cwd && b.cwd !== b.lastCwd ? `${style("2", b.cwd)}\r\n` : ""
  return `\r\n${ruleText(width, clockText(b.at, b.timeZone))}\r\n${body}\r\n${cwd}\r\n`
}

/**
 * The end line. `✓ exit 0 · 1.2s` green, `✗ exit 1 · 0.4s` red, `stopped` or `timed out` yellow. Starts with a reset (output
 * may leave a colour on) and a line break when the output did not end on one.
 */
export function endText(state: ShellState, durationMs: number | undefined, atLineStart: boolean): string {
  const d = shortDuration(durationMs)
  const tail = d ? ` · ${d}` : ""
  const lead = `${RESET}${atLineStart ? "" : "\r\n"}`
  if (state.status === "timeout") return `${lead}${style("33", `timed out${tail}`)}\r\n`
  if (state.status === "killed") return `${lead}${style("33", `stopped${tail}`)}\r\n`
  const code = state.exit ?? 0
  return `${lead}${code === 0 ? style("32", `✓ exit 0${tail}`) : style("31", `✗ exit ${code}${tail}`)}\r\n`
}

/** A line shown when the output cannot be read any more (yellow). Starts on a fresh line. */
export const noticeText = (reason: string, atLineStart: boolean): string => `${RESET}${atLineStart ? "" : "\r\n"}${style("33", reason)}\r\n`

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Per-command terminal name: `OpenCode: <command>`, or `OpenCode (<agent>): <command>` for a worker. */
export function terminalName(command: string, agent?: string): string {
  const short = clip(command.replace(/\s+/g, " ").trim(), 40)
  return agent ? `OpenCode (${agent}): ${short}` : `OpenCode: ${short}`
}

/** Session terminal name: `OpenCode: <session title>`, `OpenCode (<agent>): <worker title>`, with ` #2` for extra terminals. */
export function sessionTerminalName(title: string | undefined, agent: string | undefined, slot: number): string {
  const t = clip((title ?? "").replace(/\s+/g, " ").trim(), 40)
  const base = agent ? `OpenCode (${agent}): ${t || "worker"}` : `OpenCode: ${t || "session"}`
  return slot > 1 ? `${base} #${slot}` : base
}

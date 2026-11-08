/**
 * What the expanded shell block shows: the working directory, the duration and the visible part of the output.
 * Pure, so the cutting and the labels are tested without a UI.
 */
import { formatDuration } from "./format"

export type ShellViewInput = {
  command: string
  output: string
  /** `workdir` from the tool input, if the call had one. */
  workdir?: string
  /** The project folder the session runs in, and its `~`-shortened form. */
  directory: string
  displayPath: string
  created?: number
  completed?: number
  /** How many output lines to show before the footer offers the rest. */
  limit: number
  showAll: boolean
}

export type ShellViewModel = {
  command: string
  cwd: string
  duration?: string
  /** The output text to render (all of it, or the last `limit` lines). */
  shown: string
  /** Lines in the whole output. Zero for no output. */
  total: number
  /** Lines left out of `shown`. */
  hidden: number
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "")

/** The cwd for the header: the project's `~` path, a sub-folder below it, or the tool's own workdir as given. */
export function cwdLabel(workdir: string | undefined, directory: string, displayPath: string): string {
  if (!workdir) return displayPath
  const w = norm(workdir)
  const d = norm(directory)
  if (w === d) return displayPath
  if (d && w.startsWith(`${d}/`)) return `${norm(displayPath)}${w.slice(d.length)}`
  return workdir
}

export function shellView(i: ShellViewInput): ShellViewModel {
  const text = i.output.replace(/\s+$/, "")
  const lines = text === "" ? [] : text.split("\n")
  const cut = !i.showAll && lines.length > i.limit
  const shown = cut ? lines.slice(-i.limit).join("\n") : lines.join("\n")
  const hasDuration = i.created !== undefined && i.completed !== undefined && i.completed > i.created
  return {
    command: i.command,
    cwd: cwdLabel(i.workdir, i.directory, i.displayPath),
    duration: hasDuration ? formatDuration(i.completed! - i.created!) : undefined,
    shown,
    total: lines.length,
    hidden: cut ? lines.length - i.limit : 0,
  }
}

/** The text of the Copy action: the command, then the output when there is some. */
export const copyText = (command: string, output: string): string => {
  const out = output.replace(/\s+$/, "")
  return out ? `$ ${command}\n${out}` : `$ ${command}`
}

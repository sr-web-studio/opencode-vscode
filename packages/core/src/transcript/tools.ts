import { clip, firstLine } from "../format"
import { safeImageMime } from "../images"
import { relativeTo } from "../paths"
import { executeTarget } from "./execute"
import { firstChangedLine, patchedFiles } from "./patch"
import { isStoppedCommand } from "./tool-error"
import type { ToolAttachment, ToolItem } from "./types"

export type ToolLine = {
  /** Bold label, e.g. `Edit`. */
  label: string
  /** Muted target: path, pattern, command. */
  target: string
  /** Short result such as `+12 −3`, `✓ exit 0`, `✗ failed`. Empty while running. */
  result: string
  tone: "muted" | "ok" | "error"
  /** File path the target links to, if any (as given by the tool, possibly absolute). */
  path?: string
  /** 1-based line to open `path` at: the read offset, or the first changed line of an edit. Undefined = top. */
  at?: number
  /** http(s) URL the target stands for, if any. */
  url?: string
}

const LABELS: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  patch: "Patch",
  shell: "Shell",
  grep: "Grep",
  glob: "Glob",
  subagent: "Agent",
  question: "Question",
  webfetch: "Fetch",
  websearch: "Search",
  skill: "Skill",
  execute: "Code",
  todowrite: "Todo",
  experimental_image_generate: "Image",
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined)
const isHttp = (s: string) => /^https?:\/\/\S+$/i.test(s)

/** About 3 MB of base64: a bigger picture is left to the file viewer instead of being kept in every snapshot. */
export const MAX_INLINE_IMAGE_CHARS = 3_000_000

/**
 * Image files of a tool result. OpenCode V2's `read` returns a picture as a `file` content part with a `data:` URI
 * (the text part only says "Image read successfully"), so this is the only copy the transcript gets.
 */
export function toolAttachments(content: unknown): ToolAttachment[] | undefined {
  if (!Array.isArray(content)) return undefined
  const out: ToolAttachment[] = []
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue
    const part = raw as { type?: unknown; uri?: unknown; mime?: unknown; name?: unknown }
    if (part.type !== "file" || typeof part.uri !== "string" || !part.uri.startsWith("data:")) continue
    const mime = typeof part.mime === "string" ? part.mime : /^data:([^;,]+)/i.exec(part.uri)?.[1]
    if (!safeImageMime(mime) || part.uri.length > MAX_INLINE_IMAGE_CHARS) continue
    out.push({ mime, uri: part.uri, name: typeof part.name === "string" && part.name ? part.name : undefined })
  }
  return out.length > 0 ? out : undefined
}

/**
 * Line to open a `read` at. OpenCode's `offset` is 1-based (`offset: 95, limit: 40` returns "lines 95-134"), so it is
 * the line itself. Missing, zero, negative or non-numeric offsets mean the top of the file (undefined).
 */
export function readLine(input: Record<string, unknown>): number | undefined {
  const raw = input.offset
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*\d+\s*$/.test(raw) ? Number(raw) : undefined
  if (n === undefined || !Number.isFinite(n) || n < 1) return undefined
  return Math.floor(n)
}

export function toolLabel(name: string): string {
  const known = LABELS[name]
  if (known) return known
  // MCP tools are `<server>_<tool>`; show them as `server · tool`.
  const i = name.indexOf("_")
  if (i > 0 && i < name.length - 1) return `${name.slice(0, i)} · ${name.slice(i + 1).replace(/_/g, " ")}`
  return name.charAt(0).toUpperCase() + name.slice(1)
}

type EditFile = { file?: string; additions?: number; deletions?: number }

export function editStats(tool: ToolItem): { additions: number; deletions: number; files: EditFile[] } {
  const files = Array.isArray(tool.metadata.files) ? (tool.metadata.files as EditFile[]) : []
  return {
    files,
    additions: files.reduce((n, f) => n + (f.additions ?? 0), 0),
    deletions: files.reduce((n, f) => n + (f.deletions ?? 0), 0),
  }
}

/** One-line summary of a tool call. `cwd` shortens absolute paths inside the project. */
export function summarizeTool(tool: ToolItem, cwd: string): ToolLine {
  const i = tool.input
  const line: ToolLine = { label: toolLabel(tool.name), target: "", result: "", tone: "muted" }
  const pathOf = (p: string) => {
    if (!p) return
    line.target = relativeTo(p, cwd)
    line.path = p
  }

  switch (tool.name) {
    case "read":
      pathOf(str(i.path) || str(i.filePath))
      line.at = readLine(i)
      break
    case "write":
    case "edit":
      pathOf(str(i.path) || str(i.filePath))
      if (line.path) line.at = changedLineIn(tool, line.path)
      break
    case "patch": {
      // The patch tool has no `path`: its files come from the result, or the `*** Update File:` headers while it runs.
      const files = patchedFiles(tool)
      const first = files[0]
      if (first) {
        pathOf(first.file)
        line.target += files.length > 1 ? ` +${files.length - 1}` : ""
        line.at = first.patch ? firstChangedLine(first.patch) : undefined
      }
      break
    }
    case "shell":
      line.target = clip(firstLine(str(i.command)), 120)
      break
    case "grep":
    case "glob":
      line.target = clip(str(i.pattern), 80)
      break
    case "subagent":
      line.target = clip(str(i.description) || str(i.agent), 80)
      break
    case "webfetch":
      line.target = clip(str(i.url), 100)
      if (isHttp(str(i.url))) line.url = str(i.url)
      break
    case "websearch":
      line.target = clip(str(i.query), 80)
      break
    case "skill":
      line.target = str(i.id)
      break
    case "question": {
      const qs = Array.isArray(i.questions) ? (i.questions as Array<{ header?: string; question?: string }>) : []
      line.target = clip(qs[0]?.header || qs[0]?.question || "", 80)
      break
    }
    case "execute":
      // Code Mode: the MCP tools the script calls say more than its first line.
      line.target = clip(executeTarget(str(i.code)) || firstLine(str(i.code)), 80)
      break
    case "todowrite": {
      const todos = Array.isArray(i.todos) ? i.todos.length : 0
      line.target = todos ? `${todos} items` : ""
      break
    }
    default: {
      // Unknown or MCP tool: show the first short string argument.
      const first = Object.values(i).find((v) => typeof v === "string" && v.length > 0)
      line.target = clip(firstLine(str(first)), 80)
      if (isHttp(str(first))) line.url = str(first)
    }
  }

  if (tool.status === "streaming" || tool.status === "running") return line

  if (tool.status === "error") {
    // A command the user stopped is not a failure: a muted "stopped", no red cross.
    if (isStoppedCommand(tool.error)) {
      line.result = "stopped"
      return line
    }
    line.result = `✗ ${clip(firstLine(tool.error ?? "failed"), 60)}`
    line.tone = "error"
    return line
  }

  switch (tool.name) {
    case "edit":
    case "write":
    case "patch": {
      const { additions, deletions } = editStats(tool)
      line.result = additions || deletions ? `+${additions} −${deletions}` : "✓"
      line.tone = "ok"
      break
    }
    case "shell": {
      const exit = num(tool.metadata.exit) ?? 0
      line.result = exit === 0 ? "✓ exit 0" : `✗ exit ${exit}`
      line.tone = exit === 0 ? "ok" : "error"
      break
    }
    case "grep": {
      const n = num(tool.metadata.matches)
      line.result = n === undefined ? "✓" : `${n} match${n === 1 ? "" : "es"}`
      break
    }
    case "glob": {
      const n = num(tool.metadata.count)
      line.result = n === undefined ? "✓" : `${n} file${n === 1 ? "" : "s"}`
      break
    }
    case "subagent": {
      const status = str(tool.metadata.status)
      line.result = status && status !== "completed" ? status : "✓"
      line.tone = status === "failed" || status === "error" ? "error" : "ok"
      break
    }
    default:
      line.result = "✓"
      line.tone = "ok"
  }
  return line
}

/** First changed line of the edit's own file, from the patch the server returns in `metadata.files`. */
function changedLineIn(tool: ToolItem, path: string): number | undefined {
  const files = patchedFiles(tool)
  const mine = files.find((f) => f.file === path) ?? files[0]
  return mine?.patch ? firstChangedLine(mine.patch) : undefined
}

/** What a click on the row does. */
export type RowAction = { kind: "file"; path: string; line?: number } | { kind: "url"; url: string } | { kind: "worker" } | { kind: "toggle" }

/**
 * The primary action of a tool row: open the file (at the read offset / first changed line), open the URL, open the
 * worker tab (the caller falls back to toggling while the child session is unknown), else toggle the details.
 */
export function rowAction(tool: ToolItem, cwd: string): RowAction {
  if (tool.name === "subagent") return { kind: "worker" }
  const line = summarizeTool(tool, cwd)
  if (line.path) return line.at ? { kind: "file", path: line.path, line: line.at } : { kind: "file", path: line.path }
  if (line.url) return { kind: "url", url: line.url }
  return { kind: "toggle" }
}

/** Tooltip of the primary button: says what a click does. */
export function rowTitle(action: RowAction, line: Pick<ToolLine, "target">): string | undefined {
  switch (action.kind) {
    case "file":
      return action.line ? `Open ${line.target} at line ${action.line}. Alt-click shows details.` : `Open ${line.target}. Alt-click shows details.`
    case "url":
      return `Open ${action.url} in the browser. Alt-click shows details.`
    case "worker":
      return "Open this worker in a tab"
    default:
      return undefined
  }
}

export type AskedQuestion = { question: string; header?: string; options: Array<{ label: string; description?: string }>; answer?: string }

/**
 * The questions of a `question` tool call with the user's answers (`metadata.answers`, one list per question), for a
 * readable expanded view instead of JSON.
 */
export function askedQuestions(tool: { input: Record<string, unknown>; metadata: Record<string, unknown> }): AskedQuestion[] {
  const qs = Array.isArray(tool.input.questions) ? (tool.input.questions as Array<Record<string, unknown>>) : []
  const answers = Array.isArray(tool.metadata.answers) ? (tool.metadata.answers as unknown[]) : []
  return qs.map((q, i) => {
    const a = answers[i]
    const answer = Array.isArray(a) ? a.filter((x) => typeof x === "string").join(", ") : typeof a === "string" ? a : undefined
    const options = Array.isArray(q.options)
      ? (q.options as Array<Record<string, unknown>>).map((o) => ({ label: String(o.label ?? ""), description: typeof o.description === "string" ? o.description : undefined }))
      : []
    return { question: String(q.question ?? ""), header: typeof q.header === "string" ? q.header : undefined, options, answer: answer || undefined }
  })
}

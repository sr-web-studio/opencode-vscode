import { clip, firstLine } from "../format"
import { relativeTo } from "../paths"
import type { ToolItem } from "./types"

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
}

const LABELS: Record<string, string> = {
  read: "Read", write: "Write", edit: "Edit", patch: "Patch", shell: "Shell", grep: "Grep", glob: "Glob",
  subagent: "Agent", question: "Question", webfetch: "Fetch", websearch: "Search", skill: "Skill",
  execute: "Execute", todowrite: "Todo", experimental_image_generate: "Image",
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined)

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
    case "write":
    case "edit":
    case "patch":
      pathOf(str(i.path) || str(i.filePath))
      break
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
      line.target = clip(firstLine(str(i.code)), 80)
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
    }
  }

  if (tool.status === "streaming" || tool.status === "running") return line

  if (tool.status === "error") {
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

/** Child session id for a subagent tool, when the server has reported it. */
export function subagentSessionID(tool: ToolItem): string | undefined {
  return tool.name === "subagent" ? str(tool.metadata.sessionID) || undefined : undefined
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

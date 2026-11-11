/**
 * `/export`: a session as a Markdown transcript or as the JSON `opencode` writes, so a user gets the same file from this
 * client and from OpenCode's own UI. Pure: the controller fetches the session and its messages, the hosts only save the
 * string this module returns.
 *
 * The Markdown follows OpenCode's TUI (`packages/tui/src/util/transcript.ts`): one `#` title, the session id and times,
 * a `---` between turns, `## User` and `## Assistant (agent · model · duration)`, reasoning as `_Thinking:_`, and each
 * tool call as a `**Tool: name**` block with its input, output or error. The JSON follows `opencode export`:
 * `{ info, messages }`, pretty-printed with a trailing newline.
 */

export type ExportFormat = "markdown" | "json"

export const EXPORT_FORMATS: ReadonlyArray<{ format: ExportFormat; label: string; description: string; extension: string }> = [
  { format: "markdown", label: "Markdown", description: "A readable transcript of the conversation", extension: "md" },
  { format: "json", label: "JSON", description: "The full session data, for another tool", extension: "json" },
]

/** What the header needs from `Session.Info`. */
export type ExportSession = {
  id: string
  title?: string
  /** Some servers send a slug; the web export falls back to it before the id. */
  slug?: string
  time: { created: number; updated: number }
}

/** The parts of a message the Markdown needs. The server's `SessionMessageInfo` is assignable to it. */
export type ExportMessage = {
  id?: string
  type?: string
  time?: { created?: number; completed?: number }
  text?: string
  agent?: string
  model?: { id?: string; providerID?: string }
  content?: ReadonlyArray<ExportContent>
}

export type ExportContent = { type: "text"; text: string } | { type: "reasoning"; text: string } | { type: "tool"; id?: string; name: string; state: ExportToolState }

export type ExportToolState = {
  status?: string
  input?: unknown
  content?: ReadonlyArray<{ type?: string; text?: string }>
  error?: { message?: string }
}

export type ExportOptions = {
  /** Include reasoning parts (`_Thinking:_`). OpenCode's export dialog starts with this on. */
  thinking?: boolean
  /** Include a tool's input, output and error. On by default, like OpenCode's export dialog. */
  toolDetails?: boolean
  /** Put the agent, model and duration in the assistant heading. On by default. */
  assistantMetadata?: boolean
  /** `ModelRef` → the name the model picker shows. OpenCode falls back to the model id. */
  modelName?: (model: { id?: string; providerID?: string }) => string | undefined
  /** Only for deterministic tests. OpenCode uses the machine's locale (`Date#toLocaleString`). */
  formatDate?: (at: number) => string
}

const DEFAULT_DATE = (at: number): string => new Date(at).toLocaleString()

/** OpenCode's `Locale.titlecase`: every word starts with a capital. */
export function titlecase(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** `{ info, messages }`, exactly like `opencode export`: two-space JSON and a final newline. */
export function exportJson(session: ExportSession, messages: ReadonlyArray<ExportMessage>): string {
  return `${JSON.stringify({ info: session, messages }, null, 2)}\n`
}

/** The session as OpenCode's TUI writes it. */
export function exportMarkdown(session: ExportSession, messages: ReadonlyArray<ExportMessage>, options: ExportOptions = {}): string {
  const thinking = options.thinking ?? true
  const toolDetails = options.toolDetails ?? true
  const assistantMetadata = options.assistantMetadata ?? true
  const formatDate = options.formatDate ?? DEFAULT_DATE

  let out = `# ${session.title?.trim() || session.id}\n\n`
  out += `**Session ID:** ${session.id}\n`
  out += `**Created:** ${formatDate(session.time.created)}\n`
  out += `**Updated:** ${formatDate(session.time.updated)}\n\n`
  out += `---\n\n`

  const ordered = [...messages].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0) || (a.id ?? "").localeCompare(b.id ?? ""))
  for (const message of ordered) {
    const text = formatMessage(message, { thinking, toolDetails, assistantMetadata, modelName: options.modelName })
    if (text === undefined) continue
    out += text
    out += `---\n\n`
  }
  return out
}

function formatMessage(message: ExportMessage, options: Required<Pick<ExportOptions, "thinking" | "toolDetails" | "assistantMetadata">> & Pick<ExportOptions, "modelName">): string | undefined {
  if (message.type === "user") return `## User\n\n${message.text ?? ""}\n\n`
  if (message.type !== "assistant") return undefined

  let out = formatAssistantHeader(message, options.assistantMetadata, options.modelName)
  for (const part of message.content ?? []) out += formatPart(part, options)
  return out
}

function formatAssistantHeader(message: ExportMessage, includeMetadata: boolean, modelName: ExportOptions["modelName"]): string {
  if (!includeMetadata) return `## Assistant\n\n`
  const created = message.time?.created
  const completed = message.time?.completed
  const duration = completed && created ? `${((completed - created) / 1000).toFixed(1)}s` : ""
  const model = message.model ? (modelName?.(message.model) ?? message.model.id ?? "") : ""
  const details = [message.agent ? titlecase(message.agent) : "", model, duration].filter(Boolean).join(" · ")
  return details ? `## Assistant (${details})\n\n` : `## Assistant\n\n`
}

function formatPart(part: ExportContent, options: { thinking: boolean; toolDetails: boolean }): string {
  if (part.type === "text") return `${part.text}\n\n`
  if (part.type === "reasoning") return options.thinking ? `_Thinking:_\n\n${part.text}\n\n` : ""
  if (part.type !== "tool") return ""

  let out = `**Tool: ${part.name}**\n`
  const state = part.state ?? {}
  if (options.toolDetails && state.input && typeof state.input === "object") {
    out += `\n**Input:**\n\`\`\`json\n${JSON.stringify(state.input, null, 2)}\n\`\`\`\n`
  }
  const output = (state.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
  if (options.toolDetails && state.status === "completed" && output) {
    out += `\n**Output:**\n\`\`\`\n${output}\n\`\`\`\n`
  }
  const error = state.error?.message
  if (options.toolDetails && state.status === "error" && error) {
    out += `\n**Error:**\n\`\`\`\n${error}\n\`\`\`\n`
  }
  return `${out}\n`
}

/**
 * The name OpenCode uses for each format: the TUI writes `session-<first 8 of the id>.md`, and the web/app export
 * slugifies the title for `.json`. Following each one means a file from here looks like the one OpenCode itself saves.
 */
export function exportFileName(session: { id: string; title?: string; slug?: string }, format: ExportFormat): string {
  if (format === "markdown") return `session-${session.id.slice(0, 8)}.md`
  const clean = (session.title || session.slug || session.id)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
  return `${clean || session.id}.json`
}

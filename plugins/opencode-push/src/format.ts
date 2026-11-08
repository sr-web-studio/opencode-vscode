import { basename } from "node:path"

export type Kind = "permission" | "question" | "finished" | "failed"

export const isAttention = (k: Kind) => k === "permission" || k === "question"

export type Push = {
  kind: Kind
  sessionID: string
  title: string
  body: string
  priority: 3 | 4
  tags: string[]
}

export const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`)

export const firstLine = (text: string): string =>
  text
    .split(/\r?\n/)
    .find((l) => l.trim() !== "")
    ?.trim() ?? ""

/**
 * Last line of defence for text that ends up on a phone (and on the ntfy server): blank out things that look like
 * credentials. The plugin never forwards tool input or file content, so this only matters for question and error text.
 */
export function redact(text: string): string {
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]")
    .replace(/\b(sk|pk|tk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/\b(api[_-]?key|token|secret|password|passwd)(["']?\s*[:=]\s*["']?)[^\s"',;]{4,}/gi, "$1$2[redacted]")
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, "[redacted]")
}

export const safe = (text: string, max = 140): string => clip(redact(firstLine(text)), max)

export const folderName = (directory: string | undefined): string => {
  if (!directory) return ""
  const trimmed = directory.replace(/[\\/]+$/, "")
  return basename(trimmed.replace(/\\/g, "/"))
}

const TITLE_MAX = 80

/** Title text is the session title, as the extension's toast shows it. Falls back to `OpenCode`. */
export function sessionLabel(title: string | undefined): string {
  const t = title ? firstLine(title) : ""
  return clip(redact(t), TITLE_MAX) || "OpenCode"
}

export type Facts = {
  kind: Kind
  sessionID: string
  sessionTitle?: string
  directory?: string
  /** Question text or first error line. Ignored unless `details` is on. */
  detail?: string
  /** Permission action name (`edit`, `shell`, ...). Never the resources. */
  action?: string
  details: boolean
}

export function buildPush(f: Facts): Push {
  const label = sessionLabel(f.sessionTitle)
  const folder = folderName(f.directory)

  let title: string
  let text: string
  switch (f.kind) {
    case "permission":
      title = `${label} needs permission`
      text = f.action && /^[\w.:-]{1,40}$/.test(f.action) ? `Waiting for your approval (${f.action})` : "Waiting for your approval"
      break
    case "question":
      title = `${label} has a question`
      text = f.details && f.detail ? safe(f.detail) || "Needs your input" : "Needs your input"
      break
    case "failed":
      title = `${label} failed`
      text = f.details && f.detail ? safe(f.detail) || "The turn failed" : "The turn failed"
      break
    default:
      title = `${label} finished`
      text = "Turn finished"
  }

  return {
    kind: f.kind,
    sessionID: f.sessionID,
    title,
    body: folder ? `${text}\n${folder}` : text,
    priority: f.kind === "finished" ? 3 : 4,
    tags: f.kind === "permission" ? ["lock"] : f.kind === "question" ? ["question"] : f.kind === "failed" ? ["x"] : ["white_check_mark"],
  }
}

export function clickUrl(template: string, sessionID: string, serverId: string): string | undefined {
  if (!template) return undefined
  return template.replaceAll("{sessionID}", encodeURIComponent(sessionID)).replaceAll("{serverId}", encodeURIComponent(serverId))
}

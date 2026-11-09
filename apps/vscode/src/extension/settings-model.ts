/**
 * The OpenCode Settings page's model: turns the extension's configuration schema into controls, validates values and
 * decides where they are written. No `vscode` import, so it is unit-tested directly and can be shared with the page's
 * webview (which only imports the pure helpers it needs).
 */

export type PropertySchema = {
  type?: string | string[]
  default?: unknown
  enum?: string[]
  enumDescriptions?: string[]
  enumItemLabels?: string[]
  items?: { type?: string; enum?: string[]; enumDescriptions?: string[]; enumItemLabels?: string[] }
  minimum?: number
  maximum?: number
  markdownDescription?: string
  description?: string
  scope?: string
  deprecationMessage?: string
}

export type ConfigurationSchema = { title?: string; properties?: Record<string, PropertySchema> }

export type SettingSnapshot = {
  value?: unknown
  defaultValue?: unknown
  globalValue?: unknown
  workspaceValue?: unknown
  workspaceFolderValue?: unknown
}

export type ControlKind = "boolean" | "number" | "string" | "enum" | "stringList" | "enumList"

export type SettingOption = { value: string; label: string; description?: string }

export type SettingAction = { label: string; command: string }

export type SettingsControl = {
  /** Full key, e.g. `opencode.transcript.fontSize`. */
  key: string
  /** Key inside the `opencode` section, e.g. `transcript.fontSize`. */
  shortKey: string
  label: string
  /** Raw markdown description from the schema; the page renders it with `markdownLite`. */
  description: string
  kind: ControlKind
  options?: SettingOption[]
  min?: number
  max?: number
  /** The effective value (what the extension uses right now). */
  value: unknown
  defaultValue: unknown
  /** True when a value is stored in User, Workspace or Workspace Folder settings. */
  modified: boolean
  /** Machine-scoped settings can only be saved in User settings. */
  machine: boolean
  /** An extra button next to the control, e.g. "Browse…" for the CLI path. */
  action?: SettingAction
}

export type SettingsSection = { id: string; title: string; controls: SettingsControl[] }

export type SecretRow = {
  id: string
  label: string
  description: string
  set: boolean
  setCommand: string
  clearCommand: string
}

export type ActionRow = { id: string; label: string; description: string; command: string; icon?: string; button?: string; /** Rows with the same group share a heading on the page. */ group?: string }

export type AboutLink = { label: string; url: string; description?: string }

export type SettingsState = {
  version: string
  sections: SettingsSection[]
  secrets: SecretRow[]
  actions: ActionRow[]
  enhance?: { id: string; providerID: string; variant?: string }
  companion: { installed: boolean; version?: string; commands: ActionRow[] }
  about: { version: string; links: AboutLink[]; note: string }
}

export type ToSettingsHost =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "set"; key: string; value: unknown }
  | { type: "reset"; key: string }
  | { type: "command"; command: string }
  | { type: "openSettings" }
  | { type: "openExternal"; url: string }
  | { type: "resetEnhance" }

export type ToSettingsWebview = { type: "state"; state: SettingsState } | { type: "toast"; level: "info" | "error"; message: string }

const SECTION_TITLES: Record<string, string> = {
  connection: "Connection",
  transcript: "Transcript",
  todo: "Task list",
  notifications: "Notifications",
  terminal: "Terminal",
  voice: "Voice",
  view: "View",
}

/** Known sections first; a new `opencode.*` section appears after them, in schema order. */
const SECTION_ORDER = ["connection", "transcript", "todo", "notifications", "terminal", "voice", "view"]

const ACRONYMS = new Set(["url", "cli", "os", "api", "mcp", "id", "ui", "json", "cpu"])

const MACHINE_SCOPES = new Set(["machine", "machine-overridable", "application"])

/** `contributes.configuration` may be one object or an array of them. */
export function configurationProperties(configuration: ConfigurationSchema | ConfigurationSchema[] | undefined): Record<string, PropertySchema> {
  if (!configuration) return {}
  const list = Array.isArray(configuration) ? configuration : [configuration]
  return Object.assign({}, ...list.map((c) => c?.properties ?? {})) as Record<string, PropertySchema>
}

export function shortKeyOf(fullKey: string): string {
  return fullKey.startsWith("opencode.") ? fullKey.slice("opencode.".length) : fullKey
}

/** `collapseCompletedSteps` -> "Collapse completed steps"; `serverUrl` -> "Server URL". */
export function humanizeKey(key: string): string {
  const last = key.split(".").pop() ?? key
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
  return words
    .map((word, index) => {
      const lower = word.toLowerCase()
      if (ACRONYMS.has(lower)) return lower.toUpperCase()
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      return word.toLowerCase()
    })
    .join(" ")
}

export function controlKind(property: PropertySchema): ControlKind {
  const type = Array.isArray(property.type) ? property.type[0] : property.type
  if (type === "boolean") return "boolean"
  if (type === "number" || type === "integer") return "number"
  if (type === "array") return property.items?.enum?.length ? "enumList" : "stringList"
  if (type === "string" && property.enum?.length) return "enum"
  return "string"
}

export function sectionIdFor(shortKey: string): string {
  if (shortKey === "serverUrl" || shortKey === "cliPath") return "connection"
  return shortKey.includes(".") ? shortKey.split(".")[0]! : "connection"
}

export function sectionTitleFor(id: string): string {
  return SECTION_TITLES[id] ?? humanizeKey(id)
}

/** A setting's value kind, for tests and for the webview's fallback. */
export function defaultValueFor(property: PropertySchema): unknown {
  if (property.default !== undefined) return property.default
  switch (controlKind(property)) {
    case "boolean":
      return false
    case "number":
      return 0
    case "string":
      return ""
    case "enum":
      return property.enum?.[0] ?? ""
    case "stringList":
    case "enumList":
      return []
  }
}

function optionsFor(property: PropertySchema): SettingOption[] | undefined {
  const kind = controlKind(property)
  const values = kind === "enum" ? property.enum : kind === "enumList" ? property.items?.enum : undefined
  if (!values) return undefined
  const labels = kind === "enumList" ? property.items?.enumItemLabels : property.enumItemLabels
  const descriptions = kind === "enumList" ? property.items?.enumDescriptions : property.enumDescriptions
  return values.map((value, index) => ({
    value,
    label: labels?.[index] ?? humanizeKey(value),
    ...(descriptions?.[index] ? { description: descriptions[index] } : {}),
  }))
}

export function isModified(snapshot: SettingSnapshot): boolean {
  return snapshot.globalValue !== undefined || snapshot.workspaceValue !== undefined || snapshot.workspaceFolderValue !== undefined
}

export function isMachineScoped(property: PropertySchema): boolean {
  return MACHINE_SCOPES.has(property.scope ?? "window")
}

/**
 * Where a value is written. Machine-scoped settings can only live in User settings; the page itself edits User
 * settings, and `workspace` is only passed by a caller that offers that choice.
 */
export function resolveWriteTarget(property: PropertySchema, requested: "user" | "workspace" = "user"): "global" | "workspace" {
  if (isMachineScoped(property)) return "global"
  return requested === "workspace" ? "workspace" : "global"
}

export function controlFor(fullKey: string, property: PropertySchema, snapshot: SettingSnapshot): SettingsControl {
  const shortKey = shortKeyOf(fullKey)
  const value = snapshot.value !== undefined ? snapshot.value : snapshot.defaultValue !== undefined ? snapshot.defaultValue : defaultValueFor(property)
  return {
    key: fullKey,
    shortKey,
    label: humanizeKey(shortKey),
    description: property.markdownDescription ?? property.description ?? "",
    kind: controlKind(property),
    ...(optionsFor(property) ? { options: optionsFor(property) } : {}),
    ...(property.minimum !== undefined ? { min: property.minimum } : {}),
    ...(property.maximum !== undefined ? { max: property.maximum } : {}),
    value,
    defaultValue: snapshot.defaultValue !== undefined ? snapshot.defaultValue : defaultValueFor(property),
    modified: isModified(snapshot),
    machine: isMachineScoped(property),
    ...(shortKey === "cliPath" ? { action: { label: "Browse…", command: "opencode.setCliPath" } } : {}),
  }
}

/**
 * Builds the page's sections from the extension's `contributes.configuration` and the current values. Deprecated
 * settings are skipped, so `opencode.voice.localLanguage` does not appear next to its replacement list.
 */
export function buildSettingsSections(configuration: ConfigurationSchema | ConfigurationSchema[] | undefined, snapshots: Record<string, SettingSnapshot>): SettingsSection[] {
  const properties = configurationProperties(configuration)
  const grouped = new Map<string, SettingsControl[]>()
  for (const [fullKey, property] of Object.entries(properties)) {
    if (!property || typeof property !== "object") continue
    if (property.deprecationMessage) continue
    const shortKey = shortKeyOf(fullKey)
    if (!shortKey || shortKey.includes(" ")) continue
    const id = sectionIdFor(shortKey)
    const list = grouped.get(id) ?? []
    list.push(controlFor(fullKey, property, snapshots[shortKey] ?? {}))
    grouped.set(id, list)
  }
  const known = SECTION_ORDER.filter((id) => grouped.has(id))
  const extra = [...grouped.keys()].filter((id) => !SECTION_ORDER.includes(id))
  return [...known, ...extra].map((id) => ({ id, title: sectionTitleFor(id), controls: grouped.get(id)! }))
}

export type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string }

const fail = (error: string): CoerceResult => ({ ok: false, error })

/** Validates and normalizes a value coming from the page before it is written to settings. */
export function coerceSettingValue(property: PropertySchema, raw: unknown): CoerceResult {
  const kind = controlKind(property)
  switch (kind) {
    case "boolean":
      return typeof raw === "boolean" ? { ok: true, value: raw } : fail("Choose on or off.")
    case "number": {
      const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN
      if (!Number.isFinite(value)) return fail("Enter a number.")
      if (property.type === "integer" && !Number.isInteger(value)) return fail("Enter a whole number.")
      if (property.minimum !== undefined && value < property.minimum) return fail(`Enter ${property.minimum} or more.`)
      if (property.maximum !== undefined && value > property.maximum) return fail(`Enter ${property.maximum} or less.`)
      return { ok: true, value }
    }
    case "string":
      return typeof raw === "string" ? { ok: true, value: raw } : fail("Enter text.")
    case "enum": {
      if (typeof raw !== "string") return fail("Choose one of the listed values.")
      if (property.enum && !property.enum.includes(raw)) return fail("Choose one of the listed values.")
      return { ok: true, value: raw }
    }
    case "stringList": {
      const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : undefined
      if (!list) return fail("Enter a comma-separated list.")
      return { ok: true, value: uniqueStrings(list) }
    }
    case "enumList": {
      const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : undefined
      if (!list) return fail("Choose one or more values.")
      const values = uniqueStrings(list)
      const allowed = property.items?.enum
      if (allowed && values.some((value) => !allowed.includes(value))) return fail("Choose one of the listed values.")
      return { ok: true, value: values }
    }
  }
}

function uniqueStrings(raw: ReadonlyArray<unknown>): string[] {
  const out: string[] = []
  for (const item of raw) {
    const value = String(item).trim()
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

export function matchesQuery(text: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  return !q || text.toLowerCase().includes(q)
}

/** Search/filter: a matching section title keeps all its controls, otherwise only matching controls remain. */
export function filterSections(sections: ReadonlyArray<SettingsSection>, query: string): SettingsSection[] {
  const q = query.trim()
  if (!q) return sections.map((section) => ({ ...section }))
  return sections.flatMap((section) => {
    if (matchesQuery(section.title, q)) return [{ ...section, controls: [...section.controls] }]
    const controls = section.controls.filter(
      (control) => matchesQuery(control.label, q) || matchesQuery(control.key, q) || matchesQuery(control.description, q) || (control.options ?? []).some((option) => matchesQuery(option.label, q)),
    )
    return controls.length ? [{ ...section, controls }] : []
  })
}

/**
 * A deliberately small Markdown renderer for schema descriptions: code spans, bold, links, `#setting#` references and
 * line breaks. Everything is escaped first, so a description can never inject markup into the page.
 */
export function markdownLite(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  // Code spans are handled first; a `#setting#` reference inside one becomes the setting name without a second wrapper.
  const withCode = escaped.replace(/`([^`]+)`/g, (_, code: string) => `<code>${code.replace(/#([\w.]+)#/g, "$1")}</code>`)
  return withCode
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/#([\w.]+)#/g, "<code>$1</code>")
    .replace(/\n- /g, "\n• ")
    .replace(/\n/g, "<br>")
}

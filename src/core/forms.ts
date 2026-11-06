import type { FormField, FormInfo } from "./api"

export type FormValue = string | number | boolean | string[]
export type Answers = Record<string, FormValue>

/** Extra state for a field's "Other…" free-text row. */
export type OtherText = Record<string, string>

const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v
  return undefined
}

/** `-Infinity`, `Infinity` and `NaN` arrive as strings; limits that are not finite are ignored. */
export const limit = (v: unknown): number | undefined => (typeof v === "string" ? undefined : num(v))

/** Evaluate one `when` condition against the answers collected so far. */
function matches(cond: { key: string; op: "eq" | "neq"; value: unknown }, answers: Answers): boolean {
  const actual = answers[cond.key]
  const equal = Array.isArray(actual) ? actual.includes(String(cond.value)) : actual === cond.value
  return cond.op === "eq" ? equal : !equal
}

type Common = { hidden?: boolean; required?: boolean; when?: Array<{ key: string; op: "eq" | "neq"; value: unknown }> }

/** `external` fields carry no hidden/when/required, so read the shared attributes through one view. */
const common = (f: FormField): Common => f as Common

/** Fields the user should currently see: not hidden, and every `when` condition holds. */
export function visibleFields(fields: ReadonlyArray<FormField>, answers: Answers): FormField[] {
  return fields.filter((f) => !common(f).hidden && (common(f).when ?? []).every((c) => matches(c, answers)))
}

/** Seed answers from field defaults. Values the user already typed win. */
export function defaultAnswers(fields: ReadonlyArray<FormField>): Answers {
  const out: Answers = {}
  for (const f of fields) {
    if (f.type === "external") continue
    const d = (f as { default?: unknown }).default
    if (d === undefined) continue
    if (f.type === "number" || f.type === "integer") {
      const n = limit(d)
      if (n !== undefined) out[f.key] = n
    } else if (f.type === "multiselect") out[f.key] = Array.isArray(d) ? [...(d as string[])] : []
    else if (f.type === "boolean") out[f.key] = d === true
    else if (typeof d === "string") out[f.key] = d
  }
  return out
}

/** Whether the field's single/multi choice currently resolves to the "Other…" text. */
export const OTHER = "\u0000other"

/** Validation message for a field value, or undefined when it is acceptable. Empty optional values are fine. */
export function validateField(field: FormField, value: FormValue | undefined, other?: string): string | undefined {
  const empty = value === undefined || value === "" || (Array.isArray(value) && value.length === 0)
  if (field.type === "external") return undefined
  const required = common(field).required === true
  switch (field.type) {
    case "boolean":
      return required && value === undefined ? "Choose Yes or No" : undefined
    case "string": {
      const v = value === OTHER ? (other ?? "") : typeof value === "string" ? value : ""
      if (!v) return required ? "Required" : undefined
      if (field.minLength !== undefined && v.length < field.minLength) return `At least ${field.minLength} characters`
      if (field.maxLength !== undefined && v.length > field.maxLength) return `At most ${field.maxLength} characters`
      if (field.pattern) {
        try {
          if (!new RegExp(field.pattern).test(v)) return "Does not match the expected format"
        } catch {
          // An invalid server pattern must not block the user.
        }
      }
      if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Enter a valid email"
      if (field.format === "uri" && !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(v)) return "Enter a valid URL"
      if (field.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Use YYYY-MM-DD"
      return undefined
    }
    case "number":
    case "integer": {
      if (empty) return required ? "Required" : undefined
      const n = typeof value === "number" ? value : Number(value)
      if (!Number.isFinite(n)) return "Enter a number"
      if (field.type === "integer" && !Number.isInteger(n)) return "Enter a whole number"
      const min = limit(field.minimum)
      const max = limit(field.maximum)
      if (min !== undefined && n < min) return `At least ${min}`
      if (max !== undefined && n > max) return `At most ${max}`
      return undefined
    }
    case "multiselect": {
      const chosen = Array.isArray(value) ? value : []
      const count = chosen.length
      const withOther = chosen.includes(OTHER)
      if (withOther && !(other ?? "").trim()) return "Type your answer for Other"
      if (count === 0) return required || (field.minItems ?? 0) > 0 ? `Choose at least ${Math.max(1, field.minItems ?? 1)}` : undefined
      if (field.minItems !== undefined && count < field.minItems) return `Choose at least ${field.minItems}`
      if (field.maxItems !== undefined && count > field.maxItems) return `Choose at most ${field.maxItems}`
      return undefined
    }
  }
}

/** Single-choice string fields with options (numbered rows) as opposed to a free text input. */
export const isChoice = (f: FormField): f is Extract<FormField, { type: "string" }> =>
  f.type === "string" && Array.isArray(f.options) && f.options.length > 0

/** Whether the field must be completed before moving on. */
export const isRequired = (f: FormField) => common(f).required === true || (f.type === "multiselect" && (f.minItems ?? 0) > 0)

/** Whether the user may leave the field without answering. */
export const isOptional = (f: FormField) => !isRequired(f) && f.type !== "external"

export type FormErrors = Record<string, string>

export function validateForm(fields: ReadonlyArray<FormField>, answers: Answers, other: OtherText): FormErrors {
  const errors: FormErrors = {}
  for (const f of visibleFields(fields, answers)) {
    const msg = validateField(f, answers[f.key], other[f.key])
    if (msg) errors[f.key] = msg
  }
  return errors
}

/**
 * Build the `answer` record for `session.form.reply`. Hidden/unmet fields are omitted, the "Other…"
 * marker is swapped for the typed text, and empty optional values are left out.
 */
export function buildAnswer(fields: ReadonlyArray<FormField>, answers: Answers, other: OtherText): Answers {
  const out: Answers = {}
  for (const f of visibleFields(fields, answers)) {
    if (f.type === "external") continue
    const v = answers[f.key]
    if (v === undefined || v === "") continue
    if (f.type === "multiselect") {
      const list = (Array.isArray(v) ? v : []).flatMap((x) => (x === OTHER ? ((other[f.key] ?? "").trim() ? [(other[f.key] ?? "").trim()] : []) : [x]))
      if (list.length > 0) out[f.key] = list
    } else if (f.type === "string") {
      const text = v === OTHER ? (other[f.key] ?? "").trim() : (v as string)
      if (text) out[f.key] = text
    } else if (f.type === "number" || f.type === "integer") {
      const n = typeof v === "number" ? v : Number(v)
      if (Number.isFinite(n)) out[f.key] = n
    } else out[f.key] = v
  }
  return out
}

/** Tab strip state: only visible fields get a tab, and a tab is "done" once its field validates and has a value. */
export type Tab = { key: string; label: string; done: boolean }

export function tabsFor(fields: ReadonlyArray<FormField>, answers: Answers, other: OtherText): Tab[] {
  return visibleFields(fields, answers).map((f, i) => {
    const answered = f.type === "external" ? true : answers[f.key] !== undefined && answers[f.key] !== "" && !(Array.isArray(answers[f.key]) && (answers[f.key] as string[]).length === 0)
    return { key: f.key, label: f.title || f.key || `Field ${i + 1}`, done: answered && !validateField(f, answers[f.key], other[f.key]) }
  })
}

/** The form's heading text for a field: title, then description as secondary copy. */
export const fieldTitle = (f: FormField) => f.title || f.key

/** Clamp the step index when `when` conditions change which fields exist. */
export const clampStep = (step: number, visibleCount: number) => Math.max(0, Math.min(step, Math.max(0, visibleCount - 1)))

export type FormSummary = Pick<FormInfo, "id" | "sessionID" | "title" | "fields">

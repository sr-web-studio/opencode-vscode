/**
 * The unsent prompt of a folder (text, attachments, skills) kept in the host's persistent store.
 *
 * A VS Code webview view is destroyed while it is not on screen, and a phone can be sent to the background, so the
 * draft has to survive more than the Svelte state: the bridge's `storage` (VS Code's webview state, the app's
 * localStorage) holds it. Everything here is pure, so the key layout and the size rules are tested on their own.
 */
import { attachmentFromUri, type Attachment } from "./attachments"
import type { ViewTarget } from "./draft"
import { isWindowsPath } from "./paths"

export type PromptSkill = { id: string; name: string }

/** One folder's unsent prompt. The same shape the prompt box binds to. */
export type PromptDraft = { text: string; files: Attachment[]; skills: PromptSkill[] }

export const emptyPromptDraft = (): PromptDraft => ({ text: "", files: [], skills: [] })

/** Anything worth restoring: whitespace alone is not. */
export const draftHasContent = (draft: PromptDraft): boolean => draft.text.trim().length > 0 || draft.files.length > 0 || draft.skills.length > 0

/** The folder part of the key: normalised, because the server may respell one folder (`d:` vs `D:`). */
export function draftFolderKey(directory: string): string {
  if (!directory) return ""
  const slashed = directory.replace(/\\/g, "/").replace(/\/+$/, "")
  return isWindowsPath(directory) ? slashed.toLowerCase() : slashed
}

/** The session-target part of the key: a fresh draft, or one session. */
export function draftTargetKey(target: ViewTarget | undefined): string {
  if (!target) return ""
  return target.kind === "draft" ? "draft" : `session:${target.id}`
}

export const DRAFT_STORE_PREFIX = "occ.promptDraft.v1:"

/** Where one folder's draft for one target lives. */
export const draftDataKey = (folder: string, target: string): string => `${DRAFT_STORE_PREFIX}${folder}:${target}`

/** The target of the last write for a folder, so a draft typed in one target is found when another one opens first. */
export const draftPointerKey = (folder: string): string => `${DRAFT_STORE_PREFIX}${folder}:last`

/**
 * Beyond this the draft is stored without its inline image data. VS Code keeps the webview state on disk and the phone
 * keeps it in localStorage (about 5 MB for the whole origin), and neither should carry a handful of full pictures.
 */
export const DRAFT_MAX_CHARS = 2 * 1024 * 1024

export type StoredDraft = {
  v: 1
  text: string
  /** `thumb` is rebuilt from `uri` on load, so a data URI is stored once instead of twice. */
  files: Array<{ id: string; uri: string; name: string; mime?: string }>
  skills: PromptSkill[]
  /** Files left out because the draft was over the size cap. */
  dropped?: number
}

/** The small key/value store a host bridge exposes (VS Code's webview state, the app's localStorage). */
export type DraftStorage = { get<T = unknown>(key: string): T | undefined; set(key: string, value: unknown): void }

/**
 * What to write for a draft. Over `max` characters the files that carry their bytes inline (`data:`) are left out and
 * counted in `dropped`; files that are a path stay, because they cost nothing and still send.
 */
export function serializeDraft(draft: PromptDraft, max = DRAFT_MAX_CHARS): { value: StoredDraft; dropped: number } {
  const files = draft.files.map(({ id, uri, name, mime }) => (mime ? { id, uri, name, mime } : { id, uri, name }))
  const skills = draft.skills.map(({ id, name }) => ({ id, name }))
  const value: StoredDraft = { v: 1, text: draft.text, files, skills }
  if (JSON.stringify(value).length <= max) return { value, dropped: 0 }
  const kept = files.filter((f) => !f.uri.startsWith("data:"))
  const dropped = files.length - kept.length
  return { value: { v: 1, text: draft.text, files: kept, skills, ...(dropped > 0 ? { dropped } : {}) }, dropped }
}

/** A stored value back into a draft. Undefined for anything that is not one, or that holds nothing to restore. */
export function parseDraft(raw: unknown): { draft: PromptDraft; dropped: number } | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const o = raw as Partial<StoredDraft>
  if (o.v !== 1 || typeof o.text !== "string" || !Array.isArray(o.files) || !Array.isArray(o.skills)) return undefined
  const files = o.files.flatMap((f) => {
    if (!f || typeof f !== "object") return []
    const { id, uri, name, mime } = f as { id?: unknown; uri?: unknown; name?: unknown; mime?: unknown }
    if (typeof id !== "string" || !id || typeof uri !== "string" || !uri || typeof name !== "string") return []
    return [attachmentFromUri(id, uri, name, typeof mime === "string" ? mime : undefined)]
  })
  const skills = o.skills.flatMap((s) => {
    if (!s || typeof s !== "object") return []
    const { id, name } = s as { id?: unknown; name?: unknown }
    return typeof id === "string" && id && typeof name === "string" ? [{ id, name }] : []
  })
  const draft: PromptDraft = { text: o.text, files, skills }
  const dropped = typeof o.dropped === "number" && o.dropped > 0 ? Math.floor(o.dropped) : 0
  return draftHasContent(draft) || dropped > 0 ? { draft, dropped } : undefined
}

/** Write one target's draft, and remember it as the folder's latest. An empty draft writes a tombstone. */
export function writeDraft(storage: DraftStorage, folder: string, target: string, draft: PromptDraft): void {
  if (!folder || !target) return
  const key = draftDataKey(folder, target)
  if (draftHasContent(draft)) storage.set(key, serializeDraft(draft).value)
  else storage.set(key, null)
  storage.set(draftPointerKey(folder), target)
}

/** Forget one target's draft (it was sent, or its content moved to another target). */
export function clearDraft(storage: DraftStorage, folder: string, target: string): void {
  if (!folder || !target) return
  storage.set(draftDataKey(folder, target), null)
}

export type RestoredDraft = { draft: PromptDraft; dropped: number; target: string }

/**
 * The draft to show: the one saved for this target, or else the folder's latest one (a prompt typed in a fresh draft
 * must still be there when the host reopens a session). The caller re-saves it under the current target.
 */
export function loadDraft(storage: DraftStorage, folder: string, target: string): RestoredDraft | undefined {
  if (!folder) return undefined
  const exact = parseDraft(storage.get(draftDataKey(folder, target)))
  if (exact) return { ...exact, target }
  const last = storage.get<string>(draftPointerKey(folder))
  if (typeof last !== "string" || !last || last === target) return undefined
  const other = parseDraft(storage.get(draftDataKey(folder, last)))
  return other ? { ...other, target: last } : undefined
}

/** A cheap identity of a draft's content: used to skip a write when nothing changed. */
export function draftSignature(draft: PromptDraft): string {
  const files = draft.files.map((f) => `${f.id}\u0001${f.uri.length}\u0001${f.name}`).join("\u0002")
  const skills = draft.skills.map((s) => s.id).join("\u0002")
  return `${draft.text.length}:${draft.text}\u0000${files}\u0000${skills}`
}

import type { ToolItem } from "./types"

/**
 * Line (1-based, in the new file) of the first added or removed line of a unified diff, from its first hunk:
 * `@@ -a,b +c,d @@` starts at `c`, and every context line before the change moves the position by one.
 * Undefined when the patch has no hunk or no change.
 */
export function firstChangedLine(patch: string): number | undefined {
  let next: number | undefined
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (hunk) {
      next = Number(hunk[1])
      continue
    }
    if (next === undefined || raw.startsWith("\\")) continue
    if (raw.startsWith("+") || raw.startsWith("-")) return Math.max(next, 1)
    next++
  }
  return undefined
}

export type PatchedFile = { file: string; patch?: string; status?: string }

const HEADER = /^\*\*\* (Update|Add|Delete) File: (.+?)\s*$/gm

/**
 * The files a tool changed: `metadata.files` once the server reports them, else (while it runs) the
 * `*** Update File: path` headers of a `patch` tool's `patchText`.
 */
export function patchedFiles(tool: Pick<ToolItem, "input" | "metadata">): PatchedFile[] {
  const meta = Array.isArray(tool.metadata.files) ? (tool.metadata.files as Array<Record<string, unknown>>) : []
  const fromMeta: PatchedFile[] = []
  for (const f of meta) {
    if (typeof f?.file !== "string" || !f.file) continue
    fromMeta.push({ file: f.file, patch: typeof f.patch === "string" ? f.patch : undefined, status: typeof f.status === "string" ? f.status : undefined })
  }
  if (fromMeta.length) return fromMeta
  const text = typeof tool.input.patchText === "string" ? tool.input.patchText : ""
  const out: PatchedFile[] = []
  for (const m of text.matchAll(HEADER)) out.push({ file: m[2]!, status: m[1] === "Delete" ? "deleted" : undefined })
  return out
}

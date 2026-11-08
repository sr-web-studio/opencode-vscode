/**
 * Edit diffs as pure functions (no `vscode`, no Node, no DOM): parse the unified patch the edit tool reports
 * (`metadata.files[].patch`, jsdiff format with an `Index:` header), turn it into display rows with line-number
 * gutters and word-level marks, rebuild the text a file had before the edit by applying the patch backwards, and
 * build a hunks-only before/after pair for when the file has changed too much for that.
 */

export type PatchLine = { op: " " | "+" | "-"; text: string }
export type Hunk = { oldStart: number; newStart: number; lines: PatchLine[] }

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * The hunks of a unified patch. The `Index:`, `===`, `---` and `+++` lines are dropped. A hunk ends when the counts of
 * its header are used up, so a removed line that itself starts with `--` is not mistaken for a file header.
 */
export function parsePatch(patch: string): Hunk[] {
  const src = patch.split("\n")
  const hunks: Hunk[] = []
  for (let i = 0; i < src.length; i++) {
    const head = HUNK.exec(src[i]!)
    if (!head) continue
    let oldLeft = head[2] === undefined ? 1 : Number(head[2])
    let newLeft = head[4] === undefined ? 1 : Number(head[4])
    const hunk: Hunk = { oldStart: Number(head[1]), newStart: Number(head[3]), lines: [] }
    while (i + 1 < src.length && (oldLeft > 0 || newLeft > 0)) {
      const raw = src[i + 1]!
      if (raw.startsWith("\\")) {
        i++
        continue
      }
      const op = raw[0]
      const text = raw.slice(1).replace(/\r$/, "")
      if (op === "+" && newLeft > 0) newLeft--
      else if (op === "-" && oldLeft > 0) oldLeft--
      else if ((op === " " || raw === "") && oldLeft > 0 && newLeft > 0) {
        oldLeft--
        newLeft--
      } else break
      hunk.lines.push({ op: op === "+" || op === "-" ? op : " ", text })
      i++
    }
    hunks.push(hunk)
  }
  return hunks
}

/* --------------------------------------------------------------------- rows */

export type Mark = { start: number; end: number }
export type DiffRow = { kind: "hunk"; line: number } | { kind: "context" | "add" | "del"; oldNo?: number; newNo?: number; text: string; marks?: Mark[] }

/** Rows for the inline view: a slim separator before each hunk, then the lines with both gutters. */
export function patchRows(hunks: ReadonlyArray<Hunk>): DiffRow[] {
  const rows: DiffRow[] = []
  for (const h of hunks) {
    rows.push({ kind: "hunk", line: h.newStart || h.oldStart })
    let o = h.oldStart
    let n = h.newStart
    const first = rows.length
    for (const l of h.lines) {
      if (l.op === " ") rows.push({ kind: "context", oldNo: o++, newNo: n++, text: l.text })
      else if (l.op === "-") rows.push({ kind: "del", oldNo: o++, text: l.text })
      else rows.push({ kind: "add", newNo: n++, text: l.text })
    }
    markWords(rows, first)
  }
  return rows
}

/** Pair each run of removed lines with the added lines that follow it, and mark the words that differ. */
function markWords(rows: DiffRow[], from: number): void {
  let i = from
  while (i < rows.length) {
    if (rows[i]!.kind !== "del") {
      i++
      continue
    }
    let d = i
    while (d < rows.length && rows[d]!.kind === "del") d++
    let a = d
    while (a < rows.length && rows[a]!.kind === "add") a++
    const pairs = Math.min(d - i, a - d)
    for (let k = 0; k < pairs; k++) {
      const del = rows[i + k] as Extract<DiffRow, { text: string }>
      const add = rows[d + k] as Extract<DiffRow, { text: string }>
      const m = wordMarks(del.text, add.text)
      if (m) {
        if (m.a.length) del.marks = m.a
        if (m.b.length) add.marks = m.b
      }
    }
    i = Math.max(a, i + 1)
  }
}

const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu
const MAX_CELLS = 40_000

const tokens = (s: string): string[] => s.match(TOKEN) ?? []

/**
 * The parts of two similar lines that differ, as character ranges. Undefined when the lines have too little in common
 * (the whole row is coloured already, so marks would only add noise) or are too long to compare cheaply.
 */
export function wordMarks(a: string, b: string): { a: Mark[]; b: Mark[] } | undefined {
  const x = tokens(a)
  const y = tokens(b)
  if (x.length * y.length > MAX_CELLS) return undefined
  const w = y.length + 1
  const lcs = new Uint16Array((x.length + 1) * w)
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!)
  const keepA = new Array<boolean>(x.length).fill(false)
  const keepB = new Array<boolean>(y.length).fill(false)
  let i = 0
  let j = 0
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      keepA[i] = keepB[j] = true
      i++
      j++
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) i++
    else j++
  }
  const common = x.reduce((n, t, k) => (keepA[k] && t.trim() ? n + t.length : n), 0)
  const longest = Math.max(a.replace(/\s/g, "").length, b.replace(/\s/g, "").length)
  if (common === 0 || common / longest < 0.3) return undefined
  return { a: spans(x, keepA), b: spans(y, keepB) }
}

function spans(list: string[], keep: boolean[]): Mark[] {
  const out: Mark[] = []
  let at = 0
  list.forEach((t, k) => {
    const end = at + t.length
    if (!keep[k]) {
      const last = out[out.length - 1]
      if (last && last.end === at) last.end = end
      else out.push({ start: at, end })
    }
    at = end
  })
  return out
}

/** A row's text cut at its marks, for rendering the changed words with their own background. */
export function segments(text: string, marks?: ReadonlyArray<Mark>): Array<{ text: string; mark: boolean }> {
  if (!marks?.length) return [{ text, mark: false }]
  const out: Array<{ text: string; mark: boolean }> = []
  let at = 0
  for (const m of marks) {
    if (m.start > at) out.push({ text: text.slice(at, m.start), mark: false })
    out.push({ text: text.slice(m.start, m.end), mark: true })
    at = m.end
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false })
  return out
}

/** Digits needed for the widest line number, so both gutters line up. */
export function gutterDigits(rows: ReadonlyArray<DiffRow>): number {
  let max = 0
  for (const r of rows) if (r.kind !== "hunk") max = Math.max(max, r.oldNo ?? 0, r.newNo ?? 0)
  return String(max).length
}

/* ---------------------------------------------------------- before / after */

const sideOf = (h: Hunk, ops: ReadonlyArray<PatchLine["op"]>): string[] => h.lines.filter((l) => ops.includes(l.op)).map((l) => l.text)
const OLD = [" ", "-"] as const
const NEW = [" ", "+"] as const

/** What the patch does to the file as a whole: made from nothing, emptied, or changed. */
export function patchKind(hunks: ReadonlyArray<Hunk>): "added" | "deleted" | "modified" {
  if (hunks.length === 0) return "modified"
  if (hunks.every((h) => sideOf(h, OLD).length === 0)) return "added"
  if (hunks.every((h) => sideOf(h, NEW).length === 0)) return "deleted"
  return "modified"
}

const matchesAt = (lines: ReadonlyArray<string>, at: number, want: ReadonlyArray<string>): boolean => {
  if (at < 0 || at + want.length > lines.length) return false
  for (let k = 0; k < want.length; k++) if (lines[at + k]!.replace(/\r$/, "") !== want[k]) return false
  return true
}

/**
 * The text before the patch was applied: the patch is run backwards over the current text. Every hunk must find its
 * "after" lines near the place the patch says (a few lines of drift from later edits is fine); anything else
 * returns undefined, and the caller falls back to `hunksOnly`.
 */
export function reverseApply(current: string, hunks: ReadonlyArray<Hunk>): string | undefined {
  const eol = current.includes("\r\n") ? "\r\n" : "\n"
  const lines = current.split(/\r?\n/)
  const out: string[] = []
  let pos = 0
  for (const h of hunks) {
    const after = sideOf(h, NEW)
    const before = sideOf(h, OLD)
    const expected = after.length === 0 ? h.newStart : h.newStart - 1
    let found = -1
    for (let d = 0; d <= lines.length && found < 0; d++) {
      for (const at of d === 0 ? [expected] : [expected - d, expected + d]) {
        if (at >= pos && matchesAt(lines, at, after)) {
          found = at
          break
        }
      }
    }
    if (found < 0) return undefined
    out.push(...lines.slice(pos, found), ...before)
    pos = found + after.length
  }
  out.push(...lines.slice(pos))
  return out.join(eol)
}

/**
 * The text a file had before a series of edits (oldest patch first), from the file as it is now. Edits are undone newest
 * first. Undefined when any step does not fit.
 */
export function reconstructBefore(current: string, patches: ReadonlyArray<string>): string | undefined {
  let text: string | undefined = current
  for (let i = patches.length - 1; i >= 0 && text !== undefined; i--) text = reverseApply(text, parsePatch(patches[i]!))
  return text
}

/**
 * The two sides of the patch hunks alone. Hunks are separated by an identical line on both sides, so the diff editor
 * keeps them aligned. Used when the file has changed too much to rebuild the full text.
 */
export function hunksOnly(patches: ReadonlyArray<string>): { before: string; after: string } {
  const before: string[] = []
  const after: string[] = []
  for (const patch of patches) {
    for (const h of parsePatch(patch)) {
      if (before.length > 0) {
        before.push("⋯")
        after.push("⋯")
      }
      before.push(...sideOf(h, OLD))
      after.push(...sideOf(h, NEW))
    }
  }
  const text = (l: string[]) => (l.length ? `${l.join("\n")}\n` : "")
  return { before: text(before), after: text(after) }
}

/* ------------------------------------------------------------------- turns */

export type ChangedFile = {
  file: string
  /** Patches in the order the edits happened. */
  patches: string[]
  additions: number
  deletions: number
}

type EditTool = { name: string; status?: string; metadata: Record<string, unknown> }

/**
 * The files a turn changed, one entry per file with all of its patches. Only finished edits with a patch count.
 * `normalize` makes `src/a.ts` and `./src/a.ts` (or an absolute path) the same file.
 */
export function changedFiles(tools: ReadonlyArray<EditTool>, normalize: (file: string) => string = (f) => f): ChangedFile[] {
  const byFile = new Map<string, ChangedFile>()
  for (const t of tools) {
    if ((t.name !== "edit" && t.name !== "write" && t.name !== "patch") || t.status === "error") continue
    const files = Array.isArray(t.metadata.files) ? (t.metadata.files as Array<{ file?: unknown; patch?: unknown; additions?: unknown; deletions?: unknown }>) : []
    for (const f of files) {
      if (typeof f.file !== "string" || !f.file || typeof f.patch !== "string" || !f.patch) continue
      const key = normalize(f.file)
      const entry = byFile.get(key) ?? { file: f.file, patches: [], additions: 0, deletions: 0 }
      entry.patches.push(f.patch)
      entry.additions += typeof f.additions === "number" ? f.additions : 0
      entry.deletions += typeof f.deletions === "number" ? f.deletions : 0
      byFile.set(key, entry)
    }
  }
  return [...byFile.values()]
}

/** `Changes (3 files)` */
export const changesLabel = (n: number): string => `Changes (${n} ${n === 1 ? "file" : "files"})`

import { describe, expect, test } from "bun:test"
import { changedFiles, changesLabel, gutterDigits, hunksOnly, parsePatch, patchKind, patchRows, reconstructBefore, reverseApply, segments, wordMarks } from "@occ/core/diff"
import fixture from "../fixtures/edit-patch.json"

const patch = fixture.patch
const second = fixture.second

/** A 100-line file as it is after the first patch: lines 80-81 are the new ones. */
function afterFile(): string {
  const lines = Array.from({ length: 100 }, (_, i) => `filler ${i + 1}`)
  lines.splice(75, 10, "alpha one", "alpha two", "alpha three", "alpha four", "the new setting is blue and enabled", "the new note", "", "omega one", "", "omega two")
  return lines.join("\n") + "\n"
}
function beforeFile(): string {
  return afterFile().replace("the new setting is blue and enabled\nthe new note", "the old setting is red and enabled\nthe old note")
}

describe("parsePatch", () => {
  test("drops the Index/===/---/+++ lines and keeps one hunk with its numbers", () => {
    const hunks = parsePatch(patch)
    expect(hunks.length).toBe(1)
    expect(hunks[0]).toMatchObject({ oldStart: 76, newStart: 76 })
    expect(hunks[0]!.lines.length).toBe(12)
    expect(hunks[0]!.lines.map((l) => l.op).join("")).toBe("    --++    ")
    expect(JSON.stringify(hunks)).not.toContain("Index")
    expect(JSON.stringify(hunks)).not.toContain("=====")
  })
  test("a removed line that starts with dashes is not a file header", () => {
    const h = parsePatch("@@ -1,2 +1,1 @@\n--- not a header\n kept\n")
    expect(h[0]!.lines).toEqual([
      { op: "-", text: "-- not a header" },
      { op: " ", text: "kept" },
    ])
  })
  test("a patch with two hunks, no-newline markers, CRLF text and an empty patch", () => {
    const two = parsePatch("Index: a\n@@ -1,1 +1,1 @@\n-a\n+b\n\\ No newline at end of file\n@@ -10,2 +10,2 @@\n x\n-y\n+z\n")
    expect(two.map((h) => h.oldStart)).toEqual([1, 10])
    expect(two[0]!.lines).toEqual([
      { op: "-", text: "a" },
      { op: "+", text: "b" },
    ])
    expect(parsePatch("@@ -1,1 +1,1 @@\n-a\r\n+b\r\n")[0]!.lines[0]!.text).toBe("a")
    expect(parsePatch("")).toEqual([])
    expect(parsePatch("not a patch at all")).toEqual([])
  })
})

describe("patchRows (the inline view)", () => {
  const rows = patchRows(parsePatch(patch))
  test("one slim separator, then rows with both gutters", () => {
    expect(rows[0]).toEqual({ kind: "hunk", line: 76 })
    expect(rows.length).toBe(13)
    expect(rows[1]).toMatchObject({ kind: "context", oldNo: 76, newNo: 76, text: "alpha one" })
    expect(rows[5]).toMatchObject({ kind: "del", oldNo: 80 })
    expect(rows[5]).not.toHaveProperty("newNo")
    expect(rows[7]).toMatchObject({ kind: "add", newNo: 80 })
    expect(rows[7]).not.toHaveProperty("oldNo")
    expect(rows[9]).toMatchObject({ kind: "context", oldNo: 82, newNo: 82 })
  })
  test("changed words are marked on a removed row and its added partner", () => {
    const del = rows[5] as { text: string; marks?: Array<{ start: number; end: number }> }
    const add = rows[7] as { text: string; marks?: Array<{ start: number; end: number }> }
    expect(del.marks!.map((m) => del.text.slice(m.start, m.end))).toEqual(["old", "red"])
    expect(add.marks!.map((m) => add.text.slice(m.start, m.end))).toEqual(["new", "blue"])
  })
  test("lines with nothing in common get no marks (the whole row is coloured already)", () => {
    expect(wordMarks("completely", "different!")).toBeUndefined()
    expect(wordMarks("same line", "same line")?.a).toEqual([])
  })
  test("segments cut a row at its marks", () => {
    expect(segments("abcdef", [{ start: 1, end: 3 }])).toEqual([
      { text: "a", mark: false },
      { text: "bc", mark: true },
      { text: "def", mark: false },
    ])
    expect(segments("abc")).toEqual([{ text: "abc", mark: false }])
  })
  test("every hunk gets its own separator, and the gutter fits the widest number", () => {
    const r = patchRows(parsePatch(`${patch}${second.split("\n").slice(4).join("\n")}`))
    expect(r.filter((x) => x.kind === "hunk").map((x) => (x as { line: number }).line)).toEqual([76, 41])
    expect(gutterDigits(rows)).toBe(2)
    expect(gutterDigits([])).toBe(1)
  })
})

describe("patchKind", () => {
  test("a hunk with no old lines is an added file, one with no new lines a deleted file", () => {
    expect(patchKind(parsePatch("@@ -0,0 +1,2 @@\n+a\n+b\n"))).toBe("added")
    expect(patchKind(parsePatch("@@ -1,2 +0,0 @@\n-a\n-b\n"))).toBe("deleted")
    expect(patchKind(parsePatch(patch))).toBe("modified")
    expect(patchKind([])).toBe("modified")
  })
})

describe("reverseApply and reconstructBefore", () => {
  test("running the real-shaped patch backwards over the file gives the text before", () => {
    expect(reverseApply(afterFile(), parsePatch(patch))).toBe(beforeFile())
  })
  test("lines added above since then shift the place; the patch still finds it", () => {
    const shifted = `inserted 1\ninserted 2\ninserted 3\n${afterFile()}`
    expect(reverseApply(shifted, parsePatch(patch))).toBe(`inserted 1\ninserted 2\ninserted 3\n${beforeFile()}`)
  })
  test("a file that no longer has the edited lines fails instead of guessing", () => {
    expect(reverseApply(afterFile().replace("the new note", "someone changed this"), parsePatch(patch))).toBeUndefined()
    expect(reverseApply("short\n", parsePatch(patch))).toBeUndefined()
  })
  test("CRLF files keep their line endings", () => {
    const crlf = afterFile().replace(/\n/g, "\r\n")
    expect(reverseApply(crlf, parsePatch(patch))).toBe(beforeFile().replace(/\n/g, "\r\n"))
  })
  test("an added file reverses to nothing, and a deleted file's patch rebuilds it", () => {
    expect(reverseApply("a\nb\n", parsePatch("@@ -0,0 +1,2 @@\n+a\n+b\n"))).toBe("")
    expect(reverseApply("", parsePatch("@@ -1,2 +0,0 @@\n-a\n-b\n"))).toBe("a\nb\n")
  })
  test("several edits of one file are undone newest first", () => {
    const original = Array.from({ length: 60 }, (_, i) => `row ${i + 1}`).join("\n") + "\n"
    const edited = original.replace("row 10", "ROW TEN")
    const edited2 = edited.replace("ROW TEN", "ROW TEN AGAIN")
    const p1 = "@@ -9,3 +9,3 @@\n row 9\n-row 10\n+ROW TEN\n row 11\n"
    const p2 = "@@ -9,3 +9,3 @@\n row 9\n-ROW TEN\n+ROW TEN AGAIN\n row 11\n"
    expect(reconstructBefore(edited2, [p1, p2])).toBe(original)
    expect(reconstructBefore(edited2, [p2, p1])).toBeUndefined()
    expect(reconstructBefore("x", [])).toBe("x")
  })
})

describe("hunksOnly (the fallback)", () => {
  test("the old side and the new side of the hunks, separated by a line both share", () => {
    const { before, after } = hunksOnly([patch, second])
    expect(before).toContain("the old setting is red and enabled")
    expect(before).not.toContain("the new")
    expect(after).toContain("the new heading")
    expect(after).not.toContain("the old")
    expect(before.split("\n").filter((l) => l === "⋯").length).toBe(1)
    expect(after.split("\n").filter((l) => l === "⋯").length).toBe(1)
    expect(before.endsWith("\n")).toBe(true)
  })
  test("no patches give empty text", () => {
    expect(hunksOnly([])).toEqual({ before: "", after: "" })
  })
})

describe("changedFiles (the turn level)", () => {
  const edit = (file: string, p: string, extra: Record<string, unknown> = {}) => ({
    name: "edit",
    status: "completed",
    metadata: { files: [{ file, patch: p, additions: 2, deletions: 1, ...extra }] },
  })
  test("one entry per file, patches in order, counts added up", () => {
    const files = changedFiles([edit("a.ts", patch), edit("b.ts", second), edit("a.ts", second)])
    expect(files.map((f) => f.file)).toEqual(["a.ts", "b.ts"])
    expect(files[0]).toMatchObject({ patches: [patch, second], additions: 4, deletions: 2 })
  })
  test("failed edits, other tools and entries without a patch are skipped", () => {
    expect(changedFiles([{ ...edit("a.ts", patch), status: "error" }, { name: "read", metadata: { files: [{ file: "x", patch }] } }, edit("c.ts", "")])).toEqual([])
  })
  test("paths that differ only by ./ are one file when normalised", () => {
    const norm = (f: string) => f.replace(/^\.\//, "")
    expect(changedFiles([edit("./a.ts", patch), edit("a.ts", second)], norm).length).toBe(1)
  })
  test("the link text", () => {
    expect(changesLabel(1)).toBe("Changes (1 file)")
    expect(changesLabel(3)).toBe("Changes (3 files)")
  })
})

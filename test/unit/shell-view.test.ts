import { describe, expect, test } from "bun:test"
import { copyText, cwdLabel, shellView } from "../../src/core/shell-view"

const base = { command: "ls", output: "", directory: "/home/u/proj", displayPath: "~/proj", limit: 3, showAll: false }
const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i + 1}`).join("\n")

describe("cwdLabel", () => {
  test("no workdir, or the project folder itself, gives the ~ path", () => {
    expect(cwdLabel(undefined, "/home/u/proj", "~/proj")).toBe("~/proj")
    expect(cwdLabel("/home/u/proj/", "/home/u/proj", "~/proj")).toBe("~/proj")
  })
  test("a sub-folder keeps the ~ prefix", () => {
    expect(cwdLabel("/home/u/proj/src/ui", "/home/u/proj", "~/proj")).toBe("~/proj/src/ui")
  })
  test("a folder outside the project is shown as given, and a sibling with the same prefix is not a child", () => {
    expect(cwdLabel("/tmp/x", "/home/u/proj", "~/proj")).toBe("/tmp/x")
    expect(cwdLabel("/home/u/proj2", "/home/u/proj", "~/proj")).toBe("/home/u/proj2")
  })
  test("Windows separators", () => {
    expect(cwdLabel("C:\\w\\proj\\src", "C:/w/proj", "C:/w/proj")).toBe("C:/w/proj/src")
  })
})

describe("shellView", () => {
  test("short output is shown whole, with nothing hidden", () => {
    const v = shellView({ ...base, output: lines(2) + "\n\n" })
    expect(v).toMatchObject({ shown: "l1\nl2", total: 2, hidden: 0, cwd: "~/proj" })
  })
  test("long output keeps the last lines and says how many are hidden", () => {
    const v = shellView({ ...base, output: lines(10) })
    expect(v.shown).toBe("l8\nl9\nl10")
    expect(v.total).toBe(10)
    expect(v.hidden).toBe(7)
  })
  test("show all returns everything", () => {
    const v = shellView({ ...base, output: lines(10), showAll: true })
    expect(v.hidden).toBe(0)
    expect(v.shown.split("\n")).toHaveLength(10)
  })
  test("no output", () => {
    expect(shellView(base)).toMatchObject({ shown: "", total: 0, hidden: 0 })
  })
  test("duration needs both times and a positive span", () => {
    expect(shellView({ ...base, created: 1000, completed: 43_000 }).duration).toBe("42s")
    expect(shellView({ ...base, created: 1000, completed: 1000 }).duration).toBeUndefined()
    expect(shellView({ ...base, created: 1000 }).duration).toBeUndefined()
  })
})

describe("copyText", () => {
  test("command alone, or command with output", () => {
    expect(copyText("echo hi", "")).toBe("$ echo hi")
    expect(copyText("echo hi", "hi\n")).toBe("$ echo hi\nhi")
  })
})
